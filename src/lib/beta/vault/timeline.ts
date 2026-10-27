import "server-only";

import { Prisma } from "@prisma/client";
import { searchQuery } from "@/lib/search-query";
import { meaningSearch } from "@/lib/beta/vault/meaning";
import { chipsFor, parseVaultPassage, passagePrefilter, type VaultPassage } from "@/lib/beta/vault/passages";
import { hydrateMeaning, readSafely, VaultInputError } from "@/lib/beta/vault/search";
import { messageRefs, type SourceQuery } from "@/lib/beta/vault/sources";
import { clip, excerptAround, plainMarkdown, refsTouch, type VaultEntry, type VaultKind } from "@/lib/beta/vault/vault-rules";

/**
 * Understanding over time (docs/beta/vault.md): for one passage or topic,
 * everything the owner wrote, asked, marked and read about it, oldest first,
 * so an earlier reading sits beside a later one. It lists and quotes; it
 * never grades, counts progress or says which reading is better.
 *
 * Chats are read a turn at a time (the question asked and the answer given,
 * dated by the question), because one conversation can return to a passage
 * months apart.
 */

export interface TimelineEntry extends VaultEntry {
	/** Chats: SureWord's answer to the question, focused on the subject. */
	answer?: string | null;
}

export interface Timeline {
	subject: { kind: "passage" | "topic"; label: string; key: string | null };
	entries: TimelineEntry[];
}

const PER_KIND = 40;
const EXCERPT = 600;
const MAX_TURN_CHATS = 30;
/** Matching messages read before turns are built; newest first. */
const MAX_TURN_HITS = 120;

/** Every kind but chats, which the turn reader below covers. */
const OTHER_KINDS: VaultKind[] = ["note", "highlight", "verse", "reading", "memory", "sermon", "study"];

/**
 * `subject` is what the person typed: a passage when it reads as one ("Romans
 * 8", "John 3:16", "Psalms"), otherwise a topic ("grace").
 */
export async function vaultTimeline(userId: string, input: { subject?: string | null; passage?: string | null; topic?: string | null }): Promise<Timeline> {
	const subject = input.subject?.replace(/\s+/g, " ").trim() || null;
	const passage = input.passage ? parseVaultPassage(input.passage) : subject ? parseVaultPassage(subject) : null;
	const topicText = input.topic ?? (subject && !passage ? subject : null);
	const topic = !passage && topicText ? topicText.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 60) : null;
	if (input.passage && !passage) throw new VaultInputError("That passage could not be read. Try a reference like John 3 or Romans 8:28.");
	if (!passage && !topic) throw new VaultInputError("Choose a passage or a topic to see over time.");

	const base: Omit<SourceQuery, "limit"> = {
		userId,
		range: { since: null, until: null },
		passage,
		topic,
		words: null,
		needles: passage ? [passage.label] : topic!.split(" "),
		excerptChars: EXCERPT,
	};
	const [lists, meaning] = await Promise.all([
		Promise.all(OTHER_KINDS.map((kind) => readSafely(kind, { ...base, limit: PER_KIND }))),
		// A topic is also found by meaning ("the Comforter" for the Holy Spirit); a passage is exact.
		topic ? meaningSearch(userId, topic, [...OTHER_KINDS, "chat"], PER_KIND) : Promise.resolve([]),
	]);
	const meaningChats = meaning.filter((hit) => hit.kind === "chat");
	const meaningOthers = await hydrateMeaning({ ...base, topic: null }, meaning.filter((hit) => hit.kind !== "chat"));
	const turns = await chatTurns(userId, passage, topic, meaningChats.map((hit) => ({ conversationId: hit.sourceId, chunk: hit.chunkText ?? "" })));

	const all = new Map<string, TimelineEntry>();
	for (const entry of [...lists.flat(), ...meaningOthers.flat(), ...turns]) {
		const seen = all.get(entry.id);
		all.set(entry.id, seen ? { ...seen, matched: [...new Set([...(seen.matched ?? []), ...(entry.matched ?? [])])] } : entry);
	}
	return {
		subject: passage ? { kind: "passage", label: passage.label, key: passage.key } : { kind: "topic", label: topic!, key: null },
		entries: [...all.values()].sort((a, b) => a.date.localeCompare(b.date)),
	};
}

type HitRow = { id: string; conversationId: string; role: string; content: string; metadata: unknown };
type TurnRow = {
	anchorId: string; questionId: string; conversationId: string; title: string; question: string; askedAt: Date;
	answer: string | null; answerMetadata: unknown;
};

/** The question-and-answer turns that touch the subject, one entry per question. */
async function chatTurns(
	userId: string,
	passage: VaultPassage | null,
	topic: string | null,
	meaningChats: { conversationId: string; chunk: string }[],
): Promise<TimelineEntry[]> {
	const where: Prisma.Sql[] = [Prisma.sql`c."userId" = ${userId}`];
	if (passage) {
		const pattern = passagePrefilter(passage);
		where.push(Prisma.sql`(m."content" ~* ${pattern} OR (m."role" = 'assistant' AND m."metadata"::text ~* ${pattern}))`);
	} else {
		where.push(Prisma.sql`to_tsvector('english', m."content") @@ phraseto_tsquery('english', ${topic})`);
	}
	const hits = await searchQuery<HitRow>(Prisma.sql`
		SELECT m."id", m."conversationId", m."role", left(m."content", 60000) AS "content", CASE WHEN m."role" = 'assistant' THEN m."metadata" END AS "metadata"
		FROM "Message" m JOIN "Conversation" c ON c."id" = m."conversationId"
		WHERE ${Prisma.join(where, " AND ")}
		ORDER BY m."createdAt" DESC LIMIT ${MAX_TURN_HITS}
	`);
	const how = new Map<string, "passage" | "topic" | "meaning">();
	for (const hit of passage ? hits.filter((h) => refsTouch(messageRefs(h), passage.key)) : hits) how.set(hit.id, passage ? "passage" : "topic");

	// A meaning hit is a chunk of "You asked: ..." turns; the question it opens with is the turn it found.
	const meaningIds = [...new Set(meaningChats.map((hit) => hit.conversationId))].slice(0, MAX_TURN_CHATS);
	if (meaningIds.length) {
		const questions = await searchQuery<{ id: string; conversationId: string; opening: string }>(Prisma.sql`
			SELECT m."id", m."conversationId", left(m."content", 200) AS "opening"
			FROM "Message" m JOIN "Conversation" c ON c."id" = m."conversationId"
			WHERE c."userId" = ${userId} AND m."conversationId" = ANY(${meaningIds}::text[]) AND m."role" = 'user'
		`);
		for (const hit of meaningChats) {
			for (const match of hit.chunk.matchAll(/You asked: ([^\n]{12,60})/g)) {
				const start = match[1].trim().toLowerCase();
				const question = questions.find((q) => q.conversationId === hit.conversationId && q.opening.trim().toLowerCase().startsWith(start));
				if (question) {
					if (!how.has(question.id)) how.set(question.id, "meaning");
					break;
				}
			}
		}
	}
	if (!how.size) return [];

	// Each anchor's turn: the question at or before it, and the first answer after that question.
	const turns = await searchQuery<TurnRow>(Prisma.sql`
		WITH anchors AS (
			SELECT m."id", m."conversationId", m."createdAt"
			FROM "Message" m JOIN "Conversation" c ON c."id" = m."conversationId"
			WHERE c."userId" = ${userId} AND m."id" = ANY(${[...how.keys()]}::text[])
		)
		SELECT DISTINCT ON (q."id") x."id" AS "anchorId", q."id" AS "questionId", q."conversationId", c."title", q."content" AS "question",
			q."createdAt" AS "askedAt", a."content" AS "answer", a."metadata" AS "answerMetadata"
		FROM anchors x
		JOIN LATERAL (
			SELECT u."id", u."conversationId", left(u."content", 4000) AS "content", u."createdAt" FROM "Message" u
			WHERE u."conversationId" = x."conversationId" AND u."role" = 'user' AND u."createdAt" <= x."createdAt"
			ORDER BY u."createdAt" DESC LIMIT 1
		) q ON true
		JOIN "Conversation" c ON c."id" = q."conversationId"
		LEFT JOIN LATERAL (
			SELECT left(r."content", 20000) AS "content", r."metadata" FROM "Message" r
			WHERE r."conversationId" = q."conversationId" AND r."role" = 'assistant' AND r."createdAt" > q."createdAt"
			ORDER BY r."createdAt" ASC LIMIT 1
		) a ON true
		ORDER BY q."id", x."createdAt"
	`);

	const needles = passage ? [passage.label, ...passage.label.split(" ")] : topic!.split(" ");
	return turns.map((turn) => {
		const refs = [...new Set([
			...messageRefs({ role: "user", content: turn.question }),
			...(turn.answer ? messageRefs({ role: "assistant", content: turn.answer, metadata: turn.answerMetadata }) : []),
		])];
		return {
			id: `chat:${turn.conversationId}:${turn.questionId}`,
			kind: "chat" as const,
			sourceId: turn.conversationId,
			title: turn.title.trim() || "Chat",
			excerpt: clip(turn.question, 500),
			answer: turn.answer ? excerptAround(plainMarkdown(turn.answer), needles, EXCERPT) : null,
			date: turn.askedAt.toISOString(),
			href: `/c/${encodeURIComponent(turn.conversationId)}`,
			refs,
			passages: chipsFor(refs),
			topics: [],
			matched: [how.get(turn.anchorId) ?? how.get(turn.questionId) ?? "meaning"],
		};
	});
}

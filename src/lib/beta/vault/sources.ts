import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { searchQuery } from "@/lib/search-query";
import { getVerseText, parseTranslationId } from "@/lib/bible/translations";
import { HIGHLIGHT_COLORS } from "@/lib/highlights";
import { channelIdFor } from "@/lib/sermon-studies";
import { extractReferences } from "@/lib/shared-answer";
import { PLACEHOLDER_NOTE_TITLE } from "@/lib/study-context-format";
import { BETA_MODULES, betaModuleHref } from "@/lib/beta/modules";
import { searchBetaItems } from "@/lib/beta/store";
import { chipsFor, labelsFor, passagePrefilter, resolveVaultReference, scanText, vaultBookName, type VaultPassage } from "@/lib/beta/vault/passages";
import {
	clip,
	excerptAround,
	keysForReferences,
	plainMarkdown,
	refsTouch,
	vaultRefKey,
	type VaultEntry,
	type VaultKind,
	type VaultMatch,
} from "@/lib/beta/vault/vault-rules";

/**
 * The Knowledge Vault's readers (docs/beta/vault.md): one per kind of study,
 * each reading SureWord's own tables in place, scoped to one owner, into the
 * shared `VaultEntry` shape. Nothing here writes.
 *
 * Every reader takes the same query. Words are Postgres full-text (English
 * stemming), a topic is a label or a phrase, and a passage is matched in two
 * steps for prose (a cheap regex on the book and chapter in SQL, then the
 * real reference scan here), and structurally for everything that stores its
 * coordinates (highlights, reading, verses being learned, beta items).
 */

export interface SourceQuery {
	userId: string;
	range: { since: Date | null; until: Date | null };
	passage: VaultPassage | null;
	topic: string | null;
	/** Full-text: what the search box holds ("web"), or a question's terms ORed ("or"). */
	words: { kind: "web" | "or"; value: string } | null;
	/** Words to centre excerpts on: the search terms, the topic, or the passage's name. */
	needles: string[];
	/** Hydrate only these source ids (meaning-search hits), whatever the words say. */
	ids?: string[];
	limit: number;
	/** Longer excerpts for the over-time view; cards default to about 260 characters. */
	excerptChars?: number;
}

const SCAN_CHARS = 60_000;

function tsquery(words: SourceQuery["words"]): Prisma.Sql | null {
	if (!words) return null;
	return words.kind === "web"
		? Prisma.sql`websearch_to_tsquery('english', ${words.value})`
		: Prisma.sql`to_tsquery('english', ${words.value})`;
}

function rangeSql(column: Prisma.Sql, range: SourceQuery["range"]): Prisma.Sql[] {
	const out: Prisma.Sql[] = [];
	if (range.since) out.push(Prisma.sql`${column} >= ${range.since}`);
	if (range.until) out.push(Prisma.sql`${column} <= ${range.until}`);
	return out;
}

const and = (parts: Prisma.Sql[]) => Prisma.join(parts, " AND ");

function matchedBy(q: SourceQuery, extra: VaultMatch[] = []): VaultMatch[] {
	const out: VaultMatch[] = [...extra];
	if (q.words && !q.ids) out.push("words");
	if (q.passage) out.push("passage");
	if (q.topic) out.push("topic");
	return [...new Set(out)];
}

/** Whether a whole-text reader should keep a row once its references are known. */
function keepForPassage(q: SourceQuery, refs: string[]): boolean {
	return !q.passage || refsTouch(refs, q.passage.key);
}

/** Rows to fetch so a passage's SQL prefilter leaves enough after the real scan. */
function overfetch(q: SourceQuery): number {
	return q.passage ? q.limit * 3 : q.limit;
}

function readerHref(book: number, chapter: number, verse?: number | null, translation?: string | null): string {
	const params = new URLSearchParams({ book: String(book), chapter: String(chapter) });
	if (verse) params.set("verse", String(verse));
	if (translation) params.set("translation", translation);
	return `/bible/chapter?${params.toString()}`;
}

function reference(book: number, chapter: number, verse?: number): string {
	return `${vaultBookName(book) ?? `Book ${book}`} ${chapter}${verse ? `:${verse}` : ""}`;
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

type NoteRow = { id: string; title: string; text: string; createdAt: Date; updatedAt: Date; rank: number };

export async function readNotes(q: SourceQuery): Promise<VaultEntry[]> {
	const vector = Prisma.sql`to_tsvector('english', n."title" || ' ' || n."plainText")`;
	const words = tsquery(q.words);
	const where: Prisma.Sql[] = [
		Prisma.sql`n."userId" = ${q.userId}`,
		// A blank note still carrying the placeholder title is an abandoned tap, not study.
		Prisma.sql`NOT (btrim(n."plainText") = '' AND (btrim(n."title") = '' OR lower(n."title") = ${PLACEHOLDER_NOTE_TITLE.toLowerCase()}))`,
		...rangeSql(Prisma.sql`n."updatedAt"`, q.range),
	];
	if (q.ids) where.push(Prisma.sql`n."id" = ANY(${q.ids}::text[])`);
	else if (words) where.push(Prisma.sql`${vector} @@ ${words}`);
	if (q.topic) {
		where.push(Prisma.sql`(EXISTS (SELECT 1 FROM "NoteTag" nt JOIN "Tag" t ON t."id" = nt."tagId" WHERE nt."noteId" = n."id" AND lower(t."name") = ${q.topic})
			OR ${vector} @@ phraseto_tsquery('english', ${q.topic}))`);
	}
	if (q.passage) where.push(Prisma.sql`(n."title" || ' ' || n."plainText") ~* ${passagePrefilter(q.passage)}`);
	const rank = words && !q.ids ? Prisma.sql`ts_rank_cd(${vector}, ${words})` : Prisma.sql`0`;
	const rows = await searchQuery<NoteRow>(Prisma.sql`
		SELECT n."id", n."title", left(n."plainText", ${SCAN_CHARS}::int) AS "text", n."createdAt", n."updatedAt", (${rank})::float8 AS "rank"
		FROM "Note" n WHERE ${and(where)}
		ORDER BY "rank" DESC, n."updatedAt" DESC LIMIT ${overfetch(q)}
	`);
	const kept = rows
		.map((row) => ({ row, refs: scanText(`${row.title}\n${row.text}`) }))
		.filter(({ refs }) => keepForPassage(q, refs))
		.slice(0, q.limit);
	if (!kept.length) return [];
	const ids = kept.map(({ row }) => row.id);
	const [tags, outgoing, incoming] = await Promise.all([
		prisma.noteTag.findMany({ where: { noteId: { in: ids } }, select: { noteId: true, tag: { select: { name: true } } } }),
		prisma.noteLink.findMany({ where: { sourceNoteId: { in: ids }, userId: q.userId }, select: { sourceNoteId: true, targetTitle: true } }),
		prisma.noteLink.findMany({ where: { targetNoteId: { in: ids }, userId: q.userId }, select: { targetNoteId: true, source: { select: { title: true } } } }),
	]);
	return kept.map(({ row, refs }) => ({
		id: `note:${row.id}`,
		kind: "note" as const,
		sourceId: row.id,
		title: row.title.trim() || PLACEHOLDER_NOTE_TITLE,
		excerpt: excerptAround(row.text, q.needles, q.excerptChars ?? 260),
		date: row.updatedAt.toISOString(),
		startedAt: row.createdAt.toISOString(),
		href: `/notes?note=${encodeURIComponent(row.id)}`,
		refs,
		passages: chipsFor(refs),
		topics: tags.filter((t) => t.noteId === row.id).map((t) => t.tag.name.trim().toLowerCase()).filter(Boolean),
		links: {
			outgoing: [...new Set(outgoing.filter((l) => l.sourceNoteId === row.id).map((l) => l.targetTitle))].slice(0, 12),
			incoming: [...new Set(incoming.filter((l) => l.targetNoteId === row.id).map((l) => l.source.title))].slice(0, 12),
		},
		matched: matchedBy(q),
	}));
}

// ---------------------------------------------------------------------------
// Highlights and verses being learned (both one verse each, text from the bundle)
// ---------------------------------------------------------------------------

type HighlightLabels = Record<string, string>;

async function highlightLabels(userId: string): Promise<HighlightLabels> {
	const user = await prisma.user.findUnique({ where: { id: userId }, select: { highlightLabels: true } });
	const raw = user?.highlightLabels;
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
	const out: HighlightLabels = {};
	for (const [key, value] of Object.entries(raw)) if (typeof value === "string" && value.trim()) out[key.toLowerCase()] = value.trim();
	return out;
}

function colorName(hex: string): string | null {
	return HIGHLIGHT_COLORS.find((color) => color.hex.toLowerCase() === hex.toLowerCase())?.name ?? null;
}

async function verseText(translation: string, book: number, chapter: number, verse: number, kjv: string | null): Promise<string | null> {
	const id = parseTranslationId(translation);
	if (id === "KJV" && kjv) return kjv;
	return (await getVerseText(id, book, chapter, verse).catch(() => undefined)) ?? kjv ?? null;
}

function verseWhere(alias: string, q: SourceQuery): Prisma.Sql[] {
	const col = (name: string) => Prisma.raw(`${alias}."${name}"`);
	const out: Prisma.Sql[] = [];
	if (q.passage) {
		out.push(Prisma.sql`${col("book")} = ${q.passage.book}`);
		if (q.passage.chapter !== undefined) out.push(Prisma.sql`${col("chapter")} = ${q.passage.chapter}`);
		if (q.passage.verse !== undefined) out.push(Prisma.sql`${col("verse")} = ${q.passage.verse}`);
	}
	return out;
}

type HighlightRow = { id: string; translation: string; book: number; chapter: number; verse: number; color: string; createdAt: Date; updatedAt: Date; kjv: string | null; rank: number };

export async function readHighlights(q: SourceQuery): Promise<VaultEntry[]> {
	const labels = await highlightLabels(q.userId);
	const vector = Prisma.sql`to_tsvector('english', coalesce(k."text", ''))`;
	const words = tsquery(q.words);
	// A colour the person named ("Promises") is found by its name too.
	const labelHexes = (needle: (label: string) => boolean) =>
		HIGHLIGHT_COLORS.filter((color) => {
			const label = labels[color.name.toLowerCase()];
			return label && needle(label.toLowerCase());
		}).map((color) => color.hex.toUpperCase());
	const where: Prisma.Sql[] = [Prisma.sql`h."userId" = ${q.userId}`, ...rangeSql(Prisma.sql`h."updatedAt"`, q.range), ...verseWhere("h", q)];
	if (q.ids) where.push(Prisma.sql`h."id" = ANY(${q.ids}::text[])`);
	else if (words) {
		const terms = q.needles.map((needle) => needle.toLowerCase());
		const hexes = labelHexes((label) => terms.some((term) => term.length > 2 && label.includes(term)));
		where.push(hexes.length ? Prisma.sql`(${vector} @@ ${words} OR upper(h."color") = ANY(${hexes}::text[]))` : Prisma.sql`${vector} @@ ${words}`);
	}
	if (q.topic) {
		const hexes = labelHexes((label) => label === q.topic);
		where.push(hexes.length ? Prisma.sql`(upper(h."color") = ANY(${hexes}::text[]) OR ${vector} @@ phraseto_tsquery('english', ${q.topic}))` : Prisma.sql`${vector} @@ phraseto_tsquery('english', ${q.topic})`);
	}
	const rank = words && !q.ids ? Prisma.sql`ts_rank_cd(${vector}, ${words})` : Prisma.sql`0`;
	const rows = await searchQuery<HighlightRow>(Prisma.sql`
		SELECT h."id", h."translation", h."book", h."chapter", h."verse", h."color", h."createdAt", h."updatedAt", k."text" AS "kjv", (${rank})::float8 AS "rank"
		FROM "VerseHighlight" h LEFT JOIN "KjvVerse" k ON k."book" = h."book" AND k."chapter" = h."chapter" AND k."verse" = h."verse"
		WHERE ${and(where)}
		ORDER BY "rank" DESC, h."updatedAt" DESC LIMIT ${q.limit}
	`);
	return Promise.all(
		rows.map(async (row) => {
			const name = colorName(row.color);
			const label = name ? labels[name.toLowerCase()] ?? null : null;
			const text = await verseText(row.translation, row.book, row.chapter, row.verse, row.kjv);
			const refs = [vaultRefKey(row.book, row.chapter), vaultRefKey(row.book, row.chapter, row.verse)];
			return {
				id: `highlight:${row.id}`,
				kind: "highlight" as const,
				sourceId: row.id,
				title: reference(row.book, row.chapter, row.verse),
				excerpt: text ? clip(text, 320) : "",
				date: row.updatedAt.toISOString(),
				startedAt: row.createdAt.toISOString(),
				href: readerHref(row.book, row.chapter, row.verse, row.translation),
				refs,
				passages: chipsFor(refs),
				topics: label ? [label.toLowerCase()] : [],
				detail: [label ?? name, row.translation].filter(Boolean).join(" · "),
				matched: matchedBy(q),
			};
		}),
	);
}

type VerseRow = {
	id: string; book: number; chapter: number; verse: number; translation: string; knownAt: Date | null; dueAt: Date;
	lastReviewedAt: Date | null; createdAt: Date; kjv: string | null; rank: number;
};

export async function readVerses(q: SourceQuery): Promise<VaultEntry[]> {
	const vector = Prisma.sql`to_tsvector('english', coalesce(k."text", ''))`;
	const words = tsquery(q.words);
	const studied = Prisma.sql`coalesce(v."lastReviewedAt", v."createdAt")`;
	const where: Prisma.Sql[] = [Prisma.sql`v."userId" = ${q.userId}`, ...rangeSql(studied, q.range), ...verseWhere("v", q)];
	if (q.ids) where.push(Prisma.sql`v."id" = ANY(${q.ids}::text[])`);
	else if (words) where.push(Prisma.sql`${vector} @@ ${words}`);
	if (q.topic) where.push(Prisma.sql`${vector} @@ phraseto_tsquery('english', ${q.topic})`);
	const rank = words && !q.ids ? Prisma.sql`ts_rank_cd(${vector}, ${words})` : Prisma.sql`0`;
	const rows = await searchQuery<VerseRow>(Prisma.sql`
		SELECT v."id", v."book", v."chapter", v."verse", v."translation", v."knownAt", v."dueAt", v."lastReviewedAt", v."createdAt", k."text" AS "kjv", (${rank})::float8 AS "rank"
		FROM "VerseMemory" v LEFT JOIN "KjvVerse" k ON k."book" = v."book" AND k."chapter" = v."chapter" AND k."verse" = v."verse"
		WHERE ${and(where)}
		ORDER BY "rank" DESC, ${studied} DESC LIMIT ${q.limit}
	`);
	return Promise.all(
		rows.map(async (row) => {
			const text = await verseText(row.translation, row.book, row.chapter, row.verse, row.kjv);
			const refs = [vaultRefKey(row.book, row.chapter), vaultRefKey(row.book, row.chapter, row.verse)];
			return {
				id: `verse:${row.id}`,
				kind: "verse" as const,
				sourceId: row.id,
				title: reference(row.book, row.chapter, row.verse),
				excerpt: text ? clip(text, 320) : "",
				date: (row.lastReviewedAt ?? row.createdAt).toISOString(),
				startedAt: row.createdAt.toISOString(),
				href: "/bible/learn",
				refs,
				passages: chipsFor(refs),
				topics: [],
				detail: row.knownAt ? "Known by heart" : "Practising",
				matched: matchedBy(q),
			};
		}),
	);
}

// ---------------------------------------------------------------------------
// Chats
// ---------------------------------------------------------------------------

type MessageRow = {
	id: string; conversationId: string; role: string; content: string; metadata: unknown; createdAt: Date;
	title: string; chatCreatedAt: Date; rank: number;
};

export function messageRefs(row: { content: string; metadata?: unknown; role: string }): string[] {
	const fromText = scanText(row.content.slice(0, SCAN_CHARS));
	if (row.role !== "assistant" || !row.metadata) return fromText;
	const fromTools = keysForReferences(extractReferences(row.metadata), resolveVaultReference);
	return [...new Set([...fromText, ...fromTools])];
}

function chatExcerpt(row: { role: string; content: string }, needles: string[], chars = 240): string {
	return `${row.role === "user" ? "You asked: " : "SureWord: "}${excerptAround(plainMarkdown(row.content), needles, chars)}`;
}

/** One entry per conversation; searches find the best message in each. */
export async function readChats(q: SourceQuery): Promise<VaultEntry[]> {
	const words = tsquery(q.words);
	if (q.ids || (!words && !q.topic && !q.passage)) return readChatList(q);
	const vector = Prisma.sql`to_tsvector('english', m."content")`;
	const where: Prisma.Sql[] = [Prisma.sql`c."userId" = ${q.userId}`, ...rangeSql(Prisma.sql`m."createdAt"`, q.range)];
	if (words) where.push(Prisma.sql`${vector} @@ ${words}`);
	if (q.topic) where.push(Prisma.sql`${vector} @@ phraseto_tsquery('english', ${q.topic})`);
	if (q.passage) {
		const pattern = passagePrefilter(q.passage);
		where.push(Prisma.sql`(m."content" ~* ${pattern} OR (m."role" = 'assistant' AND m."metadata"::text ~* ${pattern}))`);
	}
	const rank = words ? Prisma.sql`ts_rank_cd(${vector}, ${words})` : Prisma.sql`0`;
	const rows = await searchQuery<MessageRow>(Prisma.sql`
		SELECT m."id", m."conversationId", m."role", left(m."content", ${SCAN_CHARS}::int) AS "content",
			CASE WHEN m."role" = 'assistant' THEN m."metadata" END AS "metadata", m."createdAt",
			c."title", c."createdAt" AS "chatCreatedAt", (${rank})::float8 AS "rank"
		FROM "Message" m JOIN "Conversation" c ON c."id" = m."conversationId"
		WHERE ${and(where)}
		ORDER BY "rank" DESC, m."createdAt" DESC LIMIT ${q.limit * 5}
	`);
	const byChat = new Map<string, { best: MessageRow; refs: string[]; hits: number }>();
	for (const row of rows) {
		const refs = messageRefs(row);
		if (!keepForPassage(q, refs)) continue;
		const seen = byChat.get(row.conversationId);
		if (seen) {
			seen.hits++;
			seen.refs = [...new Set([...seen.refs, ...refs])];
			continue;
		}
		if (byChat.size >= q.limit) continue;
		byChat.set(row.conversationId, { best: row, refs, hits: 1 });
	}
	return [...byChat.values()].map(({ best, refs }) => ({
		id: `chat:${best.conversationId}`,
		kind: "chat" as const,
		sourceId: best.conversationId,
		title: best.title.trim() || "Chat",
		excerpt: chatExcerpt(best, q.needles, q.excerptChars ?? 240),
		date: best.createdAt.toISOString(),
		startedAt: best.chatCreatedAt.toISOString(),
		href: `/c/${encodeURIComponent(best.conversationId)}`,
		refs,
		passages: chipsFor(refs),
		topics: [],
		matched: matchedBy(q),
	}));
}

type ChatListRow = { id: string; title: string; createdAt: Date; last: Date; messages: number };
type FirstQuestionRow = { conversationId: string; content: string };

async function readChatList(q: SourceQuery): Promise<VaultEntry[]> {
	const where: Prisma.Sql[] = [Prisma.sql`c."userId" = ${q.userId}`];
	if (q.ids) where.push(Prisma.sql`c."id" = ANY(${q.ids}::text[])`);
	const having = rangeSql(Prisma.sql`max(m."createdAt")`, q.range);
	const rows = await searchQuery<ChatListRow>(Prisma.sql`
		SELECT c."id", c."title", c."createdAt", max(m."createdAt") AS "last", count(m."id")::int AS "messages"
		FROM "Conversation" c JOIN "Message" m ON m."conversationId" = c."id"
		WHERE ${and(where)}
		GROUP BY c."id"
		${having.length ? Prisma.sql`HAVING ${and(having)}` : Prisma.empty}
		ORDER BY "last" DESC LIMIT ${q.limit}
	`);
	if (!rows.length) return [];
	const firsts = await searchQuery<FirstQuestionRow>(Prisma.sql`
		SELECT DISTINCT ON (m."conversationId") m."conversationId", left(m."content", 2000) AS "content"
		FROM "Message" m WHERE m."conversationId" = ANY(${rows.map((row) => row.id)}::text[]) AND m."role" = 'user'
		ORDER BY m."conversationId", m."createdAt" ASC
	`);
	const first = new Map(firsts.map((row) => [row.conversationId, row.content]));
	return rows.map((row) => {
		const question = first.get(row.id) ?? "";
		const refs = scanText(`${row.title}\n${question}`);
		return {
			id: `chat:${row.id}`,
			kind: "chat" as const,
			sourceId: row.id,
			title: row.title.trim() || "Chat",
			excerpt: question ? `You asked: ${clip(question, 220)}` : "",
			date: row.last.toISOString(),
			startedAt: row.createdAt.toISOString(),
			href: `/c/${encodeURIComponent(row.id)}`,
			refs,
			passages: chipsFor(refs),
			topics: [],
			detail: `${row.messages} message${row.messages === 1 ? "" : "s"}`,
			matched: q.ids ? ["meaning" as const] : matchedBy(q),
		};
	});
}

// ---------------------------------------------------------------------------
// Reading (one entry per day read)
// ---------------------------------------------------------------------------

type ReadingRow = { localDate: string; at: Date; chapters: number[] };

export async function readReading(q: SourceQuery): Promise<VaultEntry[]> {
	// Reading has no words of its own: it answers passage and date questions only.
	if ((q.words && !q.ids) || q.topic) return [];
	const where: Prisma.Sql[] = [Prisma.sql`r."userId" = ${q.userId}`, Prisma.sql`r."deletedAt" IS NULL`, ...rangeSql(Prisma.sql`r."occurredAt"`, q.range)];
	if (q.ids) where.push(Prisma.sql`r."localDate" = ANY(${q.ids}::text[])`);
	if (q.passage) {
		where.push(Prisma.sql`r."book" = ${q.passage.book}`);
		if (q.passage.chapter !== undefined) where.push(Prisma.sql`r."chapter" = ${q.passage.chapter}`);
	}
	const rows = await searchQuery<ReadingRow>(Prisma.sql`
		SELECT r."localDate", max(r."occurredAt") AS "at", array_agg(DISTINCT r."book" * 1000 + r."chapter") AS "chapters"
		FROM "ReadingLogEntry" r WHERE ${and(where)}
		GROUP BY r."localDate" ORDER BY "at" DESC LIMIT ${q.limit}
	`);
	return rows.map((row) => {
		const chapters = [...row.chapters].sort((a, b) => a - b).map((code) => ({ book: Math.floor(code / 1000), chapter: code % 1000 }));
		const refs = chapters.map(({ book, chapter }) => vaultRefKey(book, chapter));
		const labels = labelsFor(refs, 8);
		const only = chapters.length === 1 ? chapters[0] : null;
		return {
			id: `reading:${row.localDate}`,
			kind: "reading" as const,
			sourceId: row.localDate,
			title: `Read ${labels.length > 2 ? `${labels.slice(0, 2).join(", ")} and more` : labels.join(" and ")}`,
			excerpt: labels.join(", "),
			date: row.at.toISOString(),
			href: only ? readerHref(only.book, only.chapter) : "/bible/history",
			refs,
			passages: chipsFor(refs, 8),
			topics: [],
			detail: `${chapters.length} chapter${chapters.length === 1 ? "" : "s"}`,
			matched: matchedBy(q),
		};
	});
}

// ---------------------------------------------------------------------------
// Memories
// ---------------------------------------------------------------------------

const MEMORY_LABEL: Record<string, string> = {
	profile: "About you",
	prayer: "Prayer request",
	study: "Study",
	preference: "Preference",
	general: "Memory",
};

type MemoryRow = { id: string; content: string; category: string; status: string | null; createdAt: Date; updatedAt: Date; rank: number };

export async function readMemories(q: SourceQuery): Promise<VaultEntry[]> {
	const vector = Prisma.sql`to_tsvector('english', u."content")`;
	const words = tsquery(q.words);
	const where: Prisma.Sql[] = [Prisma.sql`u."userId" = ${q.userId}`, ...rangeSql(Prisma.sql`u."updatedAt"`, q.range)];
	if (q.ids) where.push(Prisma.sql`u."id" = ANY(${q.ids}::text[])`);
	else if (words) where.push(Prisma.sql`${vector} @@ ${words}`);
	if (q.topic) where.push(Prisma.sql`${vector} @@ phraseto_tsquery('english', ${q.topic})`);
	if (q.passage) where.push(Prisma.sql`u."content" ~* ${passagePrefilter(q.passage)}`);
	const rank = words && !q.ids ? Prisma.sql`ts_rank_cd(${vector}, ${words})` : Prisma.sql`0`;
	const rows = await searchQuery<MemoryRow>(Prisma.sql`
		SELECT u."id", u."content", u."category", u."status", u."createdAt", u."updatedAt", (${rank})::float8 AS "rank"
		FROM "UserMemory" u WHERE ${and(where)}
		ORDER BY "rank" DESC, u."updatedAt" DESC LIMIT ${overfetch(q)}
	`);
	return rows
		.map((row) => ({ row, refs: scanText(row.content) }))
		.filter(({ refs }) => keepForPassage(q, refs))
		.slice(0, q.limit)
		.map(({ row, refs }) => ({
			id: `memory:${row.id}`,
			kind: "memory" as const,
			sourceId: row.id,
			title: clip(row.content, 90),
			// A short memory is all title; a long one keeps its whole text beneath.
			excerpt: row.content.replace(/\s+/g, " ").trim().length > 90 ? clip(row.content, Math.max(500, q.excerptChars ?? 0)) : "",
			date: row.updatedAt.toISOString(),
			startedAt: row.createdAt.toISOString(),
			href: "/settings#memory",
			refs,
			passages: chipsFor(refs),
			topics: [],
			detail: [MEMORY_LABEL[row.category] ?? "Memory", row.category === "prayer" && row.status ? row.status : null].filter(Boolean).join(" · "),
			matched: matchedBy(q),
		}));
}

// ---------------------------------------------------------------------------
// Sermon studies from the reader's church
// ---------------------------------------------------------------------------

type SermonRow = {
	id: string; title: string; serviceDate: Date | null; preacher: string | null; preachingText: string | null;
	bigIdea: string; summary: string; passages: string | null; createdAt: Date; rank: number;
};

export async function readSermons(q: SourceQuery): Promise<VaultEntry[]> {
	const channelId = await channelIdFor(q.userId);
	if (!channelId) return [];
	const vector = Prisma.sql`to_tsvector('english', s."title" || ' ' || s."bigIdea" || ' ' || s."summary" || ' ' || s."application" || ' ' || coalesce(s."preachingText", ''))`;
	const words = tsquery(q.words);
	const studied = Prisma.sql`coalesce(s."serviceDate", s."createdAt")`;
	const where: Prisma.Sql[] = [Prisma.sql`s."channelId" = ${channelId}`, ...rangeSql(studied, q.range)];
	if (q.ids) where.push(Prisma.sql`s."id" = ANY(${q.ids}::text[])`);
	else if (words) where.push(Prisma.sql`${vector} @@ ${words}`);
	if (q.topic) where.push(Prisma.sql`${vector} @@ phraseto_tsquery('english', ${q.topic})`);
	if (q.passage) where.push(Prisma.sql`(coalesce(s."preachingText", '') || ' ' || s."sections"::text) ~* ${passagePrefilter(q.passage)}`);
	const rank = words && !q.ids ? Prisma.sql`ts_rank_cd(${vector}, ${words})` : Prisma.sql`0`;
	const rows = await searchQuery<SermonRow>(Prisma.sql`
		SELECT s."id", s."title", s."serviceDate", s."preacher", s."preachingText", s."bigIdea", left(s."summary", 4000) AS "summary",
			(SELECT string_agg(sec->>'passage', '; ') FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s."sections") = 'array' THEN s."sections" ELSE '[]'::jsonb END) sec) AS "passages",
			s."createdAt", (${rank})::float8 AS "rank"
		FROM "SermonStudy" s WHERE ${and(where)}
		ORDER BY "rank" DESC, ${studied} DESC LIMIT ${overfetch(q)}
	`);
	return rows
		.map((row) => ({ row, refs: scanText(`${row.preachingText ?? ""}; ${row.passages ?? ""}`) }))
		.filter(({ refs }) => keepForPassage(q, refs))
		.slice(0, q.limit)
		.map(({ row, refs }) => ({
			id: `sermon:${row.id}`,
			kind: "sermon" as const,
			sourceId: row.id,
			title: row.title,
			excerpt: excerptAround(`${row.bigIdea} ${row.summary}`, q.needles, q.excerptChars ?? 260),
			date: (row.serviceDate ?? row.createdAt).toISOString(),
			href: `/sermons/${encodeURIComponent(row.id)}`,
			refs,
			passages: chipsFor(refs),
			topics: [],
			detail: [row.preacher, row.preachingText].filter(Boolean).join(" · ") || null,
			matched: matchedBy(q),
		}));
}

// ---------------------------------------------------------------------------
// Beta studies (every module's items in the shared store)
// ---------------------------------------------------------------------------

export function moduleTitle(slug: string): string {
	return BETA_MODULES.find((entry) => entry.slug === slug)?.title ?? slug;
}

export function moduleItemHref(slug: string, id: string): string {
	const entry = BETA_MODULES.find((candidate) => candidate.slug === slug);
	return entry ? `${betaModuleHref(entry)}?item=${encodeURIComponent(id)}` : "/beta";
}

export async function readStudies(q: SourceQuery): Promise<VaultEntry[]> {
	const prefix = q.passage ? (q.passage.chapter === undefined ? String(q.passage.book) : vaultRefKey(q.passage.book, q.passage.chapter)) : null;
	const hits = await searchBetaItems(q.userId, {
		ids: q.ids,
		since: q.range.since,
		until: q.range.until,
		words: q.ids ? null : q.words,
		topic: q.topic,
		refPrefix: prefix,
		take: q.limit,
	});
	return hits
		.filter((item) => keepForPassage(q, item.refs))
		.map((item) => ({
			id: `study:${item.id}`,
			kind: "study" as const,
			sourceId: item.id,
			title: item.title,
			excerpt: item.body ? excerptAround(item.body, q.needles, q.excerptChars ?? 260) : "",
			date: item.updatedAt.toISOString(),
			startedAt: item.createdAt.toISOString(),
			href: moduleItemHref(item.module, item.id),
			refs: item.refs,
			passages: chipsFor(item.refs),
			topics: item.topics,
			module: item.module,
			detail: `${moduleTitle(item.module)} · ${item.kind.replace(/-/g, " ")}`,
			matched: matchedBy(q),
		}));
}

export const READERS: Record<VaultKind, (q: SourceQuery) => Promise<VaultEntry[]>> = {
	note: readNotes,
	highlight: readHighlights,
	chat: readChats,
	reading: readReading,
	verse: readVerses,
	memory: readMemories,
	sermon: readSermons,
	study: readStudies,
};

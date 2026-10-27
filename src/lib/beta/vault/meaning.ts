import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { searchQuery } from "@/lib/search-query";
import { noteChunkEmbeddings, queryEmbedding } from "@/lib/ai/embeddings";
import { chunkNoteText, EMBEDDING_DIMENSIONS, EMBEDDING_MODEL_ID, EMBEDDING_NAMESPACE } from "@/lib/embedding-index";
import { searchNoteEmbeddings } from "@/lib/note-embeddings";
import { hasCurrentAiConsent } from "@/lib/preferences-contract";
import { channelIdFor } from "@/lib/sermon-studies";
import { betaItemVersions, searchBetaItems } from "@/lib/beta/store";
import { clip, plainMarkdown, type VaultKind } from "@/lib/beta/vault/vault-rules";

/**
 * Meaning search for the Knowledge Vault (docs/beta/vault.md): pgvector, the
 * way SureWord already finds notes and verses.
 *
 * - Notes use their own index, `NoteEmbedding`, kept by every note write.
 * - Highlights and verses being learned use `VerseEmbedding`, restricted to the
 *   owner's own verses, so "the Comforter" finds a highlighted John 14:26.
 * - Chats, memories, sermon studies and beta items have no vectors anywhere,
 *   so the Vault keeps `VaultEmbedding` for them: vectors only, fingerprinted
 *   per source. It is brought up to date only when the owner searches or asks
 *   (never by a job), a bounded batch at a time, and only for an account that
 *   has agreed to AI, because indexing sends their words to the embedding model.
 */

export type IndexKind = "chat" | "memory" | "sermon" | "study";
export const INDEX_KINDS: readonly IndexKind[] = ["chat", "memory", "sermon", "study"];

/** Chunks embedded per request: one call to the embedding model, a few seconds. */
const INDEX_BATCH_CHUNKS = 160;
/** Sources read per request before the chunk budget is applied (a long chat is many chunks). */
const INDEX_BATCH_SOURCES = 40;
/** How closely a hit must match to count; text-embedding-3-large scores unrelated text near 0.1-0.2. */
export const MEANING_FLOOR = 0.3;
const ANSWER_CHARS = 700;

interface SourceVersion {
	kind: IndexKind;
	sourceId: string;
	hash: string;
	at: number;
}

const fingerprint = (kind: IndexKind, parts: unknown[]) =>
	createHash("sha256").update(JSON.stringify([EMBEDDING_NAMESPACE, kind, ...parts])).digest("hex").slice(0, 32);

async function currentVersions(userId: string): Promise<SourceVersion[]> {
	const channelId = await channelIdFor(userId);
	const [chats, memories, sermons, items] = await Promise.all([
		searchQuery<{ id: string; title: string; n: number; len: number; last: Date }>(Prisma.sql`
			SELECT c."id", c."title", count(m."id")::int AS "n", coalesce(sum(length(m."content")), 0)::int AS "len", max(m."createdAt") AS "last"
			FROM "Conversation" c JOIN "Message" m ON m."conversationId" = c."id"
			WHERE c."userId" = ${userId} GROUP BY c."id"
		`),
		prisma.userMemory.findMany({ where: { userId }, select: { id: true, updatedAt: true, content: true } }),
		channelId
			? prisma.sermonStudy.findMany({ where: { channelId }, select: { id: true, updatedAt: true }, orderBy: [{ serviceDate: "desc" }, { createdAt: "desc" }], take: 200 })
			: Promise.resolve([]),
		betaItemVersions(userId),
	]);
	return [
		...chats.map((c) => ({ kind: "chat" as const, sourceId: c.id, hash: fingerprint("chat", [c.title, c.n, c.len, c.last.getTime()]), at: c.last.getTime() })),
		...memories.map((m) => ({ kind: "memory" as const, sourceId: m.id, hash: fingerprint("memory", [m.content]), at: m.updatedAt.getTime() })),
		...sermons.map((s) => ({ kind: "sermon" as const, sourceId: s.id, hash: fingerprint("sermon", [s.updatedAt.getTime()]), at: s.updatedAt.getTime() })),
		...items.map((i) => ({ kind: "study" as const, sourceId: i.id, hash: fingerprint("study", [i.updatedAt.getTime()]), at: i.updatedAt.getTime() })),
	];
}

/** The words a source is indexed by (and a hit's excerpt is cut from), rebuilt from the source itself. */
async function indexTexts(userId: string, kind: IndexKind, ids: string[]): Promise<Map<string, { title: string; body: string }>> {
	const out = new Map<string, { title: string; body: string }>();
	if (!ids.length) return out;
	if (kind === "chat") {
		const chats = await prisma.conversation.findMany({
			where: { userId, id: { in: ids } },
			select: { id: true, title: true, messages: { orderBy: { createdAt: "asc" }, select: { role: true, content: true }, take: 400 } },
		});
		for (const chat of chats) {
			// Questions whole, answers by their opening: what was studied, within the chunk budget.
			const turns = chat.messages.map((m) => (m.role === "user" ? `You asked: ${m.content.trim()}` : `SureWord answered: ${clip(plainMarkdown(m.content), ANSWER_CHARS)}`));
			out.set(chat.id, { title: chat.title, body: turns.join("\n\n") });
		}
	} else if (kind === "memory") {
		const rows = await prisma.userMemory.findMany({ where: { userId, id: { in: ids } }, select: { id: true, category: true, content: true } });
		for (const row of rows) out.set(row.id, { title: "", body: row.content });
	} else if (kind === "sermon") {
		const channelId = await channelIdFor(userId);
		if (!channelId) return out;
		const rows = await prisma.sermonStudy.findMany({
			where: { channelId, id: { in: ids } },
			select: { id: true, title: true, preachingText: true, bigIdea: true, summary: true, application: true, sections: true },
		});
		for (const row of rows) {
			const sections = Array.isArray(row.sections) ? (row.sections as { heading?: unknown; explanation?: unknown }[]) : [];
			const parts = [
				row.preachingText ? `Text: ${row.preachingText}` : "",
				row.bigIdea,
				row.summary,
				row.application,
				...sections.map((s) => `${typeof s.heading === "string" ? s.heading : ""}: ${typeof s.explanation === "string" ? clip(s.explanation, 400) : ""}`),
			];
			out.set(row.id, { title: row.title, body: parts.filter(Boolean).join("\n\n") });
		}
	} else {
		const items = await searchBetaItems(userId, { ids, take: ids.length });
		for (const item of items) out.set(item.id, { title: item.title, body: [item.topics.join(", "), item.body ?? ""].filter(Boolean).join("\n\n") });
	}
	return out;
}

export interface IndexStatus {
	/** Sources brought up to date by this call. */
	indexed: number;
	/** Sources still waiting; another call continues. */
	pending: number;
	/** False when the account has not agreed to AI: nothing is sent, words search still works. */
	allowed: boolean;
	failed?: boolean;
}

const running = new Map<string, Promise<IndexStatus>>();

/** One bounded step of bringing the owner's meaning index up to date. Concurrent calls share the work. */
export function refreshVaultIndex(userId: string): Promise<IndexStatus> {
	const existing = running.get(userId);
	if (existing) return existing;
	const job = refresh(userId).finally(() => running.delete(userId));
	running.set(userId, job);
	return job;
}

/** Whether the account has agreed to AI: meaning search sends its words (and a search's) to the embedding model. */
async function aiAllowed(userId: string): Promise<boolean> {
	const user = await prisma.user.findUnique({ where: { id: userId }, select: { aiConsentVersion: true, aiConsentAt: true } });
	return hasCurrentAiConsent(user);
}

async function refresh(userId: string): Promise<IndexStatus> {
	if (!(await aiAllowed(userId))) return { indexed: 0, pending: 0, allowed: false };

	const [current, stored] = await Promise.all([
		currentVersions(userId),
		prisma.$queryRaw<{ kind: string; sourceId: string; hash: string }[]>`
			SELECT "kind", "sourceId", min("sourceHash") AS "hash" FROM "VaultEmbedding" WHERE "userId" = ${userId} GROUP BY "kind", "sourceId"
		`,
	]);
	const live = new Map(current.map((v) => [`${v.kind}:${v.sourceId}`, v]));
	const storedHash = new Map(stored.map((row) => [`${row.kind}:${row.sourceId}`, row.hash]));

	// Sources that are gone (a deleted chat, a removed item) lose their vectors now.
	const gone = stored.filter((row) => !live.has(`${row.kind}:${row.sourceId}`));
	for (const kind of INDEX_KINDS) {
		const ids = gone.filter((row) => row.kind === kind).map((row) => row.sourceId);
		if (ids.length) await prisma.$executeRaw`DELETE FROM "VaultEmbedding" WHERE "userId" = ${userId} AND "kind" = ${kind} AND "sourceId" = ANY(${ids}::text[])`;
	}

	const todo = current.filter((v) => storedHash.get(`${v.kind}:${v.sourceId}`) !== v.hash).sort((a, b) => b.at - a.at);
	if (!todo.length) return { indexed: 0, pending: 0, allowed: true };

	// Newest first, until the batch is full.
	const candidates = todo.slice(0, INDEX_BATCH_SOURCES);
	const batch: { version: SourceVersion; chunks: string[] }[] = [];
	let chunkCount = 0;
	for (const kind of INDEX_KINDS) {
		const wanted = candidates.filter((v) => v.kind === kind);
		if (!wanted.length) continue;
		const texts = await indexTexts(userId, kind, wanted.map((v) => v.sourceId));
		for (const version of wanted) {
			const text = texts.get(version.sourceId);
			batch.push({ version, chunks: text ? chunkNoteText(text.title, text.body) : [] });
		}
	}
	batch.sort((a, b) => b.version.at - a.version.at);
	const taken: typeof batch = [];
	for (const entry of batch) {
		if (chunkCount + entry.chunks.length > INDEX_BATCH_CHUNKS && taken.length) break;
		taken.push(entry);
		chunkCount += entry.chunks.length;
	}

	const allChunks = taken.flatMap((entry) => entry.chunks);
	let vectors: number[][] = [];
	try {
		vectors = allChunks.length ? await noteChunkEmbeddings(allChunks) : [];
	} catch (error) {
		// Provider errors can carry the text; only the category is logged.
		console.error("[beta/vault] indexing failed; words search still works.", error instanceof Error ? error.name : "UnknownError");
		return { indexed: 0, pending: todo.length, allowed: true, failed: true };
	}

	let offset = 0;
	await prisma.$transaction(async (tx) => {
		await tx.$executeRaw`SET LOCAL statement_timeout = '15000ms'`;
		for (const { version, chunks } of taken) {
			await tx.$executeRaw`DELETE FROM "VaultEmbedding" WHERE "userId" = ${userId} AND "kind" = ${version.kind} AND "sourceId" = ${version.sourceId}`;
			if (!chunks.length) continue;
			const rows = chunks.map((_, i) => {
				const vector = vectors[offset + i];
				return Prisma.sql`(${userId}, ${version.kind}, ${version.sourceId}, ${i}, ${version.hash}, ${`[${vector.join(",")}]`}::halfvec(3072), ${EMBEDDING_MODEL_ID}, ${EMBEDDING_DIMENSIONS})`;
			});
			offset += chunks.length;
			await tx.$executeRaw`
				INSERT INTO "VaultEmbedding" ("userId", "kind", "sourceId", "chunk", "sourceHash", "embedding", "modelId", "dimensions")
				VALUES ${Prisma.join(rows)}
				ON CONFLICT ("userId", "kind", "sourceId", "chunk") DO UPDATE SET "sourceHash" = EXCLUDED."sourceHash", "embedding" = EXCLUDED."embedding"
			`;
		}
	}, { maxWait: 5000, timeout: 30000 });

	// A source with no words keeps no rows and is offered again next time; the
	// client stops continuing once a step indexes nothing new.
	return { indexed: taken.filter((entry) => entry.chunks.length).length, pending: todo.length - taken.length, allowed: true };
}

export interface MeaningHit {
	kind: VaultKind;
	sourceId: string;
	similarity: number;
	/** The matching words, re-read from the source. */
	excerpt: string | null;
	/** Indexed sources: the whole chunk that matched, for finding the turn of a chat it came from. */
	chunkText?: string | null;
}

/**
 * The owner's sources closest in meaning to the query, best first, per kind
 * asked for. One query embedding serves every index. Nothing for an account
 * that has not agreed to AI; failures return nothing (words search still
 * answers), and never log the query.
 */
export async function meaningSearch(userId: string, query: string, kinds: readonly VaultKind[], limit = 12): Promise<MeaningHit[]> {
	const text = query.trim();
	if (!text || !(await aiAllowed(userId))) return [];
	let embedding: number[];
	try {
		embedding = await queryEmbedding(text);
	} catch (error) {
		console.error("[beta/vault] query embedding failed.", error instanceof Error ? error.name : "UnknownError");
		return [];
	}
	const vector = `[${embedding.join(",")}]`;
	const want = new Set(kinds);
	const jobs: Promise<MeaningHit[]>[] = [];

	if (want.has("note")) {
		jobs.push(
			searchNoteEmbeddings(userId, text, limit).then((hits) =>
				hits.map((hit) => ({ kind: "note" as const, sourceId: hit.noteId, similarity: hit.similarity, excerpt: hit.excerpt })),
			),
		);
	}
	for (const [kind, table] of [["highlight", "VerseHighlight"], ["verse", "VerseMemory"]] as const) {
		if (!want.has(kind)) continue;
		jobs.push(
			// The owner's verses first, then an exact distance for each: ordering the join by
			// the vector operator could let the planner walk VerseEmbedding's HNSW index across
			// the whole Bible and filter to this person's few verses afterwards, returning nothing.
			searchQuery<{ id: string; similarity: number }>(Prisma.sql`
				WITH q AS MATERIALIZED (SELECT ${vector}::halfvec(3072) AS e),
				mine AS MATERIALIZED (SELECT o."id", o."book", o."chapter", o."verse" FROM ${Prisma.raw(`"${table}"`)} o WHERE o."userId" = ${userId})
				SELECT mine."id", 1 - (v."embedding" <=> q.e) AS "similarity"
				FROM mine JOIN "VerseEmbedding" v ON v."book" = mine."book" AND v."chapter" = mine."chapter" AND v."verse" = mine."verse" CROSS JOIN q
				WHERE v."modelId" = ${EMBEDDING_MODEL_ID} AND v."dimensions" = ${EMBEDDING_DIMENSIONS}
				ORDER BY "similarity" DESC LIMIT ${limit}
			`).then((rows) => rows.map((row) => ({ kind, sourceId: row.id, similarity: Number(row.similarity) || 0, excerpt: null }))),
		);
	}
	const indexKinds = INDEX_KINDS.filter((kind) => want.has(kind));
	if (indexKinds.length) {
		jobs.push(
			(async () => {
				const rows = await searchQuery<{ kind: IndexKind; sourceId: string; chunk: number; similarity: number }>(Prisma.sql`
					WITH q AS MATERIALIZED (SELECT ${vector}::halfvec(3072) AS e),
					best AS (
						SELECT DISTINCT ON (e."kind", e."sourceId") e."kind", e."sourceId", e."chunk", e."embedding" <=> (SELECT e FROM q) AS "distance"
						FROM "VaultEmbedding" e
						WHERE e."userId" = ${userId} AND e."kind" = ANY(${indexKinds}::text[]) AND e."modelId" = ${EMBEDDING_MODEL_ID} AND e."dimensions" = ${EMBEDDING_DIMENSIONS}
						ORDER BY e."kind", e."sourceId", "distance", e."chunk"
					)
					SELECT "kind", "sourceId", "chunk", 1 - "distance" AS "similarity" FROM best ORDER BY "distance" LIMIT ${limit * 2}
				`);
				const kept = rows.map((row) => ({ ...row, similarity: Number(row.similarity) || 0 })).filter((row) => row.similarity >= MEANING_FLOOR);
				// Re-read each hit's words from its source, the chunk that matched.
				const out: MeaningHit[] = [];
				for (const kind of INDEX_KINDS) {
					const mine = kept.filter((row) => row.kind === kind);
					if (!mine.length) continue;
					const texts = await indexTexts(userId, kind, mine.map((row) => row.sourceId));
					for (const row of mine) {
						const source = texts.get(row.sourceId);
						if (!source) continue; // deleted since it was indexed
						const chunk = chunkNoteText(source.title, source.body)[row.chunk] ?? null;
						const withoutTitle = chunk && source.title && chunk.startsWith(source.title) ? chunk.slice(source.title.length).trim() : chunk;
						// Later chunks overlap the one before and can open mid-word; start at the next word.
						const body = withoutTitle && row.chunk > 0 ? `…${withoutTitle.replace(/^\S*\s+/, "")}` : withoutTitle;
						out.push({ kind, sourceId: row.sourceId, similarity: row.similarity, excerpt: body ? clip(body, 280) : null, chunkText: body });
					}
				}
				return out;
			})(),
		);
	}
	const settled = await Promise.allSettled(jobs);
	const hits: MeaningHit[] = [];
	for (const result of settled) {
		if (result.status === "fulfilled") hits.push(...result.value);
		else console.error("[beta/vault] a meaning index failed.", result.reason instanceof Error ? result.reason.name : "UnknownError");
	}
	return hits.filter((hit) => hit.similarity >= MEANING_FLOOR).sort((a, b) => b.similarity - a.similarity);
}

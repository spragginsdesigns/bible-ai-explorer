import { openai } from "@ai-sdk/openai";
import { embed, embedMany } from "ai";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Semantic index of the user's Bible study notes in Neon (pgvector table
 * "NoteEmbedding", beside the verse embeddings). Every note write path
 * re-embeds the note (upsert every chunk + drop the surplus trailing ones,
 * so the index never holds stale chunks); rows vanish with their note via
 * the FK cascade. All sync calls are fire-and-forget from the caller's
 * perspective - a failed sync only degrades search, never a note write.
 *
 * Existing notes are indexed by `scripts/backfill-note-embeddings.mjs`,
 * which mirrors the chunking here and must be kept in sync with it.
 */

const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 150;
const MAX_CHUNKS_PER_NOTE = 24;

const embeddingModel = openai.embedding("text-embedding-3-large");

function toVectorLiteral(vector: number[]): string {
	return `[${vector.join(",")}]`;
}

/**
 * Split a note into overlapping plain-text chunks, each prefixed with the
 * note's title so a chunk embeds what it is about, not just its words.
 */
export function chunkNoteText(title: string, plainText: string): string[] {
	const body = plainText.trim();
	const heading = title.trim();
	if (!body && !heading) return [];
	if (!body) return [heading];

	const chunks: string[] = [];
	let start = 0;
	while (start < body.length && chunks.length < MAX_CHUNKS_PER_NOTE) {
		let end = Math.min(start + CHUNK_SIZE, body.length);
		// Prefer to break on a paragraph or sentence boundary near the end.
		if (end < body.length) {
			const window = body.slice(start, end);
			const breakAt = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf(". "));
			if (breakAt > CHUNK_SIZE * 0.5) end = start + breakAt + 1;
		}
		const piece = body.slice(start, end).trim();
		if (piece) chunks.push(heading ? `${heading}\n\n${piece}` : piece);
		if (end >= body.length) break;
		start = end - CHUNK_OVERLAP;
	}
	return chunks;
}

/**
 * Re-index one note: replace all of its chunks with freshly embedded ones.
 *
 * Notes autosave every ~1.5s, so two syncs for the same note routinely
 * overlap. The old delete-then-insert pair was not safe under that race: the
 * second transaction's INSERT hit the ("noteId","chunk") primary key and died
 * with 23505, leaving the note's embeddings stale. Both statements below are
 * idempotent instead, and because a sync takes its row locks in ascending
 * chunk order starting at chunk 0, the loser of a race blocks on chunk 0
 * before holding any lock of its own - the two syncs serialize rather than
 * deadlock, and the last writer's chunk set wins completely.
 */
export async function syncNoteEmbeddings(note: {
	userId: string;
	noteId: string;
	title: string;
	plainText: string;
}): Promise<void> {
	try {
		const chunks = chunkNoteText(note.title, note.plainText);
		if (chunks.length === 0) {
			await prisma.$executeRaw`DELETE FROM "NoteEmbedding" WHERE "noteId" = ${note.noteId}`;
			return;
		}

		const { embeddings } = await embedMany({ model: embeddingModel, values: chunks });
		const values = Prisma.join(
			chunks.map(
				(text, i) =>
					Prisma.sql`(${note.noteId}, ${i}, ${note.userId}, ${text.slice(0, 2000)}, ${toVectorLiteral(embeddings[i])}::halfvec(3072))`
			)
		);
		await prisma.$transaction([
			prisma.$executeRaw`
				INSERT INTO "NoteEmbedding" ("noteId","chunk","userId","content","embedding")
				VALUES ${values}
				ON CONFLICT ("noteId","chunk") DO UPDATE SET
					"userId" = EXCLUDED."userId",
					"content" = EXCLUDED."content",
					"embedding" = EXCLUDED."embedding"
			`,
			prisma.$executeRaw`DELETE FROM "NoteEmbedding" WHERE "noteId" = ${note.noteId} AND "chunk" >= ${chunks.length}`,
		]);
	} catch (error) {
		console.error(`Failed to sync note embeddings for ${note.noteId}:`, error);
	}
}

export interface NoteChunkHit {
	noteId: string;
	excerpt: string;
	similarity: number;
}

/**
 * Semantic search over the user's note chunks. Returns at most one hit per
 * note (its best chunk). Failures degrade to an empty result so callers can
 * fall back to substring search.
 */
export async function searchNoteEmbeddings(
	userId: string,
	query: string,
	limit = 6
): Promise<NoteChunkHit[]> {
	try {
		const { embedding } = await embed({ model: embeddingModel, value: query });
		const literal = toVectorLiteral(embedding);
		const rows = await prisma.$queryRaw<
			{ noteId: string; content: string; similarity: number }[]
		>`
			SELECT DISTINCT ON ("noteId") "noteId", "content",
				1 - ("embedding" <=> ${literal}::halfvec(3072)) AS "similarity"
			FROM "NoteEmbedding"
			WHERE "userId" = ${userId}
			ORDER BY "noteId", "embedding" <=> ${literal}::halfvec(3072)
		`;
		return rows
			.map((row) => ({
				noteId: row.noteId,
				excerpt: row.content.slice(0, 240),
				similarity: Number(row.similarity) || 0,
			}))
			.sort((a, b) => b.similarity - a.similarity)
			.slice(0, limit);
	} catch (error) {
		console.error("Note embedding search failed:", error);
		return [];
	}
}

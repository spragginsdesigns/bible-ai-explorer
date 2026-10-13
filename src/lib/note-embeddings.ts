import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { queryEmbedding, noteChunkEmbeddings } from "@/lib/ai/embeddings";
import { chunkNoteText, noteEmbeddingHash, writeNoteIndex, EMBEDDING_MODEL_ID, EMBEDDING_DIMENSIONS, type NoteIndexSource } from "@/lib/embedding-index";
import { searchQuery } from "@/lib/search-query";

export { chunkNoteText } from "@/lib/embedding-index";

/** Identical autosaves share the work; every write still rechecks the source under a lock. */
const pending = new Map<string, Promise<void>>();

export async function syncNoteEmbeddings(note: NoteIndexSource): Promise<void> {
	const hash = noteEmbeddingHash(note.title, note.plainText);
	const key = JSON.stringify([note.userId, note.noteId, hash]);
	const existing = pending.get(key);
	if (existing) return existing;
	const job = (async () => {
		try {
			const current = await prisma.note.findFirst({
				where: { id: note.noteId, userId: note.userId },
				select: { title: true, plainText: true, embeddingSourceHash: true },
			});
			if (!current || noteEmbeddingHash(current.title, current.plainText ?? "") !== hash || current.embeddingSourceHash === hash) return;
			const chunks = chunkNoteText(note.title, note.plainText);
			const embeddings = chunks.length ? await noteChunkEmbeddings(chunks) : [];
			await writeNoteIndex(prisma, note, chunks, embeddings);
		} catch (error) {
			// Provider exceptions can carry the note text. Only log the failure category.
			console.error("Note indexing failed; keeping the existing index.", error instanceof Error ? error.name : "UnknownError");
		}
	})();
	pending.set(key, job);
	try { await job; } finally { if (pending.get(key) === job) pending.delete(key); }
}

export interface NoteChunkHit {
	noteId: string;
	excerpt: string;
	similarity: number;
}

/** Exact best chunk per note, then global ranking and SQL limit. Ownership precedes ranking. */
export async function searchNoteEmbeddings(userId: string, query: string, limit = 6, signal?: AbortSignal): Promise<NoteChunkHit[]> {
	try {
		limit = Math.min(50, Math.max(1, Math.trunc(limit) || 6));
		const embedding = await queryEmbedding(query, signal);
		signal?.throwIfAborted();
		const rows = await searchQuery<{ noteId: string; excerpt: string; similarity: number }>(Prisma.sql`
			WITH query_vector AS MATERIALIZED (SELECT ${`[${embedding.join(",")}]`}::halfvec(3072) AS embedding),
			best_chunks AS (
				SELECT DISTINCT ON (e."noteId") e."noteId", e."content",
					e."embedding" <=> (SELECT embedding FROM query_vector) AS distance
				FROM "NoteEmbedding" e JOIN "Note" n ON n."id" = e."noteId"
				WHERE n."userId" = ${userId} AND e."modelId" = ${EMBEDDING_MODEL_ID} AND e."dimensions" = ${EMBEDDING_DIMENSIONS}
				ORDER BY e."noteId", distance, e."chunk"
			)
			SELECT "noteId", left("content", 240) AS excerpt, 1 - distance AS similarity
			FROM best_chunks ORDER BY distance, "noteId" LIMIT ${limit}
		`);
		signal?.throwIfAborted();
		return rows.map(row => ({ ...row, similarity: Number(row.similarity) || 0 }));
	} catch (error) {
		if (signal?.aborted) throw signal.reason;
		console.error("Note search failed; falling back to text search.", error instanceof Error ? error.name : "UnknownError");
		return [];
	}
}

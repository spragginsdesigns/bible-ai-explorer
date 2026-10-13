import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";

/** One contract shared by the application and the native-Node backfills. */
export const EMBEDDING_MODEL_ID = "text-embedding-3-large";
export const EMBEDDING_DIMENSIONS = 3072;
export const EMBEDDING_NAMESPACE = `${EMBEDDING_MODEL_ID}:${EMBEDDING_DIMENSIONS}:1`;
const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 150;
const MAX_CHUNKS_PER_NOTE = 24;

export function noteEmbeddingHash(title: string, plainText: string): string {
	return createHash("sha256").update(JSON.stringify([EMBEDDING_NAMESPACE, title.trim(), plainText.trim()])).digest("hex");
}

export function chunkNoteText(title: string, plainText: string): string[] {
	const body = plainText.trim();
	const heading = title.trim();
	if (!body && !heading) return [];
	if (!body) return [heading];
	const chunks: string[] = [];
	let start = 0;
	while (start < body.length && chunks.length < MAX_CHUNKS_PER_NOTE) {
		let end = Math.min(start + CHUNK_SIZE, body.length);
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

export interface NoteIndexSource { userId: string; noteId: string; title: string; plainText: string }

/** Lock the source, not chunk zero: empty indexes and out-of-order jobs must serialize too. */
export function writeNoteIndex(client: PrismaClient, note: NoteIndexSource, chunks: string[], embeddings: number[][], options: { force?: boolean } = {}): Promise<"indexed" | "unchanged" | "stale"> {
	if (chunks.length !== embeddings.length || embeddings.some(vector => vector.length !== EMBEDDING_DIMENSIONS || vector.some(value => !Number.isFinite(value)))) {
		throw new Error("Invalid note vectors; keeping the existing index.");
	}
	const hash = noteEmbeddingHash(note.title, note.plainText);
	return client.$transaction(async tx => {
		await tx.$executeRaw`SET LOCAL statement_timeout = '8000ms'`;
		await tx.$executeRaw`SET LOCAL lock_timeout = '4000ms'`;
		const rows = await tx.$queryRaw<{ title: string; plainText: string; embeddingSourceHash: string | null }[]>`
			SELECT "title", COALESCE("plainText", '') AS "plainText", "embeddingSourceHash"
			FROM "Note" WHERE "id" = ${note.noteId} AND "userId" = ${note.userId} FOR UPDATE
		`;
		const current = rows[0];
		if (!current || noteEmbeddingHash(current.title, current.plainText) !== hash) return "stale";
		if (current.embeddingSourceHash === hash && !options.force) return "unchanged";
		if (chunks.length) {
			const values = Prisma.join(chunks.map((text, i) => Prisma.sql`
				(${note.noteId}, ${i}, ${note.userId}, ${text.slice(0, 2000)}, ${`[${embeddings[i].join(",")}]`}::halfvec(3072), ${EMBEDDING_MODEL_ID}, ${EMBEDDING_DIMENSIONS})
			`));
			await tx.$executeRaw`
				INSERT INTO "NoteEmbedding" ("noteId", "chunk", "userId", "content", "embedding", "modelId", "dimensions")
				VALUES ${values} ON CONFLICT ("noteId", "chunk") DO UPDATE SET
					"userId" = EXCLUDED."userId", "content" = EXCLUDED."content", "embedding" = EXCLUDED."embedding",
					"modelId" = EXCLUDED."modelId", "dimensions" = EXCLUDED."dimensions"
			`;
		}
		// Account rekeying cascades to Note, while the copied embedding userId can lag.
		await tx.$executeRaw`DELETE FROM "NoteEmbedding" e USING "Note" n WHERE e."noteId" = n."id" AND n."id" = ${note.noteId} AND n."userId" = ${note.userId} AND e."chunk" >= ${chunks.length}`;
		// Index maintenance is not a user edit; do not bump the note's updatedAt.
		await tx.$executeRaw`UPDATE "Note" SET "embeddingSourceHash" = ${hash} WHERE "id" = ${note.noteId} AND "userId" = ${note.userId}`;
		return "indexed";
	}, { maxWait: 5000, timeout: 10000 });
}

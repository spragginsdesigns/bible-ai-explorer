import { openai } from "@ai-sdk/openai";
import { embed, embedMany } from "ai";
import { EmbeddingCache, withAbortDeadline } from "./embedding-cache";
import { EMBEDDING_MODEL_ID, EMBEDDING_DIMENSIONS, EMBEDDING_NAMESPACE } from "@/lib/embedding-index";
export { EMBEDDING_MODEL_ID, EMBEDDING_DIMENSIONS, EMBEDDING_NAMESPACE, noteEmbeddingHash } from "@/lib/embedding-index";

/** Runtime, stored rows and backfills must agree on this vector space. */
const model = openai.embedding(EMBEDDING_MODEL_ID);
const queries = new EmbeddingCache();
export const queryEmbeddingCacheStats = queries.stats;

function checkVector(vector: number[]): number[] {
	if (vector.length !== EMBEDDING_DIMENSIONS || vector.some(value => !Number.isFinite(value))) {
		throw new Error("Embedding does not match the stored vector space.");
	}
	return vector;
}

export function queryEmbedding(query: string, signal?: AbortSignal): Promise<number[]> {
	return queries.get(EMBEDDING_NAMESPACE, query, async () => {
		const { embedding } = await withAbortDeadline(abortSignal => embed({ model, value: query, maxRetries: 1, abortSignal }), 8000);
		return checkVector(embedding);
	}, signal);
}

export async function noteChunkEmbeddings(chunks: string[]): Promise<number[][]> {
	const { embeddings } = await withAbortDeadline(abortSignal => embedMany({ model, values: chunks, maxRetries: 1, abortSignal }), 20000);
	if (embeddings.length !== chunks.length) throw new Error("Incomplete note embeddings.");
	return embeddings.map(checkVector);
}

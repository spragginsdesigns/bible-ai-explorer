import { openai } from "@ai-sdk/openai";
import { embed } from "ai";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getVerseText, type TranslationId } from "@/lib/bible/translations";
import { getKjvBookName } from "@/utils/kjvBible";
import { keywordSearchKjv } from "@/lib/bible/kjv";

export interface RetrievedVerse {
	reference: string;
	similarity: number;
	text?: string;
}

export interface ScriptureSearchResult {
	verses: RetrievedVerse[];
	averageSimilarity: number;
	/** Set when the vector store was unreachable and keyword matching filled in. */
	degraded?: boolean;
}

const embeddingModel = openai.embedding("text-embedding-3-large");

/** Keyword hits merged in beyond the vector results (exact-wording recall). */
const KEYWORD_MERGE_HITS = 2;

export async function retryWithExponentialBackoff<T>(
	operation: () => Promise<T>,
	maxRetries: number = 3,
	baseDelay: number = 1000
): Promise<T> {
	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			return await operation();
		} catch (error) {
			if (attempt === maxRetries) throw error;
			const delay = baseDelay * Math.pow(2, attempt - 1);
			console.warn(`Attempt ${attempt} failed. Retrying in ${delay}ms...`);
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
	}
	throw new Error("This should never be reached");
}

interface VerseCoordinates {
	book: number;
	chapter: number;
	verse: number;
	similarity: number;
}

function toVectorLiteral(vector: number[]): string {
	return `[${vector.join(",")}]`;
}

/**
 * The clients' match-strength badges (>0.75 Strong, >0.6 Moderate) were
 * calibrated against AstraDB, which reported cosine similarity as (1+cos)/2.
 * pgvector's `1 - cosine_distance` is the raw cosine, so convert to the same
 * scale rather than re-calibrating every client (old APKs included).
 */
function toAstraScale(rawCosine: number): number {
	return (1 + rawCosine) / 2;
}

/** Nearest verses to the query vector in the Neon pgvector index. */
async function vectorSearch(queryVector: number[], limit: number): Promise<VerseCoordinates[]> {
	const literal = toVectorLiteral(queryVector);
	const rows = await prisma.$queryRaw<
		{ book: number; chapter: number; verse: number; similarity: number }[]
	>`
		SELECT "book", "chapter", "verse",
			1 - ("embedding" <=> ${literal}::halfvec(3072)) AS "similarity"
		FROM "VerseEmbedding"
		ORDER BY "embedding" <=> ${literal}::halfvec(3072)
		LIMIT ${limit}
	`;
	return rows.map((row) => ({
		book: row.book,
		chapter: row.chapter,
		verse: row.verse,
		similarity: toAstraScale(Number(row.similarity) || 0),
	}));
}

/** True cosine similarity of specific verses against the query vector. */
async function similarityFor(
	queryVector: number[],
	coordinates: { book: number; chapter: number; verse: number }[]
): Promise<Map<string, number>> {
	if (coordinates.length === 0) return new Map();
	const literal = toVectorLiteral(queryVector);
	const tuples = Prisma.join(
		coordinates.map(
			(c) => Prisma.sql`(${c.book}::int, ${c.chapter}::int, ${c.verse}::int)`
		)
	);
	const rows = await prisma.$queryRaw<
		{ book: number; chapter: number; verse: number; similarity: number }[]
	>`
		SELECT "book", "chapter", "verse",
			1 - ("embedding" <=> ${literal}::halfvec(3072)) AS "similarity"
		FROM "VerseEmbedding"
		WHERE ("book", "chapter", "verse") IN (${tuples})
	`;
	return new Map(
		rows.map((row) => [
			`${row.book}:${row.chapter}:${row.verse}`,
			toAstraScale(Number(row.similarity) || 0),
		])
	);
}

/**
 * Semantic search over the KJV verse embeddings in Neon (pgvector), blended
 * with IDF-weighted keyword matches from the bundled KJV so half-remembered
 * exact wording is found even when embeddings miss it. Exact verse text is
 * looked up from the bundled corpus (or bolls.life for NKJV) so quotations
 * are never reconstructed from embeddings; `translation` only controls the
 * wording returned. If the vector store is unreachable, keyword matching
 * alone answers (degraded: true) rather than failing the tool.
 */
export async function searchScripture(
	query: string,
	limit: number = 5,
	translation: TranslationId = "KJV"
): Promise<ScriptureSearchResult> {
	const [vectorOutcome, keywordHits] = await Promise.all([
		(async () => {
			const { embedding } = await retryWithExponentialBackoff(() =>
				embed({ model: embeddingModel, value: query })
			);
			if (!Array.isArray(embedding) || embedding.length === 0) {
				throw new Error("Expected a non-empty vector from embedding.");
			}
			const hits = await retryWithExponentialBackoff(
				() => vectorSearch(embedding, limit),
				2
			);
			return { embedding, hits };
		})().catch((error) => {
			console.error("Scripture vector search failed; falling back to keywords:", error);
			return null;
		}),
		keywordSearchKjv(query, Math.max(limit, KEYWORD_MERGE_HITS)).catch(() => []),
	]);

	let coordinates: VerseCoordinates[];
	let degraded = false;

	if (!vectorOutcome) {
		// Vector store down: serve keyword matches alone rather than nothing.
		degraded = true;
		coordinates = keywordHits.slice(0, limit).map((hit) => ({
			book: hit.order,
			chapter: hit.chapter,
			verse: hit.verse,
			similarity: 0,
		}));
	} else {
		coordinates = [...vectorOutcome.hits];
		const seen = new Set(coordinates.map((c) => `${c.book}:${c.chapter}:${c.verse}`));
		const extras = keywordHits
			.filter((hit) => !seen.has(`${hit.order}:${hit.chapter}:${hit.verse}`))
			.slice(0, KEYWORD_MERGE_HITS)
			.map((hit) => ({ book: hit.order, chapter: hit.chapter, verse: hit.verse }));
		if (extras.length > 0) {
			// Score merged keyword hits honestly with their real cosine similarity.
			const scores = await similarityFor(vectorOutcome.embedding, extras).catch(
				() => new Map<string, number>()
			);
			for (const extra of extras) {
				coordinates.push({
					...extra,
					similarity: scores.get(`${extra.book}:${extra.chapter}:${extra.verse}`) ?? 0,
				});
			}
			coordinates.sort((a, b) => b.similarity - a.similarity);
		}
	}

	if (coordinates.length === 0) {
		return { verses: [], averageSimilarity: 0, ...(degraded ? { degraded } : {}) };
	}

	const verses: RetrievedVerse[] = await Promise.all(
		coordinates.map(async ({ book, chapter, verse, similarity }) => {
			const bookName = getKjvBookName(book) ?? `Book ${book}`;
			const reference = `${bookName} ${chapter}:${verse}`;
			const text = await getVerseText(translation, book, chapter, verse);

			return { reference, similarity, ...(text ? { text } : {}) };
		})
	);

	const averageSimilarity =
		verses.length > 0
			? verses.reduce((sum, v) => sum + v.similarity, 0) / verses.length
			: 0;

	return { verses, averageSimilarity, ...(degraded ? { degraded } : {}) };
}

/** Format retrieved verses for inclusion in a model prompt or tool result. */
export function formatVersesForModel(
	verses: RetrievedVerse[],
	translation: TranslationId = "KJV"
): string {
	if (verses.length === 0) return "No relevant Bible verses found.";
	return verses
		.map((verse) =>
			verse.text
				? `${verse.reference} ${translation}: "${verse.text}"`
				: `${verse.reference} ${translation} (reference only; do not quote)`
		)
		.join("\n");
}

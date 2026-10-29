import { Prisma } from "@prisma/client";
import { getChapter, type TranslationId } from "@/lib/bible/translations";
import { getKjvBookName } from "@/utils/kjvBible";
import { findVersesFullTextDetailed, type KeywordMatchCoverage } from "@/lib/bible/verse-fulltext";
import { searchWords } from "@/lib/bible/search-words";
import { queryEmbedding, EMBEDDING_MODEL_ID, EMBEDDING_DIMENSIONS } from "@/lib/ai/embeddings";
import { searchQuery } from "@/lib/search-query";

export interface RetrievedVerse {
	reference: string;
	similarity: number;
	text?: string;
	/** Absent on older saved conversations; never infer it from today's settings. */
	translation?: TranslationId;
}

export interface ScriptureSearchResult {
	/** Lexical candidate page; vector scores remain independently measured. */
	keywordCoverage?: KeywordMatchCoverage;
	verses: RetrievedVerse[];
	averageSimilarity: number;
	/** Set when the vector store was unreachable and keyword matching filled in. */
	degraded?: boolean;
}

/** Keyword hits merged in beyond the vector results (exact-wording recall). */
const KEYWORD_MERGE_HITS = 2;

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

/** One bound vector parameter, one HNSW scan, and honest scoring of keyword extras. */
async function vectorSearch(
	queryVector: number[],
	limit: number,
	keywords: { book: number; chapter: number; verse: number }[],
): Promise<VerseCoordinates[]> {
	const keywordQuery = keywords.length ? Prisma.sql`, keyword_hits AS (
		SELECT k.book, k.chapter, k.verse,
			e."embedding" <=> (SELECT embedding FROM query_vector) AS distance
		FROM (VALUES ${Prisma.join(keywords.map((k, i) => Prisma.sql`(${k.book}::int, ${k.chapter}::int, ${k.verse}::int, ${i}::int)`))})
			AS k(book, chapter, verse, position)
		LEFT JOIN "VerseEmbedding" e ON e."book" = k.book AND e."chapter" = k.chapter AND e."verse" = k.verse
			AND e."modelId" = ${EMBEDDING_MODEL_ID} AND e."dimensions" = ${EMBEDDING_DIMENSIONS}
		WHERE NOT EXISTS (SELECT 1 FROM vector_hits v WHERE (v.book, v.chapter, v.verse) = (k.book, k.chapter, k.verse))
		ORDER BY k.position LIMIT ${KEYWORD_MERGE_HITS}
	)` : Prisma.empty;
	const union = keywords.length ? Prisma.sql`UNION ALL SELECT * FROM keyword_hits` : Prisma.empty;
	const rows = await searchQuery<{ book: number; chapter: number; verse: number; distance: number | null; vectorCount: number }>(Prisma.sql`
		WITH query_vector AS MATERIALIZED (SELECT ${toVectorLiteral(queryVector)}::halfvec(3072) AS embedding),
		vector_hits AS MATERIALIZED (
			SELECT "book", "chapter", "verse", "embedding" <=> (SELECT embedding FROM query_vector) AS distance
			FROM "VerseEmbedding"
			WHERE "modelId" = ${EMBEDDING_MODEL_ID} AND "dimensions" = ${EMBEDDING_DIMENSIONS}
			ORDER BY "embedding" <=> (SELECT embedding FROM query_vector) LIMIT ${limit}
		) ${keywordQuery}
		SELECT hits.*, (SELECT count(*)::int FROM vector_hits) AS "vectorCount" FROM (SELECT * FROM vector_hits ${union}) hits
		ORDER BY distance NULLS LAST, book, chapter, verse
	`);
	if (!rows.length || rows[0].vectorCount === 0) throw new Error("The active embedding space has no indexed verses.");
	return rows.map(({ distance, vectorCount: _count, ...coordinates }) => ({
		...coordinates,
		similarity: distance === null ? 0 : toAstraScale(1 - Number(distance)),
	}));
}

/**
 * Semantic search over the KJV verse embeddings in Neon (pgvector), blended
 * with indexed keyword matches from Postgres so half-remembered
 * exact wording is found even when embeddings miss it. Exact verse text is
 * looked up from the bundled corpus (or bolls.life for NKJV) so quotations
 * are never reconstructed from embeddings; `translation` only controls the
 * wording returned. If the vector store is unreachable, keyword matching
 * alone answers (degraded: true) rather than failing the tool. Only bounded
 * matches are loaded; the AI path never scans the bundled whole Bible.
 */
export async function searchScripture(
	query: string,
	limit: number = 5,
	translation: TranslationId = "KJV",
	signal?: AbortSignal,
): Promise<ScriptureSearchResult> {
	signal?.throwIfAborted();
	limit = Math.min(20, Math.max(1, Math.trunc(limit) || 5));
	const [embedding, keywordSearch] = await Promise.all([
		queryEmbedding(query, signal).catch(() => null),
		// Hybrid recall explicitly permits partial wording; the exact-word tool stays strict.
		findVersesFullTextDetailed(searchWords(query), Math.max(limit, KEYWORD_MERGE_HITS), { allowPartial: true }).catch(() => null),
	]);
	signal?.throwIfAborted();
	const keywordHits = keywordSearch?.hits ?? [];
	let keywordCoverage = keywordSearch?.coverage;
	const vectorOutcome = embedding ? await vectorSearch(embedding, limit, keywordHits).catch(() => null) : null;
	signal?.throwIfAborted();

	let coordinates: VerseCoordinates[];
	let degraded = false;

	if (!vectorOutcome) {
		// Vector store down: serve keyword matches alone rather than nothing.
		degraded = true;
		if (keywordCoverage) keywordCoverage = { ...keywordCoverage, returnedCount: Math.min(keywordHits.length, limit), limit,
			truncated: keywordCoverage.truncated || keywordHits.length > limit };
		coordinates = keywordHits.slice(0, limit).map((hit) => ({
			book: hit.book,
			chapter: hit.chapter,
			verse: hit.verse,
			similarity: 0,
		}));
	} else {
		coordinates = vectorOutcome;
	}

	if (coordinates.length === 0) {
		return { verses: [], averageSimilarity: 0, ...(degraded ? { degraded } : {}), ...(keywordCoverage ? { keywordCoverage } : {}) };
	}

	const chapters = new Map<string, string[]>();
	await Promise.all([...new Map(coordinates.map(c => [`${c.book}:${c.chapter}`, c])).entries()].map(async ([key, c]) => {
		chapters.set(key, await getChapter(translation, c.book, c.chapter));
	}));
	signal?.throwIfAborted();
	const verses: RetrievedVerse[] = coordinates.map(({ book, chapter, verse, similarity }) => {
			const bookName = getKjvBookName(book) ?? `Book ${book}`;
			const reference = `${bookName} ${chapter}:${verse}`;
			const text = chapters.get(`${book}:${chapter}`)?.[verse - 1];

			return { reference, similarity, translation, ...(text ? { text } : {}) };
		});

	const averageSimilarity =
		verses.length > 0
			? verses.reduce((sum, v) => sum + v.similarity, 0) / verses.length
			: 0;

	return { verses, averageSimilarity, ...(degraded ? { degraded } : {}), ...(keywordCoverage ? { keywordCoverage } : {}) };
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

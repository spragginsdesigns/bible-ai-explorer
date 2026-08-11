import { openai } from "@ai-sdk/openai";
import { embed } from "ai";
import { astraDb } from "@/utils/astraDb";
import { getVerseText, type TranslationId } from "@/lib/bible/translations";
import { getKjvBookName } from "@/utils/kjvBible";

export interface RetrievedVerse {
	reference: string;
	similarity: number;
	text?: string;
}

export interface ScriptureSearchResult {
	verses: RetrievedVerse[];
	averageSimilarity: number;
}

const embeddingModel = openai.embedding("text-embedding-3-large");

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

function asPositiveInteger(value: unknown): number | undefined {
	const numberValue = typeof value === "number" ? value : Number(value);
	return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : undefined;
}

function asSimilarity(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toVerseCoordinates(doc: Record<string, unknown>): VerseCoordinates | undefined {
	const book = asPositiveInteger(doc.b);
	const chapter = asPositiveInteger(doc.c);
	const verse = asPositiveInteger(doc.v);

	if (!book || !chapter || !verse) return undefined;

	return {
		book,
		chapter,
		verse,
		similarity: asSimilarity(doc.$similarity),
	};
}

/**
 * Semantic search over the KJV verse embeddings in AstraDB. Exact verse text is
 * looked up from the bundled corpus (or bolls.life for NKJV) so quotations are
 * never reconstructed from embeddings. The embeddings themselves are
 * translation-agnostic enough to locate the right verses; `translation` only
 * controls which wording is returned.
 */
export async function searchScripture(
	query: string,
	limit: number = 5,
	translation: TranslationId = "KJV"
): Promise<ScriptureSearchResult> {
	const { embedding: queryVector } = await retryWithExponentialBackoff(() =>
		embed({ model: embeddingModel, value: query })
	);

	if (!Array.isArray(queryVector) || queryVector.length === 0) {
		throw new Error("Expected a non-empty vector from embedding.");
	}

	const collection = astraDb.collection("openai_embedding_collection");

	const results = await retryWithExponentialBackoff(() =>
		collection
			.find(
				{},
				{
					sort: { $vector: queryVector },
					limit,
					projection: { b: 1, c: 1, v: 1 },
					includeSimilarity: true,
				}
			)
			.toArray()
	);

	if (!results || results.length === 0) {
		return { verses: [], averageSimilarity: 0 };
	}

	const coordinates = results.flatMap((doc: Record<string, unknown>) => {
		const parsed = toVerseCoordinates(doc);
		return parsed ? [parsed] : [];
	});

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

	return { verses, averageSimilarity };
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

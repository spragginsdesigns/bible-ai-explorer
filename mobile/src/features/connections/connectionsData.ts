import { API_URL } from "@/lib/api";
import type { BaselineBook, ChapterLink, OverviewPair } from "@/features/bible/connectionsMap";
import type { TranslationId } from "@/features/bible/translations";
import { bibleVersePlainText } from "@/features/bible/verseMarkup";

/**
 * Network layer for the Connections tab. All three reads are public,
 * edge-cached Scripture data (no session), so plain fetch is enough; results
 * are kept for the session because they only change with a deploy.
 */

export interface ChapterConnections {
	order: number;
	chapter: number;
	book: string;
	verseCount: number;
	chapterStart: number;
	total: number;
	books: BaselineBook[];
	links: ChapterLink[];
}

export interface ConnectionsOverview {
	total: number;
	links: number;
	bins: number;
	books: BaselineBook[];
	pairs: OverviewPair[];
}

const REQUEST_TIMEOUT_MS = 15_000;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

const isNumberTuple = (value: unknown, length: number) =>
	Array.isArray(value) && value.length === length && value.every((n) => typeof n === "number");

async function getJson(path: string): Promise<unknown> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch(`${API_URL}${path}`, { signal: controller.signal });
		if (!response.ok) throw new Error(`Request failed: ${response.status}`);
		return await response.json();
	} finally {
		clearTimeout(timer);
	}
}

const chapterCache = new Map<string, Promise<ChapterConnections>>();

export function loadChapterConnections(order: number, chapter: number): Promise<ChapterConnections> {
	const key = `${order}:${chapter}`;
	const cached = chapterCache.get(key);
	if (cached) return cached;
	const task = getJson(`/api/bible/connections?book=${order}&chapter=${chapter}`).then((value) => {
		if (
			!isRecord(value) ||
			value.order !== order ||
			value.chapter !== chapter ||
			typeof value.book !== "string" ||
			typeof value.verseCount !== "number" ||
			typeof value.chapterStart !== "number" ||
			typeof value.total !== "number" ||
			!Array.isArray(value.books) ||
			!value.books.every((b) => isNumberTuple(b, 3)) ||
			!Array.isArray(value.links) ||
			!value.links.every((l) => isNumberTuple(l, 5))
		) {
			throw new Error("Unexpected connections response");
		}
		return value as unknown as ChapterConnections;
	});
	chapterCache.set(key, task);
	// A failure must not stick: the next visit retries.
	task.catch(() => chapterCache.delete(key));
	return task;
}

let overviewTask: Promise<ConnectionsOverview> | null = null;

export function loadConnectionsOverview(): Promise<ConnectionsOverview> {
	overviewTask ??= getJson("/api/bible/connections/overview").then((value) => {
		if (
			!isRecord(value) ||
			typeof value.total !== "number" ||
			typeof value.bins !== "number" ||
			!Array.isArray(value.pairs) ||
			!value.pairs.every((p) => isNumberTuple(p, 3)) ||
			!Array.isArray(value.books)
		) {
			throw new Error("Unexpected overview response");
		}
		return value as unknown as ConnectionsOverview;
	});
	overviewTask.catch(() => {
		overviewTask = null;
	});
	return overviewTask;
}

const quoteCache = new Map<string, Promise<Map<string, string>>>();

/**
 * The text of a verse's linked passages in the reader's translation, keyed by
 * the reference the crossrefs route prints ("Romans 5:8", or a range such as
 * "John 3:16-18" that the caller matches by its first verse).
 */
export function loadLinkedQuotes(reference: string, translation: TranslationId): Promise<Map<string, string>> {
	const key = `${translation}:${reference}`;
	const cached = quoteCache.get(key);
	if (cached) return cached;
	const query = new URLSearchParams({ reference, translation, limit: "20" });
	const task = getJson(`/api/bible/crossrefs?${query.toString()}`).then((value) => {
		const quotes = new Map<string, string>();
		if (!isRecord(value) || !Array.isArray(value.crossReferences)) return quotes;
		for (const item of value.crossReferences) {
			if (!isRecord(item) || typeof item.reference !== "string" || typeof item.text !== "string") continue;
			quotes.set(item.reference, bibleVersePlainText(item.text));
		}
		return quotes;
	});
	quoteCache.set(key, task);
	task.catch(() => quoteCache.delete(key));
	return task;
}

/** The quote for "Book ch:v" from a map that may hold "Book ch:v-w". */
export function quoteFor(quotes: Map<string, string>, reference: string): string | undefined {
	const exact = quotes.get(reference);
	if (exact) return exact;
	for (const [key, text] of quotes) {
		if (key.startsWith(`${reference}-`)) return text;
	}
	return undefined;
}

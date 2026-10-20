import "server-only";
import { BOOKS, bookByOrder } from "./books";
import {
	connectionSectionOf,
	type BaselineBook,
	type ChapterLink,
	type OverviewPair,
} from "./connectionsMap";
import { getBookRefs } from "./crossRefs";
import { getKjvBook } from "./kjv";

/**
 * Data for the Connections map (docs/FEATURES.md -> "Connections map"). The
 * cross-reference set and the KJV both ship in the deploy, so everything here
 * is computed once per instance and the routes cache it at the edge.
 */

interface VerseIndex {
	total: number;
	books: BaselineBook[];
	/** chapterStart[order][chapter - 1] = global index of that chapter's verse 1. */
	chapterStart: Map<number, number[]>;
	chapterVerses: Map<number, number[]>;
}

let verseIndexPromise: Promise<VerseIndex> | null = null;

/** Every verse's place on the baseline, from the KJV's own verse counts. */
export function getVerseIndex(): Promise<VerseIndex> {
	verseIndexPromise ??= (async () => {
		const books: BaselineBook[] = [];
		const chapterStart = new Map<number, number[]>();
		const chapterVerses = new Map<number, number[]>();
		let cursor = 0;
		for (const book of BOOKS) {
			const chapters = await getKjvBook(book.order);
			const starts: number[] = [];
			const counts: number[] = [];
			const bookStart = cursor;
			for (const verses of chapters) {
				starts.push(cursor);
				counts.push(verses.length);
				cursor += verses.length;
			}
			books.push([book.order, bookStart, cursor - bookStart]);
			chapterStart.set(book.order, starts);
			chapterVerses.set(book.order, counts);
		}
		return { total: cursor, books, chapterStart, chapterVerses };
	})().catch((error) => {
		verseIndexPromise = null;
		throw error;
	});
	return verseIndexPromise;
}

/** Global index of a verse, or null when the reference is outside the KJV. */
function indexOf(index: VerseIndex, order: number, chapter: number, verse: number): number | null {
	const start = index.chapterStart.get(order)?.[chapter - 1];
	const count = index.chapterVerses.get(order)?.[chapter - 1];
	if (start === undefined || count === undefined || verse < 1 || verse > count) return null;
	return start + verse - 1;
}

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

/** Every ranked link out of one chapter, placed on the baseline. */
export async function getChapterConnections(order: number, chapter: number): Promise<ChapterConnections | null> {
	const meta = bookByOrder(order);
	if (!meta || chapter < 1 || chapter > meta.chapters) return null;
	const index = await getVerseIndex();
	const verseCount = index.chapterVerses.get(order)?.[chapter - 1] ?? 0;
	const refs = await getBookRefs(order);
	const links: ChapterLink[] = [];
	for (let verse = 1; verse <= verseCount; verse++) {
		for (const tuple of refs[`${chapter}:${verse}`] ?? []) {
			if (tuple.length < 3) continue;
			const [toOrder, toChapter, toVerse] = tuple;
			// A few ranges in the data start at their own verse; a chord to itself says nothing.
			if (toOrder === order && toChapter === chapter && toVerse === verse) continue;
			const at = indexOf(index, toOrder, toChapter, toVerse);
			if (at === null) continue;
			links.push([verse, toOrder, toChapter, toVerse, at]);
		}
	}
	return {
		order,
		chapter,
		book: meta.name,
		verseCount,
		chapterStart: index.chapterStart.get(order)?.[chapter - 1] ?? 0,
		total: index.total,
		books: index.books,
		links,
	};
}

/** Baseline resolution of the overview: each bin is about 130 verses. */
export const OVERVIEW_BINS = 240;
/** The strongest bin pairs kept; enough for the dome to read as a weave. */
export const OVERVIEW_MAX_PAIRS = 2400;

export interface ConnectionsOverview {
	total: number;
	links: number;
	bins: number;
	books: BaselineBook[];
	pairs: OverviewPair[];
	/** Links landing in each section, for the legend. */
	sections: Record<string, number>;
}

let overviewPromise: Promise<ConnectionsOverview> | null = null;

/**
 * The whole set folded into bin pairs: the ghosted dome behind every chapter
 * and the full-Bible view. 225k arcs cannot be drawn on a phone; their
 * strongest 2,400 bundles can, and they trace the same shape.
 */
export function getConnectionsOverview(): Promise<ConnectionsOverview> {
	overviewPromise ??= (async () => {
		const index = await getVerseIndex();
		const binOf = (at: number) => Math.min(OVERVIEW_BINS - 1, Math.floor((at / index.total) * OVERVIEW_BINS));
		const weights = new Map<number, number>();
		const sections: Record<string, number> = {};
		let links = 0;
		for (const book of BOOKS) {
			const refs = await getBookRefs(book.order);
			for (const [key, tuples] of Object.entries(refs)) {
				const [chapter, verse] = key.split(":").map(Number);
				const from = indexOf(index, book.order, chapter, verse);
				if (from === null) continue;
				for (const tuple of tuples) {
					if (tuple.length < 3) continue;
					const to = indexOf(index, tuple[0], tuple[1], tuple[2]);
					if (to === null) continue;
					links++;
					const id = connectionSectionOf(tuple[0]).id;
					sections[id] = (sections[id] ?? 0) + 1;
					const a = binOf(Math.min(from, to));
					const b = binOf(Math.max(from, to));
					if (a === b) continue;
					const pairKey = a * OVERVIEW_BINS + b;
					weights.set(pairKey, (weights.get(pairKey) ?? 0) + 1);
				}
			}
		}
		const pairs: OverviewPair[] = [...weights.entries()]
			.sort((x, y) => y[1] - x[1])
			.slice(0, OVERVIEW_MAX_PAIRS)
			.map(([pairKey, weight]) => [Math.floor(pairKey / OVERVIEW_BINS), pairKey % OVERVIEW_BINS, weight]);
		return { total: index.total, links, bins: OVERVIEW_BINS, books: index.books, pairs, sections };
	})().catch((error) => {
		overviewPromise = null;
		throw error;
	});
	return overviewPromise;
}

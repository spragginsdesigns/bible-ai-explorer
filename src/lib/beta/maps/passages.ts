/**
 * Concept Maps' passages against SureWord's own Bible (LC-17654): the book
 * table behind `resolveReference`, and the bundled KJV for verse counts and
 * text. Runs in the browser (the passage sheet, the editor) and on the server
 * (every save is checked verse by verse before it is stored).
 */
import { bookByOrder, resolveReference } from "@/lib/bible/books";
import { getKjvChapter } from "@/lib/bible/kjv";
import { bibleVersePlainText } from "@/lib/bible/verseMarkup";
import {
	checkConceptMap,
	mapPassageTexts,
	mapStoreRefKeys,
	parsePassage,
	passageChapters,
	type ConceptMap,
	type MapBook,
	type MapBookIndex,
	type MapRuleResult,
	type Passage,
	type VerseCount,
} from "./map-rules";

function asMapBook(order: number): MapBook | null {
	const book = bookByOrder(order);
	return book ? { order: book.order, name: book.name, chapters: book.chapters } : null;
}

/** Book names resolve exactly as the reader's and chat's references do (aliases and abbreviations included). */
export const MAP_BOOKS: MapBookIndex = {
	byName(name) {
		const resolved = resolveReference(`${name} 1`);
		return resolved ? asMapBook(resolved.order) : null;
	},
	byOrder: asMapBook,
};

/** A passage string as typed or stored, without checking verse numbers. */
export function readPassage(text: string): Passage | null {
	return parsePassage(text, MAP_BOOKS);
}

/** Verse counts for every chapter the passages touch, read from the bundled KJV. */
export async function kjvVerseCounter(passages: readonly Passage[]): Promise<VerseCount> {
	const counts = new Map<string, number>();
	const chapters = new Set<string>();
	for (const passage of passages) {
		for (let chapter = passage.chapter; chapter <= passage.endChapter; chapter++) chapters.add(`${passage.book}.${chapter}`);
	}
	await Promise.all(
		[...chapters].map(async (key) => {
			const [book, chapter] = key.split(".").map(Number);
			try {
				counts.set(key, (await getKjvChapter(book, chapter)).length);
			} catch {
				/* A chapter the KJV does not have stays unknown, so the passage fails. */
			}
		}),
	);
	return (book, chapter) => counts.get(`${book}.${chapter}`) ?? null;
}

/** Every passage string found in an untrusted map, parsed where it parses. */
function passagesInRaw(raw: unknown): Passage[] {
	const out: Passage[] = [];
	const add = (refs: unknown) => {
		if (!Array.isArray(refs)) return;
		for (const ref of refs.slice(0, 40)) {
			const passage = typeof ref === "string" ? readPassage(ref) : null;
			if (passage) out.push(passage);
		}
	};
	if (typeof raw === "object" && raw !== null) {
		const map = raw as { nodes?: unknown; links?: unknown };
		for (const node of Array.isArray(map.nodes) ? map.nodes.slice(0, 200) : []) {
			if (typeof node !== "object" || node === null) continue;
			add((node as { refs?: unknown }).refs);
			add(((node as { via?: { refs?: unknown } }).via ?? {}).refs);
		}
		for (const link of Array.isArray(map.links) ? map.links.slice(0, 50) : []) {
			if (typeof link === "object" && link !== null) add((link as { refs?: unknown }).refs);
		}
	}
	return out;
}

/** `checkConceptMap` with every verse checked against the bundled KJV. */
export async function checkMapAgainstKjv(raw: unknown): Promise<MapRuleResult<ConceptMap>> {
	const verseCount = await kjvVerseCounter(passagesInRaw(raw));
	return checkConceptMap(raw, { books: MAP_BOOKS, verseCount });
}

/** The study store's passage keys for a checked map (`BetaItem.refs`). */
export async function mapRefKeys(map: ConceptMap): Promise<string[]> {
	const passages = mapPassageTexts(map).flatMap((text) => {
		const passage = readPassage(text);
		return passage ? [passage] : [];
	});
	return mapStoreRefKeys(passages, await kjvVerseCounter(passages));
}

/** A passage's text as the sheet shows it: each chapter's verses, capped. */
export interface PassageText {
	passage: Passage;
	chapters: { chapter: number; verses: { verse: number; text: string }[] }[];
	/** True when the passage runs past `maxVerses` and the rest is left to the reader. */
	truncated: boolean;
}

export async function loadPassageText(text: string, maxVerses = 40): Promise<PassageText | null> {
	const parsed = readPassage(text);
	if (!parsed) return null;
	const verseCount = await kjvVerseCounter([parsed]);
	const passage = parsePassage(text, MAP_BOOKS, verseCount);
	if (!passage) return null;
	const chapters: PassageText["chapters"] = [];
	let shown = 0;
	let truncated = false;
	for (const span of passageChapters(passage, verseCount)) {
		const raw = await getKjvChapter(passage.book, span.chapter);
		const verses: { verse: number; text: string }[] = [];
		for (let verse = span.from; verse <= span.to; verse++) {
			if (shown >= maxVerses) {
				truncated = true;
				break;
			}
			verses.push({ verse, text: bibleVersePlainText(raw[verse - 1] ?? "").trim() });
			shown++;
		}
		if (verses.length) chapters.push({ chapter: span.chapter, verses });
		if (truncated) break;
	}
	return { passage, chapters, truncated };
}

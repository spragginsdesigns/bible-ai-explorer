import sectionHeadings from "../../../mobile/src/features/bible/data/section-headings.json";
import { getBsbChapter } from "./bsb";
import annotations from "../../../mobile/src/features/bible/data/kjv-red-letters.json";
import {
	parseBibleVerseMarkup,
	type BibleVerseSegment,
} from "../../../mobile/src/features/bible/verseMarkup";
import type { TranslationId } from "./translations";

interface SpeechAnnotation {
	text: string;
	ranges: number[][];
}
const kjvSpeech: Record<string, SpeechAnnotation> = annotations;
export interface ReaderVerseSegment extends BibleVerseSegment {
	jesusSpeech?: boolean;
}

/** Source-authored speech spans, never inferred from names or verse numbers.
 * Exact text equality prevents stale offsets coloring the wrong words. NKJV
 * needs its own licensed annotations; KJV offsets must never be reused there.
 */
export function readerVerseSegments(
	markup: string,
	translation: TranslationId,
	book: number,
	chapter: number,
	verse: number,
): ReaderVerseSegment[] {
	const segments = parseBibleVerseMarkup(markup);
	if (translation === "BSB") {
		const entry = getBsbChapter(book, chapter)[verse - 1];
		return entry?.text === markup ? entry.segments : segments;
	}
	if (translation !== "KJV") return segments;
	const entry = kjvSpeech[`${book}:${chapter}:${verse}`];
	if (!entry || entry.text !== segments.map((s) => s.text).join("")) return segments;
	const result: ReaderVerseSegment[] = [];
	let offset = 0;
	for (const segment of segments) {
		const end = offset + segment.text.length;
		const boundaries = [
			...new Set([offset, end, ...entry.ranges.flat().filter((n) => n > offset && n < end)]),
		].sort((a, b) => a - b);
		for (let i = 0; i < boundaries.length - 1; i++) {
			const start = boundaries[i];
			result.push({
				text: segment.text.slice(start - offset, boundaries[i + 1] - offset),
				italic: segment.italic,
				jesusSpeech: entry.ranges.some(([lo, hi]) => start >= lo && start < hi),
			});
		}
		offset = end;
	}
	return result;
}

/** Publisher-authored editorial headings, separate from translation text. */
export function readerSectionHeadings(translation: TranslationId, book: number, chapter: number, verse: number): string[] {
 if (translation === "NKJV") return [];
 return (sectionHeadings as Record<string, string[]>)[`${book}:${chapter}:${verse}`] ?? [];
}

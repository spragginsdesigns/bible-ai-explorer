import { getChapter, type TranslationId } from "@/lib/bible/translations";
import { bookByOrder, resolveReference } from "@/lib/bible/books";

export const MAX_CONTEXT_PASSAGE_VERSES = 30;
export const PASSAGE_CONTEXT_RADIUS = 3;

/** Only the selected verses and a bounded window from the same chapter. */
export function boundedPassage(chapter: readonly string[], start: number, end = start) {
	if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > chapter.length) throw new Error("That verse or range does not exist in this chapter.");
	const selectedEnd = Math.min(end, start + MAX_CONTEXT_PASSAGE_VERSES - 1);
	const selected = Array.from({ length: selectedEnd - start + 1 }, (_, index) => ({ verse: start + index, text: chapter[start + index - 1] }));
	const contextStart = Math.max(1, start - PASSAGE_CONTEXT_RADIUS);
	const contextEnd = Math.min(chapter.length, selectedEnd + PASSAGE_CONTEXT_RADIUS);
	const context = Array.from({ length: contextEnd - contextStart + 1 }, (_, index) => ({ verse: contextStart + index, text: chapter[contextStart + index - 1] })).filter(row => row.verse < start || row.verse > selectedEnd);
	return { selected, context, truncated: selectedEnd !== end };
}

/** Reconstruct from the actual translation, never a client-supplied quotation. */
export async function canonicalPassage(reference: string, translation: TranslationId) {
	const ref = resolveReference(reference);
	const range = reference.trim().match(/^([1-3]?\s*[a-zA-Z. ]+?)\s*(\d+)\s*:\s*(\d+)(?:\s*[-\u2013\u2014]\s*(\d+))?$/);
	if (!ref?.verse || !range) throw new Error("Use a verse or a range within one chapter.");
	const chapter = await getChapter(translation, ref.order, ref.chapter);
	const result = boundedPassage(chapter, ref.verse, Number(range[4] ?? ref.verse));
	const book = bookByOrder(ref.order)?.name;
	if (!book) throw new Error("Unknown Bible book.");
	const row = (verse: { verse: number; text: string }) => ({ reference: `${book} ${ref.chapter}:${verse.verse}`, text: verse.text, translation });
	return {
		reference: `${book} ${ref.chapter}:${ref.verse}${result.selected.length > 1 ? `-${result.selected.at(-1)!.verse}` : ""}`,
		verses: result.selected.map(row),
		contextVerses: result.context.map(row),
		truncated: result.truncated,
	};
}

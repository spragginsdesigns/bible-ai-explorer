/**
 * Verse selection for the reader's verse sheet: one verse, or a contiguous
 * range grown by tapping more verses while the sheet is open (the YouVersion
 * model). Pure functions so the selection rules are testable and identical
 * on every client; the Android copy lives in mobile/src/features/bible/verseSelection.ts and
 * must stay byte-for-byte in step.
 */

/**
 * Upper bound on a range. The verse-insight route caps the text it explains
 * at 2,500 characters and a KJV verse averages about 120, so ten verses stay
 * safely under it and still cover any paragraph a reader would highlight or
 * share as one unit.
 */
export const MAX_SELECTED_VERSES = 10;

/** Inclusive, 1-based. `start <= end` always holds. */
export interface VerseSelection {
	start: number;
	end: number;
}

export function selectionCount(selection: VerseSelection): number {
	return selection.end - selection.start + 1;
}

export function selectionVerses(selection: VerseSelection): number[] {
	const verses: number[] = [];
	for (let verse = selection.start; verse <= selection.end; verse += 1) verses.push(verse);
	return verses;
}

export function selectionIncludes(selection: VerseSelection | null, verse: number): boolean {
	return selection !== null && verse >= selection.start && verse <= selection.end;
}

/**
 * The reader's tap rule.
 *
 * - No selection: the tapped verse becomes the selection.
 * - Tapping the only selected verse clears the selection (closes the sheet).
 * - Tapping a verse inside a wider range re-anchors on that verse alone.
 * - Tapping outside the range grows it to cover the verse; a range that
 *   would exceed MAX_SELECTED_VERSES is left unchanged.
 */
export function toggleVerse(current: VerseSelection | null, verse: number): VerseSelection | null {
	if (!current) return { start: verse, end: verse };
	if (selectionIncludes(current, verse)) {
		return selectionCount(current) === 1 ? null : { start: verse, end: verse };
	}
	const next = {
		start: Math.min(current.start, verse),
		end: Math.max(current.end, verse),
	};
	return selectionCount(next) > MAX_SELECTED_VERSES ? current : next;
}

/** "Genesis 1:1" for one verse, "Genesis 1:1-3" for a range. */
export function selectionReference(
	bookName: string,
	chapter: number,
	selection: VerseSelection
): string {
	const base = `${bookName} ${chapter}:${selection.start}`;
	return selection.start === selection.end ? base : `${base}-${selection.end}`;
}

/**
 * The selected text with no markup. A single verse is its bare text; a range
 * numbers each verse so the passage reads correctly once copied or explained.
 * `plainTexts` is indexed from verse 1 at position 0.
 */
export function selectionText(plainTexts: readonly string[], selection: VerseSelection): string {
	if (selection.start === selection.end) return plainTexts[selection.start - 1] ?? "";
	return selectionVerses(selection)
		.map((verse) => `${verse} ${plainTexts[verse - 1] ?? ""}`.trim())
		.join(" ");
}

/** Clipboard and share payload, the same shape the sheet has always used. */
export function selectionShareText(reference: string, text: string, translation: string): string {
	return `${reference} — "${text}" (${translation})`;
}

/**
 * The highlight color the whole selection shares, or undefined when the
 * verses differ or any of them is unmarked. The strip rings a color only
 * when tapping it again would remove exactly what is shown.
 */
export function selectionColor(
	highlights: ReadonlyMap<number, string>,
	selection: VerseSelection
): string | undefined {
	let shared: string | undefined;
	for (const verse of selectionVerses(selection)) {
		const color = highlights.get(verse);
		if (!color) return undefined;
		if (shared === undefined) shared = color;
		else if (shared.toLowerCase() !== color.toLowerCase()) return undefined;
	}
	return shared;
}

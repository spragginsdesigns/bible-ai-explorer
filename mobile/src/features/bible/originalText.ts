/**
 * Pure helpers for rendering the original-language words of a verse.
 * Deliberately free of React and React Native imports so the unit test can run
 * in vitest's node environment.
 */

export type OriginalLanguage = "Hebrew" | "Greek";

/** First and last Hebrew cantillation mark (the "accents" block). */
export const CANTILLATION_FIRST = 0x0591;
export const CANTILLATION_LAST = 0x05af;

/**
 * Built from code points rather than written inline: the characters are
 * invisible combining marks, so a literal character class renders in editors
 * and diffs as an unreviewable smudge.
 */
const CANTILLATION = new RegExp(
	`[${String.fromCharCode(CANTILLATION_FIRST)}-${String.fromCharCode(CANTILLATION_LAST)}]`,
	"g"
);

/**
 * Drop the cantillation marks from Masoretic Hebrew.
 *
 * They are the chanting accents of the Westminster Leningrad Codex, stacked
 * above and below the consonants. At the pill type size used in the verse
 * sheet they collide into a smear on Android's Noto Sans Hebrew. The vowel
 * points (U+05B0-U+05C7) are deliberately kept: without them the word is only
 * a consonant skeleton and the reader loses the pronunciation that the
 * transliteration beside it is meant to match.
 */
export function stripCantillation(text: string): string {
	return text.replace(CANTILLATION, "");
}

/** Hebrew reads right to left; Greek uses the normal left-to-right flow. */
export function isRightToLeft(language: OriginalLanguage): boolean {
	return language === "Hebrew";
}

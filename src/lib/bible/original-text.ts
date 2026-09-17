/**
 * Display helpers for the original-language section of the verse panel.
 *
 * Pure and platform-free so the same rules can be asserted in tests and
 * mirrored by the Android and Apple clients.
 */

/**
 * Hebrew cantillation marks (U+0591-U+05AF) are the chanting accents of the
 * Masoretic text. They are not part of the word and they render as a cloud of
 * specks at pill size, so they are dropped for display. Vowel points
 * (U+05B0-U+05BC and the rest of the niqqud block) are deliberately kept:
 * without them the consonantal skeleton is unreadable to a learner.
 */
export function stripCantillation(text: string): string {
	return text.replace(/[\u0591-\u05AF]/g, "");
}

/** Hebrew is written right to left; Greek is not. */
export function isRightToLeft(language: string): boolean {
	return language === "Hebrew";
}

/**
 * Strong's marks idiomatic renderings with "[idiom]" in this edition of the
 * dictionary (the printed one uses a dagger). The marker means nothing to a
 * reader and reads as broken data, so it is dropped from every gloss shown.
 */
export function cleanGloss(gloss: string): string {
	return gloss
		.replace(/\[idiom\]\s*/g, "")
		.replace(/\(\s*\)/g, "")
		.replace(/\s{2,}/g, " ")
		.replace(/\s+,/g, ",")
		.trim();
}

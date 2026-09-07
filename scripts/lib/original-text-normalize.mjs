// Pure normalization of the bundled original-language word data
// (src/data/originals/NN-book.json, each word a [text, strongs, morph] triple)
// into the "plain" search form stored in "OriginalVerse"."plain".
//
// No dependencies and no I/O, so tests/original-text-normalize.test.mjs can
// exercise it directly and the seed script can reuse it unchanged.
//
// Why a plain form at all: the Hebrew is fully pointed (vowels, dagesh,
// cantillation) and a reader searching for a word types the consonants only,
// so an index built over the bundled text would never match. Postgres has no
// Hebrew or Greek dictionary, so the tsvector is built with 'simple' over
// this form, which does the folding the dictionary would otherwise do.

// Hebrew combining marks and in-range punctuation: U+0591-U+05AF cantillation,
// U+05B0-U+05BD points (sheva, hataf, hiriq, tsere, segol, patah, qamats,
// holam, qubbuts, dagesh/mappiq, meteg), U+05BE maqaf, U+05BF rafe,
// U+05C0 paseq, U+05C1/U+05C2 shin and sin dots, U+05C3 sof pasuq,
// U+05C4/U+05C5 upper and lower dots, U+05C7 qamats qatan. What survives is
// U+05D0-U+05EA, the 22 letters with their five final forms.
const HEBREW_MARKS = /[\u0591-\u05C7]/gu;
const MAQAF = /\u05BE/gu;
// Zero-width joiner/non-joiner, and the "/" some OSHB exports use to separate
// the morphemes inside one word. Neither appears in the bundled data today;
// both are dropped rather than spaced so a prefixed word stays one token.
const INVISIBLE_OR_SEPARATOR = /[\u200C\u200D\/]/gu;

const GREEK_COMBINING = /[\u0300-\u036F]/gu;
const PUNCTUATION_OR_SYMBOL = /[\p{P}\p{S}]/gu;

const WHITESPACE = /\s+/gu;

/**
 * Consonantal form of one pointed Hebrew word.
 *
 * @param {unknown} word
 * @returns {string}
 */
export function hebrewPlain(word) {
	if (typeof word !== "string" || word.length === 0) return "";
	return word
		.normalize("NFD")
		.replace(INVISIBLE_OR_SEPARATOR, "")
		// Maqaf joins two words into one graphical unit; it becomes a space so
		// each side is its own search token. Done before the blanket mark strip
		// because U+05BE falls inside that range.
		.replace(MAQAF, " ")
		.replace(HEBREW_MARKS, "")
		.replace(WHITESPACE, " ")
		.trim();
}

/**
 * Bare lowercase form of one Greek word: accents, breathings, iota subscript
 * and diaeresis removed, punctuation dropped.
 *
 * @param {unknown} word
 * @returns {string}
 */
export function greekPlain(word) {
	if (typeof word !== "string" || word.length === 0) return "";
	return word
		.normalize("NFD")
		.replace(GREEK_COMBINING, "")
		.normalize("NFC")
		.toLowerCase()
		.replace(PUNCTUATION_OR_SYMBOL, "")
		.replace(WHITESPACE, " ")
		.trim();
}

/**
 * Read the surface text out of one bundled word entry, which is a
 * [text, strongs, morph] triple. A bare string is accepted too so callers
 * that have already split the verse can reuse these helpers.
 *
 * @param {unknown} entry
 * @returns {string}
 */
function wordText(entry) {
	if (Array.isArray(entry)) return typeof entry[0] === "string" ? entry[0] : "";
	return typeof entry === "string" ? entry : "";
}

/**
 * The plain search form of a whole verse: every word normalized for its
 * language and joined by single spaces, with empties dropped.
 *
 * @param {string} language "Hebrew" or "Greek" (case-insensitive)
 * @param {unknown[]} words
 * @returns {string}
 */
export function versePlain(language, words) {
	if (!Array.isArray(words)) return "";
	const normalize = String(language).toLowerCase() === "hebrew" ? hebrewPlain : greekPlain;
	const parts = [];
	for (const entry of words) {
		// One entry can yield two tokens when a maqaf was expanded, so split
		// again rather than assuming one word in means one word out.
		for (const token of normalize(wordText(entry)).split(" ")) {
			if (token) parts.push(token);
		}
	}
	return parts.join(" ");
}

/**
 * Distinct non-empty Strong's ids of a verse, in the order they first appear.
 *
 * @param {unknown[]} words
 * @returns {string[]}
 */
export function verseStrongs(words) {
	if (!Array.isArray(words)) return [];
	const seen = new Set();
	const ids = [];
	for (const entry of words) {
		const id = Array.isArray(entry) && typeof entry[1] === "string" ? entry[1].trim() : "";
		if (!id || seen.has(id)) continue;
		seen.add(id);
		ids.push(id);
	}
	return ids;
}

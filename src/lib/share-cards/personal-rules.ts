/**
 * The rules for the words on a personal card (docs/FEATURES.md, "Share
 * cards" -> "Send a word"). Pure and import-free, so tests/share-cards.test.mjs
 * runs them directly.
 *
 * A personal card is a sureword.app page and a SureWord-branded picture that
 * carries text a person typed, so the text is held to two promises: it can
 * never pass itself off as SureWord (no "SureWord", no links, no addresses,
 * no hidden direction-changing characters), and SureWord's own word can never
 * carry the sender's private description of what the recipient faces.
 */

/** Code points that render as nothing or reverse the text around them. */
const INVISIBLE_RANGES: readonly [number, number][] = [
	[0x0000, 0x001f],
	[0x007f, 0x009f],
	[0x200b, 0x200f],
	[0x202a, 0x202e],
	[0x2060, 0x2069],
	[0xfeff, 0xfeff],
];

function isInvisible(codePoint: number): boolean {
	return INVISIBLE_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end);
}

/** Person-typed text as a card may print it: one line, no invisible characters, bounded. */
export function cleanPersonalText(value: unknown, max: number): string | null {
	if (typeof value !== "string") return null;
	let text = "";
	for (const char of value) {
		text += isInvisible(char.codePointAt(0) ?? 0) ? " " : char;
	}
	text = text.replace(/ +/g, " ").trim();
	if (!text) return null;
	if (text.length <= max) return text;
	// Clients stop typing at the limit; anything longer is cut at a word, so a
	// card never prints half of one.
	const cut = text.slice(0, max + 1);
	const space = cut.lastIndexOf(" ");
	return (space > 0 ? cut.slice(0, space) : text.slice(0, max)).trim();
}

const SCHEME = /https?:|www\./i;
// The ending in lowercase or capitals ("site.com", "PRIZES.COM") is a link,
// and so is a capitalised ending that is no English word ("Prizes.Com"). A
// capitalised word after a missed space ("with you.Me and Dad", "you.Us")
// is a sentence, not a link.
const TLDS = "com|org|net|app|io|co|me|ly|info|biz|xyz|link|site|online|gg|us|uk";
const DOMAIN = new RegExp(`\\b[A-Za-z0-9-]+\\.(?:${TLDS}|${TLDS.toUpperCase()}|Com|Org|Net|Io|Ly|Biz|Xyz|Gg|Uk)\\b`);
const SPOKEN_DOMAIN = /\b[a-z0-9-]+ dot (com|org|net|app|io|co|me)\b/i;
const ADDRESS = /@|\b[a-z0-9._%+-]+ at [a-z0-9-]+ dot /i;
// "SureWord", "SureWords", "Sure Word", "Sure-Word"; not "sure words" as two
// words (plain English) or "a more sure word", which is 2 Peter 1:19, where
// the name comes from.
const BRAND = /(?<!more\s)sure(?:[._-]*word|\s+word(?!s))/i;

function isLink(text: string): boolean {
	return SCHEME.test(text) || DOMAIN.test(text) || SPOKEN_DOMAIN.test(text) || ADDRESS.test(text);
}

/**
 * Why a recipient name, line or signature cannot print, or null when it can.
 * The message is shown to the sender as it is.
 */
export function personalTextProblem(text: string | null): string | null {
	if (!text) return null;
	if (BRAND.test(text)) return "Cards can't speak as SureWord. Use your own name and words.";
	if (isLink(text)) return "Cards can't carry links or email addresses.";
	return null;
}

function words(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9' ]+/g, " ")
		.split(" ")
		.filter(Boolean);
}

/** Does `a` share a run of `run` consecutive words with `b`? */
export function sharesWordRun(a: string, b: string, run = 4): boolean {
	const left = words(a);
	const right = words(b);
	if (left.length < run || right.length < run) return false;
	const runs = new Set<string>();
	for (let index = 0; index + run <= right.length; index += 1) runs.add(right.slice(index, index + run).join(" "));
	for (let index = 0; index + run <= left.length; index += 1) {
		if (runs.has(left.slice(index, index + run).join(" "))) return true;
	}
	return false;
}

/**
 * Whether SureWord's word may print. It must not carry a link, an address or
 * the brand (a situation written as instructions could otherwise put any
 * text on a public card in SureWord's voice), and it must not echo four
 * words in a row of the sender's private description.
 */
export function wordIsSafe(word: string, situation: string): boolean {
	if (BRAND.test(word) || isLink(word)) return false;
	return !sharesWordRun(word, situation);
}

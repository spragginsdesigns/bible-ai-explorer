/**
 * Share cards: the pure half (docs/FEATURES.md, "Share cards").
 *
 * Everything that decides what a card says and how big its type is lives
 * here, with no imports beyond types, so tests/share-cards.test.mjs can load
 * it through Node's type stripper. The drawing half (`render.tsx`) only
 * places what this module already measured.
 *
 * satori lays text out itself and offers no way to ask how tall a paragraph
 * came out, so a card that guessed its type size would either waste half the
 * canvas on John 11:35 or run Esther 8:9 off the bottom. Instead the text is
 * wrapped here with the real advance widths of the card fonts
 * (`glyph-widths.ts`), and the largest size whose wrapped height fits the
 * box wins. Only when even the smallest size overflows is the text clipped,
 * at a word, with an ellipsis.
 */
import type { GlyphWidthTable } from "./glyph-widths";

export const SHARE_CARD_STYLES = ["dawn", "parchment", "sanctuary"] as const;
export type ShareCardStyle = (typeof SHARE_CARD_STYLES)[number];

export const SHARE_CARD_FORMATS = ["story", "square", "wide"] as const;
export type ShareCardFormat = (typeof SHARE_CARD_FORMATS)[number];

export const SHARE_CARD_SIZES: Record<ShareCardFormat, { width: number; height: number }> = {
	/** Instagram and WhatsApp status, and a phone's lock screen. */
	story: { width: 1080, height: 1920 },
	/** A feed post, and what most chat apps show without cropping. */
	square: { width: 1080, height: 1080 },
	/** The link unfurl (Open Graph / Twitter card). */
	wide: { width: 1200, height: 630 },
};

/**
 * Carried in every card URL the clients build, so bumping it moves every new
 * share to fresh URLs instead of the CDN's year-old copies. Bump it when a
 * card's look changes, and when the bundled Bible text is corrected. Old URLs
 * still answer: from the CDN while their copy lives, and by redirect to this
 * version once it expires.
 */
export const SHARE_CARD_DESIGN_VERSION = "2";

/** The longest selection the reader allows; the card route refuses more. */
export const MAX_CARD_VERSES = 10;

export function parseShareCardStyle(value: unknown): ShareCardStyle {
	return typeof value === "string" && (SHARE_CARD_STYLES as readonly string[]).includes(value)
		? (value as ShareCardStyle)
		: "dawn";
}

export function parseShareCardFormat(
	value: unknown,
	fallback: ShareCardFormat = "story"
): ShareCardFormat {
	return typeof value === "string" && (SHARE_CARD_FORMATS as readonly string[]).includes(value)
		? (value as ShareCardFormat)
		: fallback;
}

const SUPERSCRIPT_DIGITS = ["⁰", "¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹"];

/** 16 → "¹⁶". satori cannot size part of a line, so verse numbers are glyphs. */
export function superscriptNumber(value: number): string {
	return String(value)
		.split("")
		.map((digit) => SUPERSCRIPT_DIGITS[Number(digit)] ?? digit)
		.join("");
}

/**
 * The body of a verse card. One verse is its bare text; a range numbers each
 * verse in superscript so the passage still reads as Scripture, not as one
 * run-on sentence.
 */
export function cardScriptureText(verses: readonly { verse: number; text: string }[]): string {
	const clean = verses
		.map((row) => ({ verse: row.verse, text: collapseWhitespace(row.text) }))
		.filter((row) => row.text);
	// Decided by what was asked for, not what had text: a BSB range with an
	// omitted verse (Matthew 18:10-11) is still a range, never a bare quote.
	if (verses.length === 1 && clean.length === 1) return clean[0].text;
	// A no-break space keeps each number on the line with its first word.
	return clean.map((row) => `${superscriptNumber(row.verse)}\u00a0${row.text}`).join(" ");
}

/**
 * Scripture as the card sets it: a single verse in curly quotes, a numbered
 * range bare (a quote mark before a superscript reads as a typo).
 */
export function quoteScripture(text: string): string {
	return /^[⁰¹²³⁴-⁹]/.test(text) ? text : `\u201c${text}\u201d`;
}

/** "Psalms 23:1" names the book; a verse from it is "Psalm 23:1". */
export function cardReferenceLabel(reference: string): string {
	return reference.replace(/^Psalms (?=\d)/, "Psalm ");
}

/**
 * "John 3:16-17" to "john-3-16-17": the path of that passage's public page,
 * the door every verse and cross card prints. Read back by
 * `referenceFromSlug` in reference.ts.
 */
export function verseSlug(reference: string): string {
	return reference
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

/** What a card prints for its door: short enough to type from a screenshot. */
export function verseDoor(reference: string): string {
	return `sureword.app/v/${verseSlug(reference)}`;
}

/** Full size is what gets shared; the preview is what the sheet shows. */
export const SHARE_CARD_PREVIEW_WIDTH = 540;
export type ShareCardSize = "full" | "preview";
export function parseShareCardSize(value: unknown): ShareCardSize {
	return value === "preview" ? "preview" : "full";
}

/**
 * ASCII whitespace only: JavaScript's \s also matches the no-break space that
 * binds a verse number to its word, and collapsing it would let the number
 * fall to the end of a line on its own.
 */
export function collapseWhitespace(text: string): string {
	return text.replace(/[ \t\r\n\f\v]+/g, " ").trim();
}

export interface WrapMetrics {
	table: GlyphWidthTable;
	/** Pixels. */
	fontSize: number;
	/** Pixels added after every glyph (CSS letter-spacing). */
	letterSpacing?: number;
}

export function measureText(text: string, metrics: WrapMetrics): number {
	const { table, fontSize, letterSpacing = 0 } = metrics;
	let width = 0;
	for (const char of text) {
		width += (table.widths[char] ?? table.fallback) * fontSize + letterSpacing;
	}
	return width;
}

/**
 * Greedy word wrap, the same rule satori applies: words stay whole, and a
 * single word wider than the line is put on a line of its own (satori lets
 * it overflow rather than hyphenate, and so does this count).
 */
export function wrapText(text: string, maxWidth: number, metrics: WrapMetrics): string[] {
	const words = collapseWhitespace(text).split(" ").filter(Boolean);
	const lines: string[] = [];
	let current = "";
	for (const word of words) {
		const candidate = current ? `${current} ${word}` : word;
		if (!current || measureText(candidate, metrics) <= maxWidth) {
			current = candidate;
		} else {
			lines.push(current);
			current = word;
		}
	}
	if (current) lines.push(current);
	return lines;
}

/**
 * Every box is measured as a little narrower than it is, so a line that
 * would only just fit wraps one word early here: that costs a sliver of size
 * and never an overflow. (Measured against satori on Esther 8:9 and Romans
 * 8:31-39, the summed advances already run about 10% wider than what it sets,
 * so this margin is on top of that one.)
 */
export const WRAP_SAFETY = 0.98;

export interface FitRequest {
	text: string;
	table: GlyphWidthTable;
	maxWidth: number;
	maxHeight: number;
	/** Candidate sizes in pixels, largest first. */
	sizes: readonly number[];
	/** Unitless CSS line-height. */
	lineHeight: number;
	letterSpacing?: number;
}

export interface FitResult {
	text: string;
	fontSize: number;
	lines: number;
	truncated: boolean;
}

export function fitText(request: FitRequest): FitResult {
	const { table, maxHeight, sizes, lineHeight, letterSpacing } = request;
	const text = collapseWhitespace(request.text);
	const width = request.maxWidth * WRAP_SAFETY;
	for (const fontSize of sizes) {
		const lines = wrapText(text, width, { table, fontSize, letterSpacing });
		if (lines.length * fontSize * lineHeight <= maxHeight) {
			return { text, fontSize, lines: lines.length, truncated: false };
		}
	}

	// Nothing fits: keep the smallest size and clip at a word, so the card
	// stays readable and says plainly that it continues.
	const fontSize = sizes[sizes.length - 1];
	const metrics = { table, fontSize, letterSpacing };
	const maxLines = Math.max(1, Math.floor(maxHeight / (fontSize * lineHeight)));
	const lines = wrapText(text, width, metrics).slice(0, maxLines);
	if (lines.length === 0) return { text: "", fontSize, lines: 0, truncated: text.length > 0 };
	let last = lines[lines.length - 1];
	while (last.includes(" ") && measureText(`${last}…`, metrics) > width) {
		last = last.slice(0, last.lastIndexOf(" "));
	}
	lines[lines.length - 1] = `${last.replace(/[\s,;:.\u2013\u2014-]+$/, "")}…`;
	return { text: lines.join(" "), fontSize, lines: lines.length, truncated: true };
}

/** "Thursday, October 16" in the reader's zone, never the server's. */
export function cardDateLabel(date: Date, timeZone?: string): string {
	try {
		return date.toLocaleDateString("en-US", {
			weekday: "long",
			month: "long",
			day: "numeric",
			timeZone,
		});
	} catch {
		// An unknown zone from the device: UTC is at least the same day for
		// everyone, where the server zone would be an accident of hosting.
		return date.toLocaleDateString("en-US", {
			weekday: "long",
			month: "long",
			day: "numeric",
			timeZone: "UTC",
		});
	}
}

/** What a card says. `render.tsx` decides only how it looks. */
export type ShareCardContent =
	| {
			kind: "verse";
			reference: string;
			translation: string;
			text: string;
			/** One line that turns the verse toward the reader (encouragement.ts). */
			encouragement: string | null;
			/** "sureword.app/v/john-3-16", the passage's public page. */
			door: string;
	  }
	| {
			kind: "cross";
			reference: string;
			translation: string;
			text: string;
			/** "Thursday, October 16". */
			dateLabel: string;
			/** The day's "Carry this" question, when the day has one. */
			question: string | null;
			door: string;
	  }
	| {
			kind: "answer";
			question: string;
			excerpt: string;
			/** The first Scripture the answer leaned on, when it had one. */
			reference: string | null;
	  };

/** A "Carry this" question or an answer's question, as long as a card shows. */
export const MAX_CARD_QUESTION_LENGTH = 220;

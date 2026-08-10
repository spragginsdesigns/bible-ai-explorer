/**
 * Tappable Bible references in chat text ("John 3:16" → deep link into the
 * Bible reader). The detection regex is ported from the web app
 * (src/utils/verseParser.ts); every candidate is additionally validated
 * through resolveReference, so a plausible-looking but unparseable string
 * ("John 99:16", "version 3:16") stays plain text and can never navigate into
 * the wrong book.
 */
import type { useRouter } from "expo-router";
import { resolveReference, type Reference } from "@/features/bible/books";

const BOOK_NAMES = [
	// Full names (order matters — longer first to avoid partial matches)
	"Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy",
	"Joshua", "Judges", "Ruth",
	"1 Samuel", "2 Samuel", "1 Kings", "2 Kings",
	"1 Chronicles", "2 Chronicles",
	"Ezra", "Nehemiah", "Esther",
	"Job", "Psalms?", "Proverbs", "Ecclesiastes", "Song of Solomon",
	"Isaiah", "Jeremiah", "Lamentations", "Ezekiel", "Daniel",
	"Hosea", "Joel", "Amos", "Obadiah", "Jonah", "Micah",
	"Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah", "Malachi",
	"Matthew", "Mark", "Luke", "John",
	"Acts", "Romans",
	"1 Corinthians", "2 Corinthians",
	"Galatians", "Ephesians", "Philippians", "Colossians",
	"1 Thessalonians", "2 Thessalonians",
	"1 Timothy", "2 Timothy",
	"Titus", "Philemon", "Hebrews", "James",
	"1 Peter", "2 Peter",
	"1 John", "2 John", "3 John",
	"Jude", "Revelation",
	// Common abbreviations
	"Gen\\.", "Exod\\.", "Lev\\.", "Num\\.", "Deut\\.",
	"Josh\\.", "Judg\\.", "Sam\\.", "Kgs\\.", "Chr\\.",
	"Neh\\.", "Esth\\.", "Ps\\.", "Prov\\.", "Eccles\\.",
	"Isa\\.", "Jer\\.", "Lam\\.", "Ezek\\.", "Dan\\.",
	"Hos\\.", "Ob\\.", "Mic\\.", "Nah\\.", "Hab\\.", "Zeph\\.", "Hag\\.", "Zech\\.", "Mal\\.",
	"Matt\\.", "Mk\\.", "Lk\\.", "Jn\\.",
	"Rom\\.", "Cor\\.", "Gal\\.", "Eph\\.", "Phil\\.", "Col\\.",
	"Thess\\.", "Tim\\.", "Tit\\.", "Phlm\\.", "Heb\\.", "Jas\\.",
	"Pet\\.", "Rev\\.",
];

const bookPattern = `(?:(?:[123]\\s)?(?:${BOOK_NAMES.join("|")}))`;
// Chapter:Verse with optional range (3:16, 1:1-3, 5:1–4 en dash, 21:1—4 em dash)
const refPattern = `\\d{1,3}:\\d{1,3}(?:\\s*[-–—]\\s*\\d{1,3})?`;
// Optional trailing translation tag (KJV, NIV, ESV, etc.)
const translationPattern = `(?:\\s+(?:KJV|NKJV|NIV|ESV|NASB|NLT|RSV|ASV|AMP))?`;

const REFERENCE_REGEX_SOURCE = `(${bookPattern}\\s+${refPattern}${translationPattern})`;

/** Case-insensitive so a lowercase "john 3:16" still links; the validator below guards against noise. */
export const VERSE_REFERENCE_REGEX = new RegExp(REFERENCE_REGEX_SOURCE, "gi");

const TRAILING_TRANSLATION = /\s+(?:KJV|NKJV|NIV|ESV|NASB|NLT|RSV|ASV|AMP)$/i;

/**
 * Resolve a detected reference (translation tag stripped first, since
 * resolveReference only accepts "Book chapter:verse[-end]") to a reader
 * location. Returns null for anything unparseable — callers must treat null
 * as "leave it as plain text, do nothing on tap".
 */
export function resolveVerseReference(raw: string): Reference | null {
	return resolveReference(raw.replace(TRAILING_TRANSLATION, ""));
}

export interface TextSegment {
	type: "text" | "verse-ref";
	value: string;
}

/** A reference must not start in the middle of a word ("xJohn 3:16"). */
function isWordBoundary(text: string, index: number): boolean {
	return index <= 0 || !/[A-Za-z0-9]/.test(text[index - 1]);
}

/** Split plain text into prose and verse-reference segments. */
export function segmentVerseReferences(text: string): TextSegment[] {
	const segments: TextSegment[] = [];
	const regex = new RegExp(REFERENCE_REGEX_SOURCE, "gi");
	let lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = regex.exec(text)) !== null) {
		const value = match[1];
		if (!isWordBoundary(text, match.index) || !resolveVerseReference(value)) continue;
		if (match.index > lastIndex) {
			segments.push({ type: "text", value: text.slice(lastIndex, match.index) });
		}
		segments.push({ type: "verse-ref", value });
		lastIndex = regex.lastIndex;
	}

	if (lastIndex < text.length) {
		segments.push({ type: "text", value: text.slice(lastIndex) });
	}
	return segments;
}

/** Href scheme used for the synthetic markdown links; never leaves the app. */
export const VERSE_REF_SCHEME = "verse-ref:";

type RouterLike = Pick<ReturnType<typeof useRouter>, "push">;

/**
 * Deep link into the reader exactly like the RetrievedVersesCard "Read" chip
 * (`?verse=` scrolls to and flashes the verse). Unresolvable input is a no-op.
 */
export function openReferenceInReader(router: RouterLike, raw: string): void {
	const target = resolveVerseReference(raw);
	if (!target) return;
	router.push({
		pathname: "/bible/chapter",
		params: {
			book: String(target.order),
			chapter: String(target.chapter),
			...(target.verse ? { verse: String(target.verse) } : {}),
		},
	});
}

// --- markdown-it plugin -----------------------------------------------------
// markdown-it ships no TypeScript types in this version, so the plugin is
// typed against the small structural surface it uses.

interface CoreToken {
	type: string;
	content: string;
	level: number;
	attrs: [string, string][] | null;
	children: CoreToken[] | null;
}

interface CoreState {
	tokens: CoreToken[];
	Token: new (type: string, tag: string, nesting: 1 | 0 | -1) => CoreToken;
}

interface MarkdownItLike {
	core: {
		ruler: {
			push(name: string, rule: (state: CoreState) => void): void;
		};
	};
}

/**
 * markdown-it plugin: splits plain-text tokens on validated references into
 * ordinary link tokens (href "verse-ref:<raw>"), which
 * react-native-markdown-display renders with the existing amber `link` style;
 * MarkdownBody's onLinkPress intercepts the scheme and routes into the reader
 * instead of opening a URL.
 *
 * Implemented as a core rule (not an inline rule) because markdown-it's
 * built-in `text` rule swallows whole plain-text spans before pushed inline
 * rules ever run. Runs after typographer replacements, so "--" is already an
 * en dash. Code spans and link labels are never split: code is a different
 * token type, and text inside links is tracked via link depth.
 */
export function verseReferencePlugin(md: MarkdownItLike): void {
	md.core.ruler.push("verse_reference", (state) => {
		for (const token of state.tokens) {
			if (token.type !== "inline" || !token.children) continue;

			const out: CoreToken[] = [];
			let linkDepth = 0;

			for (const child of token.children) {
				if (child.type === "link_open") linkDepth += 1;
				if (child.type === "link_close") linkDepth -= 1;

				if (child.type !== "text" || linkDepth > 0 || !child.content) {
					out.push(child);
					continue;
				}

				const segments = segmentVerseReferences(child.content);
				if (segments.length === 1 && segments[0].type === "text") {
					out.push(child);
					continue;
				}

				for (const segment of segments) {
					if (segment.type === "text") {
						const text = new state.Token("text", "", 0);
						text.content = segment.value;
						text.level = child.level;
						out.push(text);
					} else {
						const open = new state.Token("link_open", "a", 1);
						open.attrs = [["href", VERSE_REF_SCHEME + segment.value]];
						open.level = child.level;
						const label = new state.Token("text", "", 0);
						label.content = segment.value;
						label.level = child.level + 1;
						const close = new state.Token("link_close", "a", -1);
						close.level = child.level;
						out.push(open, label, close);
					}
				}
			}

			token.children = out;
		}
	});
}

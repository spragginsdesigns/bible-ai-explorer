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

/** Full book names. Order matters - longer first to avoid partial matches. */
const FULL_BOOK_NAMES = [
	"Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy",
	"Joshua", "Judges", "Ruth",
	"1 Samuel", "2 Samuel", "1 Kings", "2 Kings",
	"1 Chronicles", "2 Chronicles",
	"Ezra", "Nehemiah", "Esther",
	"Job", "Psalms?", "Proverbs", "Ecclesiastes", "Song of Solomon", "Song of Songs",
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
];

/**
 * Abbreviation stems written WITHOUT the trailing period. The pattern below
 * makes the period optional, so "Gen. 1:1", "Gen 1:1" and "Gen.1:1" all match;
 * every hit is still validated through resolveReference, so a stem the book
 * table does not recognise ("Jn", "Tit") simply stays plain text rather than
 * navigating somewhere wrong. Longer stems come first so "Ex" cannot shadow
 * "Exod".
 */
const BOOK_ABBREVIATIONS = [
	"Gen", "Exod", "Ex", "Lev", "Num", "Deut",
	"Josh", "Judg", "Sam", "Kgs", "Chr",
	"Neh", "Esth", "Ps", "Prov", "Eccles", "Eccl",
	"Isa", "Jer", "Lam", "Ezek", "Dan",
	"Hos", "Obad", "Ob", "Mic", "Nah", "Hab", "Zeph", "Hag", "Zech", "Mal",
	"Matt", "Mk", "Lk", "Jn",
	"Rom", "Cor", "Gal", "Eph", "Phlm", "Phil", "Col",
	"Thess", "Tim", "Tit", "Heb", "Jas",
	"Pet", "Rev", "Song",
];

// The numeral of a numbered book. The space is optional because models drop
// it constantly ("1Cor 5:17", "1Thess 1:1"), which the web parser has always
// accepted and Android silently did not; resolveVerseReference puts the space
// back before the book table sees it.
const numberedPrefix = `(?:[123]\\s?)?`;
// A full name must be followed by whitespace ("John3:16" is not a reference);
// an abbreviation ending in a period may butt straight against the chapter
// ("Gen.1:1"), which is how several models emit them.
const fullNameBranch = `${numberedPrefix}(?:${FULL_BOOK_NAMES.join("|")})\\s+`;
const abbreviationBranch = `${numberedPrefix}(?:${BOOK_ABBREVIATIONS.join("|")})(?:\\.\\s*|\\s+)`;
const bookPattern = `(?:${fullNameBranch}|${abbreviationBranch})`;
// Hyphen, en dash (U+2013) and em dash (U+2014) all separate a range. Written as
// escapes rather than literals so the source file stays ASCII-safe.
const rangeDashes = `[-\\u2013\\u2014]`;
// Chapter:Verse with an optional range (3:16, 1:1-3, en/em dashed forms),
// including a cross-chapter range (3:16-4:2).
const refPattern = `\\d{1,3}:\\d{1,3}(?:\\s*${rangeDashes}\\s*\\d{1,3}(?::\\d{1,3})?)?`;
// Refuse to stop mid-number: without this, "John 3:16-4:2" captures the
// truncated "John 3:16-4" and leaves a dangling ":2" beside the link. A bare
// trailing colon is fine and common in production prose ("...found in John
// 3:14:"), so only a colon that starts another number is rejected.
const referenceBoundary = `(?!\\d)(?!:\\d)`;
// Optional trailing translation tag (KJV, NIV, ESV, etc.)
const translationPattern = `(?:\\s+(?:KJV|NKJV|NIV|ESV|NASB|NLT|RSV|ASV|AMP))?`;

const REFERENCE_REGEX_SOURCE = `(${bookPattern}${refPattern}${referenceBoundary}${translationPattern})`;

/**
 * Case-insensitive so a lowercase "john 3:16" still links; the validator below
 * guards against noise. Built once at module scope and reused: Hermes has no
 * RegExp compilation cache, so recompiling this ~1 kB alternation for every
 * text token of every parse was measurable on device. segmentVerseReferences
 * resets `lastIndex` before each scan, which is what makes sharing it safe.
 */
export const VERSE_REFERENCE_REGEX = new RegExp(REFERENCE_REGEX_SOURCE, "gi");

const TRAILING_TRANSLATION = /\s+(?:KJV|NKJV|NIV|ESV|NASB|NLT|RSV|ASV|AMP)$/i;
/** "John 3:16-4:2" and an en-dashed "1 John 5:1-4" both open at their first verse. */
const TRAILING_RANGE = new RegExp(`\\s*${rangeDashes}\\s*\\d{1,3}(?::\\d{1,3})?$`);
/** "Gen.1:1" -> "Gen. 1:1": resolveReference requires whitespace before the chapter. */
const PERIOD_BEFORE_CHAPTER = /\.(\d)/;

/**
 * Abbreviations the bundled book table does not carry: books.json ships exactly
 * one abbr per book ("Mark", not "Mk"), so these forms matched the detection
 * regex and were then thrown away by the validator. Mapped here rather than in
 * the shared book data, which the reader and search also read.
 *
 * MIRRORED BY THE WEB CLIENT: `src/utils/verseParser.ts` carries the same stems
 * in its `ABBREVIATIONS` list, so a reference the phone links must be a
 * reference the web links. Exported so the pairing is greppable - add a stem to
 * one side and add it to the other in the same change, or the two clients drift
 * and the same answer renders different links in each.
 */
export const ABBREVIATION_ALIASES: Record<string, string> = {
	exod: "Exodus",
	eccles: "Ecclesiastes",
	ob: "Obadiah",
	mk: "Mark",
	lk: "Luke",
	jn: "John",
	tit: "Titus",
};

/**
 * Single-word book token immediately before the chapter number. The volume
 * numeral may be glued to it ("1Jn 5:1"), matching the detection regex.
 */
const SINGLE_WORD_BOOK = /^((?:[123]\s?)?)([A-Za-z]+)\.?(\s+\d.*)$/;

function expandAbbreviation(reference: string): string {
	const match = SINGLE_WORD_BOOK.exec(reference);
	if (!match) return reference;
	const full = ABBREVIATION_ALIASES[match[2].toLowerCase()];
	if (!full) return reference;
	// "1Jn 5:1" and "1 Jn 5:1" must both come out as "1 John 5:1": the book
	// table is keyed on the spaced form.
	const volume = match[1].trim();
	return `${volume ? `${volume} ` : ""}${full}${match[3]}`;
}

/**
 * Resolve a detected reference to a reader location. The translation tag, the
 * range tail and a missing space after an abbreviation's period are all
 * normalised away first, since resolveReference only accepts
 * "Book chapter:verse". Returns null for anything unparseable - callers must
 * treat null as "leave it as plain text, do nothing on tap".
 */
export function resolveVerseReference(raw: string): Reference | null {
	const bare = raw
		.replace(TRAILING_TRANSLATION, "")
		.replace(TRAILING_RANGE, "")
		.replace(PERIOD_BEFORE_CHAPTER, ". $1");
	return resolveReference(expandAbbreviation(bare));
}

export interface TextSegment {
	type: "text" | "verse-ref";
	value: string;
}

/** Hoisted with VERSE_REFERENCE_REGEX: a literal allocates a new RegExp per evaluation. */
const WORD_CHARACTER = /[A-Za-z0-9]/;

/** A reference must not start in the middle of a word ("xJohn 3:16"). */
function isWordBoundary(text: string, index: number): boolean {
	return index <= 0 || !WORD_CHARACTER.test(text[index - 1]);
}

/** Split plain text into prose and verse-reference segments. */
export function segmentVerseReferences(text: string): TextSegment[] {
	const segments: TextSegment[] = [];
	const regex = VERSE_REFERENCE_REGEX;
	regex.lastIndex = 0;
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
 *
 * Headings and table headers are skipped: the renderer resolves the `link`
 * style (accent colour + underline) on the link leaf only, so a reference
 * inside "## 2 Peter 1:19 in the NKJV" turns half the heading amber and
 * underlined while the rest stays plain.
 */
export function verseReferencePlugin(md: MarkdownItLike): void {
	md.core.ruler.push("verse_reference", (state) => {
		// Block containers whose inline tokens must be left as plain text.
		let skipDepth = 0;

		for (const token of state.tokens) {
			if (token.type === "heading_open" || token.type === "th_open") {
				skipDepth += 1;
				continue;
			}
			if (token.type === "heading_close" || token.type === "th_close") {
				skipDepth -= 1;
				continue;
			}
			if (skipDepth > 0) continue;
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

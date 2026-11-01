/**
 * Scripture Check's pure rules (LC-17649, docs/beta/verify.md): no imports,
 * so tests load this file with Node's type stripping. Words are folded for
 * comparison, a quotation is aligned word by word against the verses it is
 * checked with, and the alignment decides the verdict. The engine
 * (`engine.ts`) supplies the bundled KJV and BSB text; nothing here guesses.
 */

export const VERIFY_MODULE = "verify";
/** The longest teaching one check reads (a long sermon transcript is about 60,000). */
export const VERIFY_TEXT_MAX = 200_000;
/** A quotation needs this many words before it is worth checking. */
export const QUOTE_MIN_WORDS = 4;
/** Longer quotations are checked on their first this-many words. */
export const QUOTE_MAX_WORDS = 400;

export type Verdict = "exact" | "minor" | "translation" | "misquote" | "wrong-reference" | "not-found";

export const VERDICT_LABELS: Record<Verdict, string> = {
	exact: "Exact",
	minor: "Minor wording difference",
	translation: "Another translation",
	misquote: "Misquote",
	"wrong-reference": "Wrong reference",
	"not-found": "Not found in Scripture",
};

/** Verdicts that mean the teaching has the words or the citation wrong. */
export const PROBLEM_VERDICTS: readonly Verdict[] = ["misquote", "wrong-reference", "not-found"];

/** Translations bundled with SureWord and compared word for word. */
export const BUNDLED_TRANSLATIONS = ["KJV", "BSB"] as const;
export type BundledTranslation = (typeof BUNDLED_TRANSLATIONS)[number];

/**
 * same: the KJV's word. minor: spelling, an archaic form or a small connecting
 * word. changed: a different word. added: a word the verse does not have.
 * missing: a verse word the quotation leaves out. omitted: left out where the
 * quotation marks it ("..."). outside: verse words around the quoted part.
 */
export type Mark = "same" | "minor" | "changed" | "added" | "missing" | "omitted" | "outside";

export interface MarkedWord {
	text: string;
	mark: Mark;
	/** Passage side only: which of the compared verses the word belongs to (index into them). */
	verse?: number;
}

export interface Word {
	text: string;
	fold: string;
	loose: string;
	/** The quotation marks an omission ("..." or "…") right after this word. */
	ellipsisAfter?: boolean;
	verse?: number;
}

// Archaic forms and modern spellings that are the same word for this check.
const LOOSE_TABLE: Record<string, string> = {
	thee: "you", thou: "you", ye: "you", you: "you",
	thy: "your", thine: "your", your: "your", yours: "your",
	hath: "has", doth: "does", saith: "says", art: "are", shalt: "shall", wilt: "will",
	hast: "have", dost: "do", didst: "did", wast: "were", unto: "to",
	labour: "labor", saviour: "savior", honour: "honor", neighbour: "neighbor", favour: "favor",
	colour: "color", behaviour: "behavior", fulness: "fullness", judgement: "judgment",
	shew: "show", shewed: "showed", shewn: "shown", shewing: "showing", spake: "spoke", burnt: "burned",
	gaol: "jail", connexion: "connection", grey: "gray", tho: "though", wo: "woe", carcase: "carcas", carcases: "carcas",
};

/** Small words whose swap or loss does not change what a verse says. Never "not", "no", or a direction. */
const FUNCTION_WORDS = new Set([
	"a", "an", "the", "and", "but", "or", "for", "that", "which", "who", "whom", "as", "so", "also", "even",
	"then", "is", "are", "was", "were", "be", "been", "it", "of", "shall", "will", "has", "have", "does",
	"do", "did", "to", "unto", "now", "verily", "behold", "o", "oh", "yea",
]);

const ARCHAIC = new Set(["thee", "thou", "thy", "thine", "ye", "hath", "doth", "saith", "art", "shalt", "wilt", "hast", "dost", "didst", "wast", "unto"]);

/** Translations a teaching may name that SureWord does not bundle word for word. */
export const UNBUNDLED_TAGS = new Set(["NKJV", "NIV", "ESV", "NASB", "NLT", "RSV", "ASV", "AMP", "CSB", "NRSV", "MSG"]);

export function foldWord(word: string): string {
	return word.toLowerCase().replace(/[’'‘\-]/g, "");
}

/**
 * The loose form: archaic and modern forms, older spellings and doubled
 * letters ("carcases", "fulfil") and simple endings (-eth, -est, -s) fold to
 * one form, so they count as a minor difference, never as a different word.
 */
export function looseWord(word: string): string {
	const folded = foldWord(word);
	if (LOOSE_TABLE[folded]) return LOOSE_TABLE[folded];
	let stem = folded;
	if (stem.length > 5 && stem.endsWith("eth")) stem = stem.slice(0, -3);
	else if (stem.length > 6 && stem.endsWith("est")) stem = stem.slice(0, -3);
	else if (stem.length > 4 && /(?:ss|x|z|ch|sh)es$/.test(stem)) stem = stem.slice(0, -2);
	else if (stem.length > 3 && stem.endsWith("s") && !stem.endsWith("ss")) stem = stem.slice(0, -1);
	return stem.replace(/([a-z])\1+/g, "$1");
}

export function isFunctionWord(word: Word): boolean {
	return FUNCTION_WORDS.has(word.fold) || FUNCTION_WORDS.has(word.loose);
}

export function isArchaic(word: Word): boolean {
	return ARCHAIC.has(word.fold) || (word.fold.length > 5 && /(?:eth|est)$/.test(word.fold) && word.loose !== word.fold);
}

const WORD = /[\p{L}\p{N}]+(?:[’'\-][\p{L}\p{N}]+)*/gu;
const ELLIPSIS = /(?:\.\s?\.\s?\.|…)/y;

/**
 * The words of a quotation or verse, in order. Square-bracketed editorial
 * words ("[God has] summoned you") are not the quoted words and are skipped;
 * an ellipsis marks the word before it so an omission there is not an error.
 */
export function tokenize(text: string, verse?: number): Word[] {
	const clean = text.replace(/\[[^\]]{0,80}\]/g, " ");
	const words: Word[] = [];
	WORD.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = WORD.exec(clean)) !== null) {
		const word: Word = { text: match[0], fold: foldWord(match[0]), loose: looseWord(match[0]) };
		if (verse !== undefined) word.verse = verse;
		words.push(word);
		const after = clean.slice(WORD.lastIndex).match(/^[\s,;:"“”'‘’)]*/);
		ELLIPSIS.lastIndex = WORD.lastIndex + (after ? after[0].length : 0);
		if (ELLIPSIS.test(clean)) word.ellipsisAfter = true;
	}
	return words;
}

export interface Alignment {
	quote: MarkedWord[];
	passage: MarkedWord[];
	/** Quotation words that line up with a verse word, exactly or loosely. */
	matched: number;
	/** Of those, the ones that are not small connecting words. */
	matchedContent: number;
	/** The quotation's words that are not small connecting words. */
	contentWords: number;
	/** Differences that do not change the words' meaning. */
	minor: number;
	/** Changed, added or missing content words. */
	changed: number;
	/** Verse words in archaic form the quotation gives in modern form (thee → you). */
	modernSwaps: number;
	/** matched / quotation words. */
	coverage: number;
	/** Passage window the quotation covers, [start, end) in passage word indices. */
	start: number;
	end: number;
}

const SCORE_SAME = 3;
const SCORE_LOOSE = 2;
const SCORE_FUNCTION_SWAP = 0;
const SCORE_CHANGED = -1.5;

function gapCost(word: Word): number {
	return isFunctionWord(word) ? -1 : -2;
}

/**
 * Align a quotation against a passage: every quotation word is accounted for,
 * while the passage may be entered and left anywhere (a quotation is often
 * part of a verse). Scores favour the same word, then a loose match, and
 * prefer one changed word to a word added plus a word dropped.
 */
export function alignWords(quote: readonly Word[], passage: readonly Word[]): Alignment {
	const m = quote.length;
	const n = passage.length;
	const width = n + 1;
	const score = new Float64Array((m + 1) * width);
	const trace = new Uint8Array((m + 1) * width); // 1 diag, 2 up (quote word added), 3 left (passage word skipped)
	for (let i = 1; i <= m; i += 1) {
		score[i * width] = score[(i - 1) * width] + gapCost(quote[i - 1]);
		trace[i * width] = 2;
	}
	for (let i = 1; i <= m; i += 1) {
		const q = quote[i - 1];
		const skipFree = q.ellipsisAfter === true;
		for (let j = 1; j <= n; j += 1) {
			const p = passage[j - 1];
			const diag = score[(i - 1) * width + j - 1] + pairScore(q, p);
			const up = score[(i - 1) * width + j] + gapCost(q);
			const left = score[i * width + j - 1] + (skipFree ? 0 : gapCost(p));
			let best = diag;
			let move = 1;
			if (up > best) {
				best = up;
				move = 2;
			}
			if (left > best) {
				best = left;
				move = 3;
			}
			score[i * width + j] = best;
			trace[i * width + j] = move;
		}
	}
	let endJ = 0;
	for (let j = 1; j <= n; j += 1) if (score[m * width + j] > score[m * width + endJ]) endJ = j;

	const quoteMarks: MarkedWord[] = [];
	const passageMarks: (MarkedWord | null)[] = passage.map((word) => ({ text: word.text, mark: "outside" as Mark, verse: word.verse }));
	let matched = 0;
	let matchedContent = 0;
	let minor = 0;
	let changed = 0;
	let modernSwaps = 0;
	let i = m;
	let j = endJ;
	let start = endJ;
	while (i > 0) {
		const move = j === 0 ? 2 : trace[i * width + j];
		if (move === 1) {
			const q = quote[i - 1];
			const p = passage[j - 1];
			const kind = pairKind(q, p);
			if ((kind === "same" || kind === "loose") && !isFunctionWord(q)) matchedContent += 1;
			if (kind === "same") matched += 1;
			else if (kind === "loose") {
				matched += 1;
				minor += 1;
				if (isArchaic(p) && !isArchaic(q)) modernSwaps += 1;
			} else if (kind === "function") minor += 1;
			else changed += 1;
			const mark: Mark = kind === "same" ? "same" : kind === "changed" ? "changed" : "minor";
			quoteMarks.push({ text: q.text, mark });
			passageMarks[j - 1] = { text: p.text, mark, verse: p.verse };
			i -= 1;
			j -= 1;
			start = j;
		} else if (move === 2) {
			const q = quote[i - 1];
			if (isFunctionWord(q)) minor += 1;
			else changed += 1;
			quoteMarks.push({ text: q.text, mark: isFunctionWord(q) ? "minor" : "added" });
			i -= 1;
		} else {
			const p = passage[j - 1];
			const omitted = quote[i - 1].ellipsisAfter === true;
			if (!omitted) {
				if (isFunctionWord(p)) minor += 1;
				else changed += 1;
			}
			passageMarks[j - 1] = { text: p.text, mark: omitted ? "omitted" : isFunctionWord(p) ? "minor" : "missing", verse: p.verse };
			j -= 1;
			start = j;
		}
	}
	quoteMarks.reverse();
	return {
		quote: quoteMarks,
		passage: passageMarks as MarkedWord[],
		matched,
		matchedContent,
		contentWords: quote.filter((word) => !isFunctionWord(word)).length,
		minor,
		changed,
		modernSwaps,
		coverage: m === 0 ? 0 : matched / m,
		start,
		end: endJ,
	};
}

type PairKind = "same" | "loose" | "function" | "changed";

function pairKind(q: Word, p: Word): PairKind {
	if (q.fold === p.fold) return "same";
	if (q.loose === p.loose) return "loose";
	if (isFunctionWord(q) && isFunctionWord(p)) return "function";
	return "changed";
}

function pairScore(q: Word, p: Word): number {
	const kind = pairKind(q, p);
	if (kind === "same") return SCORE_SAME;
	if (kind === "loose") return SCORE_LOOSE;
	if (kind === "function") return SCORE_FUNCTION_SWAP;
	return SCORE_CHANGED;
}

/**
 * Is this alignment the quotation's verse at all (as against some other
 * text)? Enough of the words line up, and enough of the words that carry
 * meaning: "a speck on the surface of the earth" shares "on the ... of the
 * earth" with Genesis 6:1 and is still not Genesis 6:1.
 */
export function isSamePassage(alignment: Alignment, quoteWords: number, threshold = 0.5): boolean {
	return (
		alignment.coverage >= threshold &&
		alignment.matched >= Math.min(3, quoteWords) &&
		alignment.matchedContent >= Math.min(2, alignment.contentWords) &&
		alignment.matchedContent >= alignment.contentWords * threshold
	);
}

/**
 * The verdict on a quotation checked against the verse it is (wrong
 * references and words not in Scripture are decided by the engine, which
 * knows where else the words are). Only spelling, archaic forms and small
 * connecting words make a difference "minor". A quotation in modern English
 * that the alignment shows is this verse (it modernises the KJV's archaic
 * words and keeps none of its own, or names a translation SureWord does not
 * bundle) is "another translation": not checked word for word, never called a
 * misquote. A quotation that names the KJV or the BSB is held to it. Anything
 * else that changes, adds or drops a word is a misquote. `kjvModernSwaps` is
 * the KJV alignment's count even when the BSB was the closer comparison.
 */
export function quotationVerdict(
	alignment: Alignment,
	quote: readonly Word[],
	statedTranslation: string | null,
	kjvModernSwaps = alignment.modernSwaps,
): "exact" | "minor" | "translation" | "misquote" {
	if (alignment.changed === 0 && alignment.minor === 0) return "exact";
	if (alignment.changed === 0 && alignment.minor <= Math.max(2, Math.ceil(quote.length * 0.34))) return "minor";
	const stated = statedTranslation?.toUpperCase() ?? null;
	if (stated !== null && (BUNDLED_TRANSLATIONS as readonly string[]).includes(stated)) return "misquote";
	const keepsArchaic = quote.some((word) => isArchaic(word));
	const modern = (stated !== null && UNBUNDLED_TAGS.has(stated)) || (kjvModernSwaps > 0 && !keepsArchaic);
	if (modern && alignment.coverage >= 0.35) return "translation";
	return "misquote";
}

/** How many words differ in a way the reader should look at (for picking the closer translation). */
export function differenceWeight(alignment: Alignment): number {
	return alignment.changed * 3 + alignment.minor;
}

export interface QuoteSpan {
	/** Offsets into the teaching of the whole quotation, marks included. */
	start: number;
	end: number;
	/** The quoted words only. */
	text: string;
	/** Offset of `text` in the teaching. */
	textStart: number;
	block: boolean;
}

/**
 * Quotations the teaching marks: curly or straight double quotes within a
 * paragraph, and Markdown blockquotes ("> ..."). Inner quotes inside a
 * quotation are left to it; spans of fewer than three words are skipped.
 */
export function findQuoteSpans(text: string): QuoteSpan[] {
	const spans: QuoteSpan[] = [];
	const blockLine = /^[ \t]*>[ \t]?(.*)$/gm;
	let match: RegExpExecArray | null;
	let block: { start: number; end: number } | null = null;
	const blocks: { start: number; end: number }[] = [];
	while ((match = blockLine.exec(text)) !== null) {
		const lineEnd = match.index + match[0].length;
		if (block && text.slice(block.end, match.index).trim() === "") block.end = lineEnd;
		else {
			block = { start: match.index, end: lineEnd };
			blocks.push(block);
		}
	}
	for (const range of blocks) {
		const raw = text.slice(range.start, range.end);
		const inner = raw.replace(/^[ \t]*>[ \t]?/gm, "");
		if (countWords(inner) >= QUOTE_MIN_WORDS) spans.push({ start: range.start, end: range.end, text: inner, textStart: range.start, block: true });
	}
	const insideBlock = (at: number) => blocks.some((range) => at >= range.start && at < range.end);
	const pairs = [/“([^”]{1,4000}?)”/g, /(?<![\p{L}\p{N}])"([^"]{1,4000}?)"/gu];
	for (const pattern of pairs) {
		pattern.lastIndex = 0;
		while ((match = pattern.exec(text)) !== null) {
			const inner = match[1];
			if (/\n[ \t]*\n/.test(inner) || insideBlock(match.index)) continue;
			if (spans.some((span) => match!.index >= span.start && match!.index < span.end)) continue;
			if (countWords(inner) < QUOTE_MIN_WORDS) continue;
			spans.push({ start: match.index, end: match.index + match[0].length, text: inner, textStart: match.index + 1, block: false });
		}
	}
	return spans.sort((a, b) => a.start - b.start);
}

function countWords(text: string): number {
	return text.match(WORD)?.length ?? 0;
}

const SCRIPTURE_SPEAKERS =
	"bible|scriptures?|word of god|god's word|god’s word|the word|it is written|jesus|christ|the lord|lord|god|the spirit|holy spirit|paul|peter|john|james|jude|moses|david|solomon|isaiah|jeremiah|ezekiel|daniel|the psalmist|psalmist|the prophet|prophet|the apostle|apostle|proverbs?|psalms?|the gospel|gospels";
// Third person only: "say, ..." (an imperative) introduces the speaker's own words.
const SCRIPTURE_VERBS =
	"says|said|saith|writes|wrote|written|tells|told|promises|promised|declares|declared|teaches|taught|commands|commanded|invites|invited|answered|answers|warns|warned|reminds|reminded|puts it|records|recorded|calls|called|exhorts|urges|cried|cries";
const PRESENTED_AS_SCRIPTURE = new RegExp(`\\b(?:${SCRIPTURE_SPEAKERS})\\b[^.!?"“”]{0,40}?\\b(?:${SCRIPTURE_VERBS})\\b[^.!?"“”]{0,30}$`, "i");
const WRITTEN_INTRO = /\b(?:it is written|as it is written|scriptures? say|scriptures? says|the scriptures tell|the bible says)\b[^.!?"“”]{0,30}$/i;

/**
 * Does the teaching present the quotation as Scripture? The words just before
 * it in the same sentence name Scripture or a biblical speaker with a verb of
 * saying ("The Bible also promises,", "Jesus invites us,", "Paul writes:").
 * "As C. S. Lewis wrote," is a person, not Scripture.
 */
export function presentedAsScripture(before: string): boolean {
	const sentence = before.slice(-120).split(/(?<=[.!?]["”’]?)\s+/).pop() ?? "";
	return PRESENTED_AS_SCRIPTURE.test(sentence) || WRITTEN_INTRO.test(sentence);
}

/** Text between a quotation and a citation that still ties them together. */
export function citesAfter(between: string): boolean {
	return between.length <= 8 && /^[\s,.;:()\-–—]*$/.test(between);
}

/** Text between a citation and a quotation after it, in the same sentence ("John 10:3 says, "). */
export function citesBefore(between: string): boolean {
	return between.length <= 40 && !/[.!?"“”]/.test(between.replace(/^\s*\.\s*/, ""));
}

/** Offsets of the passage the alignment actually covers: the indices of the first and last verse touched. */
export function touchedVerses(alignment: Alignment): number[] {
	const touched = new Set<number>();
	for (const word of alignment.passage) if (word.mark !== "outside" && word.verse !== undefined) touched.add(word.verse);
	return [...touched].sort((a, b) => a - b);
}

/** Convert an old-style Roman chapter number ("xxxii") to Arabic, or null. */
export function romanToNumber(numeral: string): number | null {
	const values: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100 };
	const lower = numeral.toLowerCase();
	if (!/^[ivxlc]+$/.test(lower)) return null;
	let total = 0;
	for (let k = 0; k < lower.length; k += 1) {
		const value = values[lower[k]];
		const next = values[lower[k + 1]] ?? 0;
		total += value < next ? -value : value;
	}
	return total > 0 && total <= 150 ? total : null;
}

// ---------------------------------------------------------------------------
// The report a check returns (built by engine.ts, shown by the components).

export interface PassageSpan {
	book: number;
	chapter: number;
	verse: number;
	endVerse: number;
	label: string;
}

export interface ReferenceFinding {
	/** As written in the teaching. */
	written: string;
	start: number;
	end: number;
	book: number;
	chapter: number;
	verse: number | null;
	endVerse: number | null;
	label: string;
	translationTag: string | null;
	/** Null when the reference is real; otherwise why it is not ("Psalms has 150 chapters"). */
	problem: string | null;
	/** The first verses of what it points to, from the bundled KJV. */
	preview: { verse: number; text: string }[];
	/** True when a quotation in the teaching carries this citation. */
	quoted: boolean;
}

export interface QuotationFinding {
	id: string;
	start: number;
	end: number;
	quote: string;
	verdict: Verdict;
	/** The bundled translation the words were compared with (the closer one). */
	comparedWith: BundledTranslation;
	statedTranslation: string | null;
	/** The citation the teaching gives, if any. */
	cited: PassageSpan | null;
	/** Where the words are in Scripture (the cited place, or where they really are). */
	passage: PassageSpan | null;
	quoteWords: MarkedWord[];
	passageWords: MarkedWord[];
	/** The verse numbers `passageWords` belong to, by `MarkedWord.verse`. */
	passageVerses: number[];
	note: string;
	presentedAsScripture: boolean;
}

export interface VerifyReport {
	textLength: number;
	quotations: QuotationFinding[];
	references: ReferenceFinding[];
	counts: Record<Verdict, number>;
}

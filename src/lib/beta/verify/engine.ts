import "server-only";

import { BOOKS, bookByOrder, resolveReference } from "@/lib/bible/books";
import { getBsbChapter, loadBsbChapter } from "@/lib/bible/bsb";
import { getKjvBook } from "@/lib/bible/kjv";
import { SINGLE_BOOK_NAMES, NUMBERED_BOOK_NAMES, TRANSLATION_TAGS, VERSE_REFERENCE_REGEX, stripTranslationTag } from "@/utils/verseParser";
import {
	QUOTE_MAX_WORDS,
	QUOTE_MIN_WORDS,
	type Alignment,
	type BundledTranslation,
	type PassageSpan,
	type QuotationFinding,
	type ReferenceFinding,
	type Verdict,
	type VerifyReport,
	type Word,
	alignWords,
	citesAfter,
	citesBefore,
	differenceWeight,
	findQuoteSpans,
	isSamePassage,
	presentedAsScripture,
	quotationVerdict,
	romanToNumber,
	tokenize,
	touchedVerses,
} from "./verify-rules";

/**
 * Scripture Check's deterministic engine (LC-17649, docs/beta/verify.md).
 * Every explicit reference in a teaching is found and resolved through
 * `resolveReference`; every marked quotation is aligned word by word against
 * the verses it cites, and against the whole bundled KJV when it cites none
 * or cites the wrong place. No model is involved: the verdicts are what the
 * bundled text says.
 */

// ---------------------------------------------------------------------------
// The bundled KJV, indexed once per server instance.

interface CorpusVerse {
	book: number;
	chapter: number;
	verse: number;
	text: string;
	words: Word[];
}

interface Corpus {
	verses: CorpusVerse[];
	/** "book.chapter.verse" -> index in `verses`. */
	at: Map<string, number>;
	/** loose word -> indices of verses that contain it. */
	postings: Map<string, number[]>;
}

let corpusPromise: Promise<Corpus> | null = null;

function loadCorpus(): Promise<Corpus> {
	corpusPromise ??= (async () => {
		const verses: CorpusVerse[] = [];
		const at = new Map<string, number>();
		const postings = new Map<string, number[]>();
		for (const book of BOOKS) {
			const chapters = await getKjvBook(book.order);
			chapters.forEach((chapterVerses, c) => {
				chapterVerses.forEach((text, v) => {
					const index = verses.length;
					const words = tokenize(text);
					verses.push({ book: book.order, chapter: c + 1, verse: v + 1, text, words });
					at.set(`${book.order}.${c + 1}.${v + 1}`, index);
					for (const loose of new Set(words.map((word) => word.loose))) {
						const list = postings.get(loose);
						if (list) list.push(index);
						else postings.set(loose, [index]);
					}
				});
			});
		}
		return { verses, at, postings };
	})().catch((error) => {
		corpusPromise = null;
		throw error;
	});
	return corpusPromise;
}

function chapterLength(corpus: Corpus, book: number, chapter: number): number {
	let verse = 0;
	while (corpus.at.has(`${book}.${chapter}.${verse + 1}`)) verse += 1;
	return verse;
}

export function spanLabel(book: number, chapter: number, verse: number | null, endVerse: number | null): string {
	const name = bookByOrder(book)?.name ?? `Book ${book}`;
	if (verse === null) return `${name} ${chapter}`;
	return endVerse !== null && endVerse > verse ? `${name} ${chapter}:${verse}-${endVerse}` : `${name} ${chapter}:${verse}`;
}

// ---------------------------------------------------------------------------
// References.

interface RawReference {
	written: string;
	start: number;
	end: number;
	book: number;
	chapter: number;
	verse: number | null;
	endVerse: number | null;
	translationTag: string | null;
	/** References written as one citation ("Psalm 73:18, 19" or "Romans 8:28; 9:1") share a group. */
	group: number;
	unresolved?: string;
}

const DASH = "[-\\u2013\\u2014]";
const LIST_TAIL = new RegExp(`^(?:\\s*[,;]\\s*(?:\\d{1,3}:)?\\d{1,3}(?:\\s*${DASH}\\s*\\d{1,3})?(?![\\d,]*\\d{3}\\b)(?![:\\d]))+`);
// Case-sensitive: a translation is written in capitals ("BSB"), and "amp up" is not the AMP.
const TAG_AFTER = new RegExp(`^\\s*[,(]?\\s*(${TRANSLATION_TAGS})\\b`);
const FULL_BOOK = `(?:[1-3]\\s?(?:${NUMBERED_BOOK_NAMES.join("|")})|${SINGLE_BOOK_NAMES.join("|")})`;
const UNIT_WORDS = "weeks?|days?|years?|times?|hours?|minutes?|months?|men|people|of|chapters?|verses?|percent|miles?|am|pm|a\\.m|p\\.m";
const CHAPTER_ONLY = new RegExp(`\\b(${FULL_BOOK})\\s+(\\d{1,3})\\b(?![:.,]?\\d)(?!\\s*(?:${UNIT_WORDS})\\b)`, "g");
const ROMAN = /\b((?:[1-3]\s?)?[A-Z][A-Za-z]+)\.?\s+([ivxlcIVXLC]{1,8})\.\s*(\d{1,3})((?:\s*,\s*\d{1,3}(?!\d))*)/g;

function parseVersePart(rest: string): { chapter: number; verse: number; endChapter: number; endVerse: number } | null {
	const match = rest.match(new RegExp(`(\\d{1,3})\\s*:\\s*(\\d{1,3})(?:\\s*${DASH}\\s*(\\d{1,3})(?:\\s*:\\s*(\\d{1,3}))?)?`));
	if (!match) return null;
	const chapter = Number(match[1]);
	const verse = Number(match[2]);
	if (match[4] !== undefined) return { chapter, verse, endChapter: Number(match[3]), endVerse: Number(match[4]) };
	const endVerse = match[3] !== undefined ? Number(match[3]) : verse;
	return { chapter, verse, endChapter: chapter, endVerse };
}

function findRawReferences(text: string): RawReference[] {
	const found: RawReference[] = [];
	const taken: [number, number][] = [];
	const overlaps = (start: number, end: number) => taken.some(([s, e]) => start < e && end > s);
	let group = 0;

	const regex = new RegExp(VERSE_REFERENCE_REGEX.source, "gi");
	let match: RegExpExecArray | null;
	while ((match = regex.exec(text)) !== null) {
		const written = match[1];
		const start = match.index + match[0].indexOf(written);
		let end = start + written.length;
		const bare = stripTranslationTag(written);
		const resolved = resolveReference(bare);
		const parts = parseVersePart(bare.slice(bare.search(/\d+\s*:/)));
		group += 1;
		if (!resolved || !parts) {
			const named = resolveReference(bare.replace(/\s*\d+\s*:.*$/, " 1"));
			if (named) {
				found.push({ written, start, end, book: named.order, chapter: parts?.chapter ?? 0, verse: parts?.verse ?? null, endVerse: null, translationTag: null, group, unresolved: "chapter" });
				taken.push([start, end]);
			}
			continue;
		}
		const tagInside = written.slice(bare.length).trim();
		const entries: Omit<RawReference, "written" | "start" | "end" | "group" | "translationTag">[] = [];
		const endVerse = parts.endChapter === parts.chapter ? parts.endVerse : parts.verse;
		entries.push({ book: resolved.order, chapter: parts.chapter, verse: parts.verse, endVerse });
		if (!tagInside) {
			const tail = text.slice(end).match(LIST_TAIL);
			if (tail) {
				let chapter = parts.chapter;
				for (const piece of tail[0].split(/[,;]/).slice(1)) {
					const m = piece.trim().match(new RegExp(`^(?:(\\d{1,3}):)?(\\d{1,3})(?:\\s*${DASH}\\s*(\\d{1,3}))?$`));
					if (!m) continue;
					if (m[1]) chapter = Number(m[1]);
					entries.push({ book: resolved.order, chapter, verse: Number(m[2]), endVerse: m[3] ? Number(m[3]) : Number(m[2]) });
				}
				end += tail[0].length;
			}
		}
		const tagAfter = tagInside ? null : text.slice(end).match(TAG_AFTER);
		const translationTag = (tagInside || tagAfter?.[1] || "").toUpperCase() || null;
		const writtenAll = text.slice(start, end);
		for (const entry of entries) found.push({ ...entry, written: writtenAll, start, end, group, translationTag });
		taken.push([start, end]);
	}

	ROMAN.lastIndex = 0;
	while ((match = ROMAN.exec(text)) !== null) {
		const chapter = romanToNumber(match[2]);
		const resolved = chapter ? resolveReference(`${match[1]} ${chapter}:${match[3]}`) : null;
		if (!resolved || !chapter || overlaps(match.index, match.index + match[0].length)) continue;
		group += 1;
		const verses = [Number(match[3]), ...(match[4].match(/\d{1,3}/g) ?? []).map(Number)];
		const sorted = [...new Set(verses)].sort((a, b) => a - b);
		const consecutive = sorted.every((v, k) => k === 0 || v === sorted[k - 1] + 1);
		const entries = consecutive ? [{ verse: sorted[0], endVerse: sorted[sorted.length - 1] }] : sorted.map((v) => ({ verse: v, endVerse: v }));
		for (const entry of entries) {
			found.push({ written: match[0], start: match.index, end: match.index + match[0].length, book: resolved.order, chapter, ...entry, translationTag: null, group });
		}
		taken.push([match.index, match.index + match[0].length]);
	}

	CHAPTER_ONLY.lastIndex = 0;
	while ((match = CHAPTER_ONLY.exec(text)) !== null) {
		const start = match.index;
		const end = start + match[0].length;
		if (overlaps(start, end)) continue;
		const named = resolveReference(`${match[1]} 1`);
		if (!named) continue;
		group += 1;
		const chapter = Number(match[2]);
		found.push({ written: match[0], start, end, book: named.order, chapter, verse: null, endVerse: null, translationTag: null, group, unresolved: resolveReference(match[0]) ? undefined : "chapter" });
		taken.push([start, end]);
	}
	return found.sort((a, b) => a.start - b.start || (a.verse ?? 0) - (b.verse ?? 0));
}

function checkReference(corpus: Corpus, raw: RawReference): ReferenceFinding {
	const book = bookByOrder(raw.book);
	const name = book?.name ?? "That book";
	let problem: string | null = null;
	let preview: { verse: number; text: string }[] = [];
	if (!book || raw.chapter < 1 || raw.chapter > book.chapters) {
		problem = `${name} has ${book?.chapters ?? 0} chapter${book?.chapters === 1 ? "" : "s"}, so there is no chapter ${raw.chapter}.`;
	} else {
		const length = chapterLength(corpus, raw.book, raw.chapter);
		const first = raw.verse ?? 1;
		const last = raw.verse === null ? Math.min(length, 3) : Math.min(raw.endVerse ?? first, length);
		if (raw.verse !== null && raw.verse > length) problem = `${name} ${raw.chapter} has ${length} verses, so there is no verse ${raw.verse}.`;
		else if (raw.endVerse !== null && raw.endVerse < (raw.verse ?? 0)) problem = `The range ends before it starts.`;
		else
			for (let v = first; v <= Math.min(last, first + 2); v += 1) {
				const index = corpus.at.get(`${raw.book}.${raw.chapter}.${v}`);
				if (index !== undefined) preview.push({ verse: v, text: corpus.verses[index].text });
			}
	}
	if (problem) preview = [];
	return {
		written: raw.written.replace(/\s+/g, " "),
		start: raw.start,
		end: raw.end,
		book: raw.book,
		chapter: raw.chapter,
		verse: raw.verse,
		endVerse: raw.endVerse,
		label: spanLabel(raw.book, raw.chapter, raw.verse, raw.endVerse),
		translationTag: raw.translationTag,
		problem,
		preview,
		quoted: false,
	};
}

// ---------------------------------------------------------------------------
// Quotations.

function passageWords(corpus: Corpus, indices: number[]): Word[] {
	return indices.flatMap((index, k) => corpus.verses[index].words.map((word) => ({ ...word, verse: k })));
}

function indicesFor(corpus: Corpus, refs: RawReference[]): number[] {
	const indices: number[] = [];
	for (const ref of refs) {
		const first = ref.verse ?? 1;
		const last = ref.verse === null ? chapterLength(corpus, ref.book, ref.chapter) : Math.max(first, ref.endVerse ?? first);
		for (let v = first; v <= last; v += 1) {
			const index = corpus.at.get(`${ref.book}.${ref.chapter}.${v}`);
			if (index !== undefined && !indices.includes(index)) indices.push(index);
		}
	}
	return indices;
}

/** The verses most likely to hold these words: rare words shared, weighted by how rare. */
function searchCorpus(corpus: Corpus, quote: Word[], limit = 8): number[] {
	const total = corpus.verses.length;
	const scores = new Map<number, number>();
	for (const loose of new Set(quote.map((word) => word.loose))) {
		const list = corpus.postings.get(loose);
		if (!list || list.length > 4000) continue;
		const weight = Math.log(total / list.length);
		for (const index of list) scores.set(index, (scores.get(index) ?? 0) + weight);
	}
	return [...scores.entries()]
		.sort((a, b) => b[1] - a[1] || a[0] - b[0])
		.slice(0, limit)
		.map(([index]) => index);
}

/** Align against a candidate verse and its neighbours, then keep only the verses the words touch. */
function bestNear(corpus: Corpus, quote: Word[], centres: number[]): { alignment: Alignment; indices: number[] } | null {
	let best: { alignment: Alignment; indices: number[] } | null = null;
	const reach = Math.max(1, Math.ceil(quote.length / 22));
	for (const centre of centres) {
		const { book, chapter } = corpus.verses[centre];
		const indices: number[] = [];
		for (let k = centre - reach; k <= centre + reach; k += 1) {
			const verse = corpus.verses[k];
			if (verse && verse.book === book && verse.chapter === chapter) indices.push(k);
		}
		const alignment = alignWords(quote, passageWords(corpus, indices));
		if (!best || alignment.matched > best.alignment.matched || (alignment.matched === best.alignment.matched && alignment.changed < best.alignment.changed)) {
			best = { alignment, indices };
		}
	}
	if (!best) return null;
	const touched = touchedVerses(best.alignment).map((k) => best!.indices[k]);
	if (touched.length === 0) return best;
	const first = Math.min(...touched);
	const last = Math.max(...touched);
	const indices = best.indices.filter((index) => index >= first && index <= last);
	return { alignment: alignWords(quote, passageWords(corpus, indices)), indices };
}

function spanOf(corpus: Corpus, indices: number[]): PassageSpan | null {
	if (indices.length === 0) return null;
	const first = corpus.verses[indices[0]];
	const last = corpus.verses[indices[indices.length - 1]];
	const endVerse = last.chapter === first.chapter ? last.verse : first.verse;
	return { book: first.book, chapter: first.chapter, verse: first.verse, endVerse, label: spanLabel(first.book, first.chapter, first.verse, endVerse) };
}

function citedSpan(refs: RawReference[]): PassageSpan | null {
	const ref = refs[0];
	if (!ref) return null;
	const last = refs[refs.length - 1];
	const endVerse = refs.length > 1 && last.chapter === ref.chapter ? (last.endVerse ?? last.verse) : ref.endVerse;
	return { book: ref.book, chapter: ref.chapter, verse: ref.verse ?? 1, endVerse: endVerse ?? ref.verse ?? 1, label: spanLabel(ref.book, ref.chapter, ref.verse, endVerse) };
}

/**
 * The cited verses, or the cited verses and the one before or after them when
 * the quotation runs on into it (cited 4:6, quoting 4:6-7). The neighbour is
 * taken only when it makes the match closer and a cited verse is still among
 * the verses the words cover, so 3:16 cited as 3:17 stays a wrong reference.
 */
function runOn(corpus: Corpus, quote: Word[], cited: number[]): { alignment: Alignment; indices: number[] } {
	const direct = { alignment: alignWords(quote, passageWords(corpus, cited)), indices: cited };
	if (direct.alignment.changed === 0) return direct;
	const first = corpus.verses[cited[0]];
	const wider = [cited[0] - 1, ...cited, cited[cited.length - 1] + 1].filter((index) => {
		const verse = corpus.verses[index];
		return verse !== undefined && verse.book === first.book && verse.chapter === first.chapter;
	});
	const alignment = alignWords(quote, passageWords(corpus, wider));
	const touched = touchedVerses(alignment).map((k) => wider[k]);
	if (!touched.some((index) => cited.includes(index)) || differenceWeight(alignment) >= differenceWeight(direct.alignment)) return direct;
	const indices = wider.filter((index) => index >= Math.min(...touched) && index <= Math.max(...touched));
	return { alignment: alignWords(quote, passageWords(corpus, indices)), indices };
}

/** The BSB wording of the same verses, aligned, when the BSB is bundled for them. */
async function bsbAlignment(corpus: Corpus, quote: Word[], indices: number[]): Promise<Alignment | null> {
	const words: Word[] = [];
	for (const [k, index] of indices.entries()) {
		const { book, chapter, verse } = corpus.verses[index];
		try {
			await loadBsbChapter(book, chapter);
		} catch {
			return null;
		}
		const text = getBsbChapter(book, chapter).find((entry) => entry.number === verse)?.text;
		if (!text) return null;
		words.push(...tokenize(text, k));
	}
	return words.length ? alignWords(quote, words) : null;
}

interface Compared {
	alignment: Alignment;
	comparedWith: BundledTranslation;
	/** The KJV alignment's archaic-to-modern swaps, which say whether this is modern English. */
	kjvModernSwaps: number;
}

/** The closer of the KJV and the BSB for these verses; the KJV between equals. */
async function closerTranslation(corpus: Corpus, quote: Word[], indices: number[], kjv: Alignment): Promise<Compared> {
	const kjvModernSwaps = kjv.modernSwaps;
	if (kjv.changed === 0 && kjv.minor === 0) return { alignment: kjv, comparedWith: "KJV", kjvModernSwaps };
	const bsb = await bsbAlignment(corpus, quote, indices);
	if (bsb && differenceWeight(bsb) < differenceWeight(kjv) && isSamePassage(bsb, quote.length)) return { alignment: bsb, comparedWith: "BSB", kjvModernSwaps };
	return { alignment: kjv, comparedWith: "KJV", kjvModernSwaps };
}

function noteFor(verdict: Verdict, comparedWith: BundledTranslation, cited: PassageSpan | null, passage: PassageSpan | null, stated: string | null): string {
	const where = passage?.label ?? "";
	switch (verdict) {
		case "exact":
			return `Word for word the ${comparedWith} of ${where}${stated && stated !== comparedWith ? ` (given as the ${stated}, which SureWord does not bundle)` : ""}.`;
		case "minor":
			return `The words of ${where}${cited ? "" : " (not cited)"}, with only spelling, older word forms or small connecting words different from the ${comparedWith}.`;
		case "translation":
			return `${where} in modern English${stated ? ` (given as the ${stated})` : ""}. SureWord does not bundle that translation, so it is shown beside the KJV rather than checked word for word.`;
		case "misquote":
			return cited
				? `Presented as ${where}, but words are changed, added or missing compared with the ${comparedWith}.`
				: `Not cited. The nearest verse is ${where}, and words are changed, added or missing compared with the ${comparedWith}.`;
		case "wrong-reference":
			return `Cited as ${cited?.label ?? "another passage"}, but these words are ${where}.`;
		case "not-found":
			return cited
				? `Cited as ${cited.label}, but these words are not in that passage or anywhere else in the KJV.`
				: "Presented as Scripture, but these words are not anywhere in the KJV.";
	}
}

let findingId = 0;

async function checkQuotation(
	corpus: Corpus,
	span: { start: number; end: number; text: string },
	cited: RawReference[],
	asScripture: boolean,
): Promise<QuotationFinding | null> {
	const quote = tokenize(span.text).slice(0, QUOTE_MAX_WORDS);
	if (quote.length < QUOTE_MIN_WORDS) return null;
	const usable = cited.filter((ref) => !ref.unresolved);
	const stated = cited.find((ref) => ref.translationTag)?.translationTag ?? null;
	const citedPassage = citedSpan(usable.length ? usable : cited);

	let indices: number[] = [];
	let alignment: Alignment | null = null;
	let verdict: Verdict | null = null;

	if (usable.length) {
		const citedIndices = indicesFor(corpus, usable);
		if (citedIndices.length) {
			const whole = usable.some((ref) => ref.verse === null);
			const near = whole ? bestNear(corpus, quote, citedIndices) : null;
			const direct = near ?? runOn(corpus, quote, citedIndices);
			const compared = await closerTranslation(corpus, quote, direct.indices, direct.alignment);
			if (isSamePassage(compared.alignment, quote.length)) {
				indices = direct.indices;
				alignment = compared.alignment;
				verdict = quotationVerdict(alignment, quote, stated, compared.kjvModernSwaps);
				return finding(corpus, span, verdict, compared.comparedWith, stated, citedPassage, indices, alignment, true);
			}
		}
	}

	// Not the cited verses (or nothing cited): where in Scripture are these words?
	const near = bestNear(corpus, quote, searchCorpus(corpus, quote));
	const located = near && isSamePassage(near.alignment, quote.length, 0.6) && near.alignment.matched >= 4 ? near : null;
	if (located) {
		const compared = await closerTranslation(corpus, quote, located.indices, located.alignment);
		// A quotation that runs on past its cited verse (cited 4:6, quoting 4:6-7) is still that verse's.
		const citedIndices = new Set(indicesFor(corpus, usable));
		const runsOn = located.indices.some((index) => citedIndices.has(index));
		if (cited.length && !runsOn) {
			return finding(corpus, span, "wrong-reference", compared.comparedWith, stated, citedPassage, located.indices, compared.alignment, true);
		}
		if (runsOn) {
			verdict = quotationVerdict(compared.alignment, quote, stated, compared.kjvModernSwaps);
			return finding(corpus, span, verdict, compared.comparedWith, stated, citedPassage, located.indices, compared.alignment, true);
		}
		verdict = quotationVerdict(compared.alignment, quote, stated, compared.kjvModernSwaps);
		return finding(corpus, span, verdict, compared.comparedWith, stated, null, located.indices, compared.alignment, asScripture);
	}
	if (!cited.length && !asScripture) return null;
	// Cited or presented as Scripture, and not in the KJV. Show the cited verses for comparison.
	const shown = usable.length ? indicesFor(corpus, usable).slice(0, 6) : [];
	const empty: Alignment = alignWords(quote, passageWords(corpus, shown));
	return finding(corpus, span, "not-found", "KJV", stated, citedPassage, shown, empty, true);
}

function finding(
	corpus: Corpus,
	span: { start: number; end: number; text: string },
	verdict: Verdict,
	comparedWith: BundledTranslation,
	stated: string | null,
	cited: PassageSpan | null,
	indices: number[],
	alignment: Alignment,
	asScripture: boolean,
): QuotationFinding {
	const passage = spanOf(corpus, indices);
	findingId += 1;
	const quoteWords =
		verdict === "not-found" ? alignment.quote.map((word) => ({ text: word.text, mark: "added" as const })) : alignment.quote;
	return {
		id: `q${findingId}`,
		start: span.start,
		end: span.end,
		quote: span.text.replace(/[_*]+/g, "").trim().replace(/\s+/g, " "),
		verdict,
		comparedWith,
		statedTranslation: stated,
		cited,
		passage: verdict === "not-found" ? cited : passage,
		quoteWords,
		passageWords: verdict === "not-found" ? alignment.passage.map((word) => ({ ...word, mark: "outside" as const })) : alignment.passage,
		passageVerses: indices.map((index) => corpus.verses[index].verse),
		note: noteFor(verdict, comparedWith, cited, passage, stated),
		presentedAsScripture: asScripture,
	};
}

/** Remove citation text inside a blockquote ("> Philippians 4:6-7 (KJV)") from the words checked. */
function quotedWordsOf(text: string, span: { start: number; end: number; text: string; textStart: number; block: boolean }, refs: RawReference[]): string {
	if (!span.block) return span.text;
	let inner = text.slice(span.start, span.end);
	for (const ref of refs) {
		if (ref.start >= span.start && ref.end <= span.end) inner = inner.slice(0, ref.start - span.start) + " ".repeat(ref.end - ref.start) + inner.slice(ref.end - span.start);
	}
	return inner
		.replace(/^[ \t]*>[ \t]?/gm, "")
		.replace(new RegExp(`\\(\\s*(?:${TRANSLATION_TAGS})\\s*\\)`, "gi"), " ");
}

function groupOf(refs: RawReference[], group: number): RawReference[] {
	return refs.filter((ref) => ref.group === group);
}

/**
 * Check a teaching: every reference, and every marked quotation against the
 * verses it cites or, when it cites none or the wrong ones, the whole KJV.
 */
export async function checkTeaching(input: string): Promise<VerifyReport> {
	const text = input.replace(/\r\n?/g, "\n");
	const corpus = await loadCorpus();
	const raws = findRawReferences(text);
	const spans = findQuoteSpans(text);
	const usedAfter = new Set<number>();
	const quotations: QuotationFinding[] = [];
	const quotedGroups = new Set<number>();

	for (const span of spans) {
		let group: number | null = null;
		const inside = raws.find((ref) => ref.start >= span.start && ref.end <= span.end);
		if (inside) group = inside.group;
		if (group === null) {
			const after = raws.find((ref) => ref.start >= span.end && citesAfter(text.slice(span.end, ref.start)));
			if (after && !(span.block && /\n\s*\n/.test(text.slice(span.end, after.start)))) {
				group = after.group;
				usedAfter.add(after.group);
			}
		}
		if (group === null) {
			const before = [...raws].reverse().find((ref) => ref.end <= span.start);
			if (before && !usedAfter.has(before.group) && citesBefore(text.slice(before.end, span.start))) group = before.group;
		}
		const cited = group === null ? [] : groupOf(raws, group);
		const asScripture = presentedAsScripture(text.slice(Math.max(0, span.start - 160), span.start));
		const checked = await checkQuotation(corpus, { start: span.start, end: span.end, text: quotedWordsOf(text, span, raws) }, cited, asScripture);
		if (checked) {
			quotations.push(checked);
			if (group !== null) quotedGroups.add(group);
		}
	}

	const references = raws.map((raw) => {
		const reference = checkReference(corpus, raw);
		reference.quoted = quotedGroups.has(raw.group);
		return reference;
	});

	const counts: Record<Verdict, number> = { exact: 0, minor: 0, translation: 0, misquote: 0, "wrong-reference": 0, "not-found": 0 };
	for (const quotation of quotations) counts[quotation.verdict] += 1;
	return { textLength: text.length, quotations, references, counts };
}

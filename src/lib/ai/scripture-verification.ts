import { normalizeAssistantMarkdown } from "@/utils/assistantMarkdown";
import { analyzeMarkdownUnderscores, markdownRangeHasLiteralUnderscore, type MarkdownUnderscoreAnalysis } from "./markdown-underscore-guard";
import { BOOKS, LOCALIZED_BOOK_NAMES, type Book } from "@/lib/bible/books";
import { loadBsbChapter } from "@/lib/bible/bsb";
import { getChapter, isTranslationId, type TranslationId } from "@/lib/bible/translations";
import { getOriginalVerse, getOriginalVerseForKjv, type OriginalSourceReference, type OriginalWord } from "@/lib/bible/originals";

/** These are work bounds, never permission to approve only part of a draft. */
export const SCRIPTURE_VERIFICATION_LIMITS = { characters: 80_000, references: 80, verses: 500 } as const;

// Exact EMPTY_SLOTS contract enforced by scripts/bible/build-ebible.py. ASV's
// plain-text bundle has no per-verse omission metadata; no other blank is valid.
const ASV_OMITTED_SLOTS = new Set([
  "40:17:21", "40:18:11", "40:23:14", "41:7:16", "41:9:44", "41:9:46", "41:11:26", "41:15:28",
  "42:17:36", "42:23:17", "43:5:4", "44:8:37", "44:15:34", "44:24:7", "44:28:29", "45:16:24",
]);

export interface ScriptureVerseEvidence {
  book: string;
  order: number;
  chapter: number;
  verse: number;
  text: string;
}

export interface ScriptureReferenceEvidence {
  reference: string;
  sourceText: string;
  /** Offsets in the returned, placeholder-expanded text. */
  start: number;
  end: number;
  verses: ScriptureVerseEvidence[];
  canonicalText: string;
}

export interface ScriptureVerificationIssue {
  code: "invalid_reference" | "unknown_book" | "source_unavailable" | "verification_limit" | "malformed_placeholder" | "quote_mismatch" | "unattributed_quote" | "ambiguous_quote";
  severity: "error" | "review";
  message: string;
  excerpt: string;
  reference?: string;
}

export interface ScriptureQuoteCheck {
  /** Original presentation offsets in final expanded result.text, before cleanup. */
  start: number;
  end: number;
  /** Exactly associated CitationGroups; separate original identifiers are not inferred here. */
  citationSpans: Array<{ start: number; end: number }>;
  text: string;
  references: string[];
  status: "verified" | "failed" | "review";
}

export interface ScriptureOriginalEvidence {
  sourceIdentifier: string;
  edition: "WLC" | "TR";
  book: string;
  order: number;
  chapter: number;
  verse: number;
  text: string;
  words: string[];
  /** Inflected source surfaces and dictionary-backed lemmas stay distinct. */
  tokens?: OriginalWord[];
  kjvReferences: string[];
  wordStart?: number;
  wordEnd?: number;
}

export interface ScriptureDraftVerification {
  ok: boolean;
  text: string;
  translation: TranslationId;
  references: ScriptureReferenceEvidence[];
  originalEvidence: ScriptureOriginalEvidence[];
  quotes: ScriptureQuoteCheck[];
  issues: ScriptureVerificationIssue[];
}

interface CitationPart {
  book: Book;
  chapter: number;
  verse?: number;
  endChapter: number;
  endVerse?: number;
}

interface CitationGroup {
  start: number;
  end: number;
  sourceText: string;
  parts: CitationPart[];
  evidence: ScriptureReferenceEvidence[];
  edition?: "WLC" | "TR";
}

interface OriginalIdentifier {
  start: number;
  end: number;
  sourceText: string;
  edition: "WLC" | "TR";
  chapter: number;
  verse: number;
  book?: Book;
}

const normalizeCitationCharacters = (text: string) => text.replace(/[\uff10-\uff19]/g, (digit) => String(digit.charCodeAt(0) - 0xff10)).replace(/[\uff1a\ufe55]/g, ":").replace(/[\u2010\u2011]/g, "-");

function scanOriginalIdentifiers(text: string): OriginalIdentifier[] {
  return [...normalizeCitationCharacters(text).matchAll(new RegExp(`\\b(WLC|TR)\\s*(?:(${bookPattern})\\.?\\s*)?(\\d+)\\s*:\\s*(\\d+)`, "giu"))].map((match) => ({
    start: match.index, end: match.index + match[0].length, sourceText: text.slice(match.index, match.index + match[0].length), edition: match[1].toUpperCase() as "WLC" | "TR", chapter: Number(match[3]), verse: Number(match[4]), ...(match[2] ? { book: bookFromMatch(match[2]) } : {}),
  }));
}

const normalizeBook = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[.]/g, "").replace(/\s+/g, " ").trim();
const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const aliases = new Map<string, Book>();
for (const book of BOOKS) {
  aliases.set(normalizeBook(book.name), book);
  aliases.set(normalizeBook(book.abbr), book);
}
for (const [alias, name] of Object.entries({ psalm: "Psalms", "song of songs": "Song of Solomon", exod: "Exodus", eccles: "Ecclesiastes", ob: "Obadiah", mk: "Mark", lk: "Luke", jn: "John", "1 jn": "1 John", "2 jn": "2 John", "3 jn": "3 John", tit: "Titus", rev: "Revelation" })) {
  const book = BOOKS.find((candidate) => candidate.name === name);
  if (book) aliases.set(normalizeBook(alias), book);
}
for (const [name, order] of LOCALIZED_BOOK_NAMES) {
  const key = normalizeBook(name);
  const book = BOOKS.find((candidate) => candidate.order === order);
  if (book && !aliases.has(key)) aliases.set(key, book);
}
for (const [alias, book] of [...aliases]) {
  const volume = alias.match(/^([1-3]) (.+)$/);
  if (volume) aliases.set(`${["", "i", "ii", "iii"][Number(volume[1])]} ${volume[2]}`, book);
}

function aliasPattern(alias: string): string {
  // Accent-folding is only for names; the quote matcher never drops words.
  const accentClasses: Record<string, string> = { a: "[aà-å]", e: "[eè-ë]", i: "[iì-ï]", o: "[oò-ö]", u: "[uù-ü]", n: "[nñ]" };
  return alias.split(" ").map((word, index) => {
    const body = [...word].map((character) => accentClasses[character] ?? escapePattern(character)).join("");
    return index === 0 && /^[1-5]$/.test(word) ? `${body}\\.?` : body;
  }).join("\\s*");
}

const bookPattern = [...aliases.keys()].sort((a, b) => b.length - a.length).map(aliasPattern).join("|");
const citationStart = () => new RegExp(`(?<![\\p{L}\\p{N}])(${bookPattern})\\.?\\s*(\\d+)`, "giu");
const numberTail = /^(\d+)(?:\s*:\s*(\d+))?(?:\s*[-\u2013\u2014\u2212]\s*(\d+)(?:\s*:\s*(\d+))?)?/;

function bookFromMatch(name: string): Book | undefined {
  const normalized = normalizeBook(name);
  return aliases.get(normalized) ?? [...aliases].find(([alias]) => alias.replace(/\s/g, "") === normalized.replace(/\s/g, ""))?.[1];
}

function formatPart(part: CitationPart): string {
  const start = `${part.book.name} ${part.chapter}${part.verse === undefined ? "" : `:${part.verse}`}`;
  if (part.endChapter === part.chapter && part.endVerse === part.verse) return start;
  if (part.verse === undefined) return `${start}-${part.endChapter}`;
  return `${start}-${part.endChapter === part.chapter ? "" : `${part.endChapter}:`}${part.endVerse}`;
}

function scanCitations(text: string, issues: ScriptureVerificationIssue[], originalIdentifiers: OriginalIdentifier[] = [], canonicalBodies: Array<{ start: number; end: number }> = []): CitationGroup[] {
  const groups: CitationGroup[] = [];
  // These substitutions preserve character offsets into the displayed draft.
  const scanText = normalizeCitationCharacters(text);
  const pattern = citationStart();
  for (const match of scanText.matchAll(pattern)) {
    const start = match.index;
    if (groups.some((group) => start < group.end)) continue;
    // These spans exist only for exact source text inserted by this verifier.
    // A source's own prose, such as "division numbers 74,600", is not a new
    // assistant citation. Input text never receives this exemption.
    if (canonicalBodies.some((body) => start >= body.start && start < body.end)) continue;
    if (originalIdentifiers.some((identifier) => start >= identifier.start && start < identifier.end)) continue;
    const book = bookFromMatch(match[1]);
    if (!book) continue;
    const precedingVolume = scanText.slice(Math.max(0, start - 12), start).match(/(?:^|[^\p{L}\p{N}])([0-9IVX]+)(?:\.\s*|\s+)$/iu);
    const precedingNumberStart = precedingVolume ? start - precedingVolume[0].length + precedingVolume[0].lastIndexOf(precedingVolume[1]) : -1;
    // A preceding citation's coordinate is not a volume on the next book.
    // Only an already parsed citation span supplies this distinction.
    const priorCitationNumber = groups.some((group) => precedingNumberStart >= group.start && precedingNumberStart < group.end);
    if (precedingVolume && !priorCitationNumber) {
      issues.push({ code: "invalid_reference", severity: "error", message: "The book has an unsupported or mismatched volume number.", excerpt: text.slice(Math.max(0, start - 3), start + match[0].length) });
    }
    const numberStart = start + match[0].length - match[2].length;
    let cursor = numberStart;
    let chapter = Number(match[2]);
    let verseContext = false;
    let separator = "";
    const parts: CitationPart[] = [];
    while (true) {
      const tail = scanText.slice(cursor).match(numberTail);
      if (!tail) break;
      const first = Number(tail[1]);
      const hasColon = tail[2] !== undefined;
      const inheritedVerse: boolean = separator === "," && verseContext && !hasColon;
      if (separator === ";" && verseContext && !hasColon) {
        issues.push({ code: "invalid_reference", severity: "error", message: "An inherited semicolon reference must state its chapter and verse explicitly.", excerpt: text.slice(start, cursor + tail[0].length) });
      }
      if (!inheritedVerse) chapter = first;
      const verse: number | undefined = hasColon ? Number(tail[2]) : inheritedVerse ? first : undefined;
      let endChapter = chapter;
      let endVerse = verse;
      if (tail[3] !== undefined) {
        if (tail[4] !== undefined) {
          endChapter = Number(tail[3]);
          endVerse = Number(tail[4]);
        } else if (verse !== undefined) endVerse = Number(tail[3]);
        else endChapter = Number(tail[3]);
      }
      parts.push({ book, chapter, verse, endChapter, endVerse });
      verseContext = verse !== undefined;
      cursor += tail[0].length;
      const next = scanText.slice(cursor).match(/^(?:\s*([,;])\s*(?:(?:and|y|und)\s+)?|\s+(?:and|y|und)\s+)(?=\d)/i);
      if (!next) break;
      const afterSeparator = scanText.slice(cursor + next[0].length);
      const nextBook = citationStart().exec(afterSeparator);
      // An unsupported volume must stay outside this group so it cannot
      // masquerade as an inherited verse and bypass the next book's guard.
      if (nextBook?.index === 0 || (nextBook && /^\d+(?:\.\s*|\s+)$/.test(afterSeparator.slice(0, nextBook.index)))) break;
      separator = next[1] ?? ",";
      cursor += next[0].length;
    }
    const remaining = scanText.slice(cursor);
    // Connections cards use `REFERENCE :: prose`; verse headings also use a
    // single colon. The coordinate must already include a verse, and a real
    // nonnumeric prose body must follow. A doubled internal colon or another
    // numeric coordinate remains malformed rather than being reclassified.
    const proseDelimiter = verseContext && /^\s*:{1,2}(?!:)\s+(?:[*_`]*)(?=[\p{L}"\u201c\u2018«»„‚])/u.test(remaining);
    // A dash left after parsing the coordinate is prose only when an actual
    // nonnumeric word follows on that line, allowing ordinary Markdown/quotes.
    const danglingRange = /^\s*[-\u2013\u2014\u2212]/.test(remaining) && !/^\s*[-\u2013\u2014\u2212][ \t]*[*_`("'\u201c\u2018«»„‚\[]*(?=\p{L})/u.test(remaining);
    if ((!proseDelimiter && /^\s*:/.test(remaining)) || danglingRange || /^\p{L}/u.test(remaining)) {
      issues.push({ code: "invalid_reference", severity: "error", message: "The Scripture reference has an incomplete or unsupported range.", excerpt: text.slice(start, cursor + 24) });
    }
    const editionLabel = text.slice(cursor).match(/^\s*\((WLC|TR)(?:\s+numbering)?\)/i);
    groups.push({ start, end: cursor, sourceText: text.slice(start, cursor), parts, evidence: [], ...(editionLabel ? { edition: editionLabel[1].toUpperCase() as "WLC" | "TR" } : {}) });
  }
  // Coordinates behind an unknown book must not disappear simply because the
  // known-book expression did not match them. Ordinary clock times are skipped.
  const unknown = /((?:[1-5IVX]\.?(?:\s+|(?=\p{L})))?[\p{L}][\p{L}.'-]*)\s*(\d+)\s*:\s*(\d+)/gu;
  for (const match of scanText.matchAll(unknown)) {
    const coordinate = match.index + match[0].lastIndexOf(match[2]);
    if (canonicalBodies.some((body) => coordinate >= body.start && coordinate < body.end)) continue;
    if (groups.some((group) => coordinate >= group.start && coordinate < group.end)) continue;
    // These exact spans are checked against the original text below. No WLC/TR
    // spelling is globally exempt from coordinate and source validation.
    if (originalIdentifiers.some((identifier) => coordinate >= identifier.start && coordinate < identifier.end)) continue;
    if (/^(?:at|is|was|by|from|to|time|around|about|version|ratio|chapter|verse|verses)$/i.test(match[1])) continue;
    issues.push({ code: "unknown_book", severity: "error", message: "A chapter:verse citation names a book outside the canonical Bible.", excerpt: match[0] });
  }
  return groups;
}

function normalizedQuote(value: string): string {
  return value.normalize("NFKC").replace(/[\u0591-\u05af]/g, "").replace(/<[^>]*>/g, " ").replace(/[\p{P}\p{S}]/gu, (character) => character === "_" ? character : " ").replace(/\s+/g, " ").trim();
}

function quoteMatches(quote: string, verses: ScriptureVerseEvidence[], requireComplete = false): boolean {
  const normalized = normalizedQuote(quote);
  if (!normalized || !verses.length) return false;
  const canonical = normalizedQuote(verses.map((verse) => verse.text).join(" "));
  // A passage label promises every verse in the range. An isolated authentic
  // phrase cannot prove a whole range; repair it to an exact single reference.
  if (requireComplete || verses.length > 1) return normalized === canonical;
  const segments = quote.split(/(?:\.{3,}|\u2026)/).map(normalizedQuote).filter(Boolean);
  let cursor = 0;
  for (const segment of segments) {
    const index = (` ${canonical} `).indexOf(` ${segment} `, cursor);
    if (index < 0) return false;
    cursor = index + segment.length + 1;
  }
  return segments.length > 0;
}

function originalMentionIntent(before: string): "lemma" | "surface" | null {
  const cues = [...before.matchAll(/\b(?:lemma|dictionary (?:form|headword)|surface(?: form)?|inflected(?: surface)?(?: form)?)\b/gi)];
  const last = cues[cues.length - 1]?.[0];
  if (last) return /lemma|dictionary/i.test(last) ? "lemma" : "surface";
  return /\b(?:hebrew|greek|original)\s+(?:word|term|text)\b/i.test(before) ? "surface" : null;
}

function tokenMentionMatches(body: string, evidence: ScriptureOriginalEvidence, intent: "lemma" | "surface"): boolean {
  const value = normalizedQuote(body);
  return evidence.tokens?.some((token) => normalizedQuote(intent === "lemma" ? token.lemma ?? "" : token.text) === value) ?? false;
}

function hasCompletenessClaim(context: string): boolean {
  // Glosses describe a word, not a promise to reproduce its whole source.
  // Paired localized quote openings need the same treatment as ASCII quotes.
  const withoutGlosses = context.replace(/"([^"\n]+)"|\u201c([^\u201d]+)\u201d|\u2018([^\u2019\n]+)\u2019|«([^»]+)»|»([^«]+)«|„([^“]+)“|‚([^‘]+)‘/g,
    (quote, _ascii, _curly, _single, _guillemet, _reversed, _lowDouble, _lowSingle, offset: number) =>
      isLexicalGloss(context.slice(Math.max(0, offset - 150), offset)) ? " ".repeat(quote.length) : quote);
  const claims = withoutGlosses
    .replace(/\b(?:means?|signifies?|denotes?|glossed\s+as|translated\s+as)\s+(?:to\s+be\s+)?["\u201c\u2018«»„‚]?\s*(?:complete|full|whole|entire|verbatim)\b/gi, "")
    .replace(/\b(?:a\s+)?(?:complete|whole|full)\s+word\b(?![\s\p{Pd}]+for\b)/giu, "");
  if (/\bverbatim\b|\bin\s+(?:its\s+)?(?:full|entirety)\b|\bword[\s\p{Pd}]+for[\s\p{Pd}]+word\b/iu.test(claims)) return true;
  if (claims.split(/[.!?;\n]/).some((clause) => /\b(?:full(?:y)?|whole|entire(?:ly)?|complete(?:ly)?)\b/i.test(clause) && (/\b(?:verses?|range|passage|chapter|quotation|text|scripture|words)\b/i.test(clause) || citationStart().test(clause) || /\b(?:WLC|TR)\s*\d+\s*:\s*\d+/i.test(clause)))) return true;
  // These bounded phrases distinguish a full-text promise from a lexical
  // definition, an explicit disclaimer, or an ordinary intensifier. Mask only
  // the matching phrase: a later positive full-text promise must still count.
  const localizedClaims = claims.normalize("NFC")
    .replace(/(?<![\p{L}\p{N}])(?:significa(?:n)?|quiere\s+decir|se\s+traduce\s+(?:como|por))\s+(?:ser\s+)?["\u201c\u2018«»„‚]?\s*(?:complet(?:[oa]s?|amente)|enter[oa]s?|íntegr(?:[oa]s?|amente)|en\s+su\s+(?:totalidad|integridad)|palabra[\s\p{Pd}]+por[\s\p{Pd}]+palabra|de\s+principio\s+a\s+fin)(?![\p{L}\p{N}])/giu, "")
    .replace(/(?<![\p{L}\p{N}])(?:una?\s+)?palabra\s+(?:completa|entera|íntegra)(?![\p{L}\p{N}])/giu, "")
    .replace(/(?<![\p{L}\p{N}])(?:bedeutet|bedeuten|heißt|heisst|bezeichnet|übersetzt\s+(?:als|mit))\s+["\u201c\u2018«»„‚]?\s*(?:vollständig|vollstaendig|komplett|ganz|wörtlich|Wort[\s\p{Pd}]+für[\s\p{Pd}]+Wort|in\s+voller\s+Länge|im\s+Wortlaut)(?![\p{L}\p{N}])/giu, "")
    .replace(/(?<![\p{L}\p{N}])(?:ein(?:e[nmrs]?)?\s+)?(?:vollständig|vollstaendig|komplett|ganz)e[nmrs]?\s+Wort(?![\p{L}\p{N}])/giu, "")
    .replace(/(?<![\p{L}\p{N}])no\s+(?:(?:est[aá]n?|es|son|se\s+(?:cita|reproduce))\s+)?(?:del\s+todo\s+)?(?:complet(?:[oa]s?|amente)|enter[oa]s?|íntegr(?:[oa]s?|amente)|en\s+su\s+(?:totalidad|integridad)|palabra[\s\p{Pd}]+por[\s\p{Pd}]+palabra|de\s+principio\s+a\s+fin)(?![\p{L}\p{N}])/giu, "")
    .replace(/(?<![\p{L}\p{N}])nicht\s+(?:ganz\s+)?(?:vollständig(?:e[nmrs]?)?|vollstaendig(?:e[nmrs]?)?|komplett(?:e[nmrs]?)?|wörtlich(?:e[nmrs]?)?|Wort[\s\p{Pd}]+für[\s\p{Pd}]+Wort|in\s+voller\s+Länge|im\s+Wortlaut)(?![\p{L}\p{N}])/giu, "")
    .replace(/(?<![\p{L}\p{N}])(?:ganz|vollständig|vollstaendig|komplett)\s+(?:klar|deutlich|sicher|offensichtlich|anders|falsch|richtig)(?![\p{L}\p{N}])/giu, "");
  if (/(?<![\p{L}\p{N}])(?:en\s+su\s+(?:totalidad|integridad)|palabra[\s\p{Pd}]+por[\s\p{Pd}]+palabra|wörtlich(?:e[nmrs]?)?|Wort[\s\p{Pd}]+für[\s\p{Pd}]+Wort|in\s+voller\s+Länge|im\s+Wortlaut)(?![\p{L}\p{N}])/iu.test(localizedClaims)) return true;
  return localizedClaims.split(/[.!?;\n]/).some((clause) => {
    const hasUnit = /\b(?:vers[ií]culos?|pasajes?|cap[ií]tulos?|citas?|textos?|escrituras?|palabras?|Verse?[ns]?|Kapitel|Abschnitt|Passage|Zitat|Text|Schrift|Wortlaut|Worte?|Wörter)\b/iu.test(clause) || citationStart().test(clause) || /\b(?:WLC|TR)\s*\d+\s*:\s*\d+/i.test(clause);
    const indicator = /(?<![\p{L}\p{N}])(?:complet(?:[oa]s?|amente)|enter[oa]s?|íntegr(?:[oa]s?|amente)|vollständig(?:e[nmrs]?)?|ganze[nmrs]?)(?![\p{L}\p{N}])/iu.test(clause);
    // Additional synonyms require an adjacent text unit or quotation verb;
    // "komplett anders" and a temporal "de principio a fin" are not promises.
    const directGerman = /(?<![\p{L}\p{N}])(?:vollstaendig|komplett)(?:e[nmrs]?)?\s+(?:Verse?[ns]?|Kapitel|Abschnitt|Passage|Zitat|Text|Wortlaut|lautet|zitiert|wiedergegeben)(?![\p{L}\p{N}])/iu.test(clause);
    const directSpanish = /(?<![\p{L}\p{N}])de\s+principio\s+a\s+fin(?![\p{L}\p{N}])/iu.test(clause) && /\b(?:dice[n]?|cita(?:do|dos)?|reproduce|vers[ií]culos?|pasajes?|textos?)\b/iu.test(clause);
    return hasUnit && (indicator || directGerman || directSpanish);
  });
}

function isLexicalGloss(before: string): boolean {
  // Only an explicit word/term definition immediately introducing this quote
  // gets semantic review. Nearby Latin-script quotations keep source checking.
  const clause = before.split(/[.!?;\n]/).pop() ?? "";
  return (/\b(?:word|term|lemma|surface form)\b/i.test(clause) && /\b(?:means?|signifies?|denotes?|glossed\s+as|translated\s+as)\s*$/i.test(clause)) ||
    (/(?<![\p{L}\p{N}])(?:palabra|término|termino|lema|forma)(?![\p{L}\p{N}])/iu.test(clause) && /(?<![\p{L}\p{N}])(?:significa(?:n)?|quiere\s+decir|se\s+traduce\s+(?:como|por))\s*$/iu.test(clause)) ||
    (/\b(?:Wort|Begriff|Lemma|Wortform)\b/iu.test(clause) && /\b(?:bedeutet|bedeuten|heißt|heisst|bezeichnet|übersetzt\s+(?:als|mit))\s*$/iu.test(clause));
}

interface Quotation { text: string; start: number; end: number; block: boolean; numbered?: boolean }

function quotationCandidates(text: string, groups: CitationGroup[]): Quotation[] {
  const candidates: Quotation[] = [];
  for (const match of text.matchAll(/<(blockquote|q)\b[^>]*>[\s\S]*?<\/\1\s*>/gi)) {
    candidates.push({ text: match[0], start: match.index, end: match.index + match[0].length, block: true });
  }
  const blocks = /(?:^|\n)([ \t]*>[^\n]*(?:\n[ \t]*>[^\n]*)*)/g;
  for (const match of text.matchAll(blocks)) {
    const start = match.index + (match[0].startsWith("\n") ? 1 : 0);
    if (candidates.some((candidate) => start >= candidate.start && start < candidate.end)) continue;
    candidates.push({ text: match[1], start, end: start + match[1].length, block: true });
  }
  const inline = /"([^"\n]+)"|\u201c([^\u201d]+)\u201d|\u2018([^\u2019\n]+)\u2019|«([^»]+)»|»([^«]+)«|„([^“]+)“|‚([^‘]+)‘/g;
  for (const match of text.matchAll(inline)) {
    if (candidates.some((candidate) => match.index >= candidate.start && match.index < candidate.end)) continue;
    candidates.push({ text: match.slice(1).find((part) => part !== undefined)!, start: match.index, end: match.index + match[0].length, block: false });
  }
  // Original-language words are quotations even when rendered as inline code.
  for (const match of text.matchAll(/[\p{Script=Hebrew}\p{Script=Greek}][\p{Script=Hebrew}\p{Script=Greek}\p{M}\u05be\u05c3 ]*/gu)) {
    if (candidates.some((candidate) => match.index >= candidate.start && match.index < candidate.end)) continue;
    candidates.push({ text: match[0], start: match.index, end: match.index + match[0].length, block: false });
  }
  // Verse numbers are Scripture presentation even without quotation marks.
  // A Markdown list's `1.` is only a verse marker inside a blockquote.
  const numbered = /(?:^|\n)([ \t]*(?:\*\*)?\[?(\d{1,3})\]?(?:\*\*)?[ \t]+[^\n]+)/g;
  for (const match of text.matchAll(numbered)) {
    const start = match.index + (match[0].startsWith("\n") ? 1 : 0);
    if (candidates.some((candidate) => start >= candidate.start && start < candidate.end)) continue;
    if (groups.some((group) => group.start >= start && group.start < start + match[1].length && /^[\s*_`]*$/.test(text.slice(start, group.start)))) continue;
    const previous = candidates.find((candidate) => candidate.numbered && candidate.end + 1 === start);
    if (previous || groups.some((group) => group.start < start && start - group.end < 180 && !text.slice(group.end, start).includes("\n\n"))) {
      if (previous) { previous.text += `\n${match[1]}`; previous.end = start + match[1].length; }
      else candidates.push({ text: match[1], start, end: start + match[1].length, block: true, numbered: true });
    }
  }
  // A reference on its own line also labels an immediately following verse
  // body. Omitting quotation marks must not exempt that body from checking.
  for (const group of groups) {
    const lineStart = text.lastIndexOf("\n", group.start - 1) + 1;
    const nextLine = text.indexOf("\n", group.end);
    if (nextLine < 0) continue;
    const label = `${text.slice(lineStart, group.start)}${text.slice(group.end, nextLine)}`.replace(/\((?:KJV|NKJV|BSB|ASV|RV1909|LUT1912)\)/gi, "");
    if (/[^\s*#_`()[\]:\u2013\u2014-]/.test(label)) continue;
    const start = nextLine + 1;
    if (!text.slice(start).trim() || /^[ \t]*(?:\n|>|#)/.test(text.slice(start))) continue;
    if (candidates.some((candidate) => start >= candidate.start && start < candidate.end)) continue;
    const paragraph = text.slice(start).match(/^[^\n]+(?:\n(?!\s*\n)[^\n]+)*/)?.[0];
    if (paragraph) candidates.push({ text: paragraph, start, end: start + paragraph.length, block: true });
  }
  return candidates.sort((a, b) => a.start - b.start);
}

// The renderer separates a standalone citation label from its blockquote by
// one empty line. This exact structure owns its quote; ordinary prose gaps do not.
function immediateMarkdownBlockLabel(group: CitationGroup, quote: Quotation, text: string, translation: TranslationId): boolean {
  // Potential raw HTML/comment context is outside this narrow Markdown rule.
  if (text.slice(0, quote.start).includes("<")) return false;
  if (!quote.block || !/^[ \t]{0,3}>/.test(quote.text) || group.end > quote.start) return false;
  const lineStart = text.lastIndexOf("\n", group.start - 1) + 1;
  if (!/^[ ]{0,3}(?:#{1,6}[ \t]+)?[*_]*[ \t]*$/.test(text.slice(lineStart, group.start))) return false;
  const gap = text.slice(group.end, quote.start);
  if (!/^[ \t*_]*(?:(?:\((?:KJV|NKJV|BSB|ASV|RV1909|LUT1912)\)|(?:KJV|NKJV|BSB|ASV|RV1909|LUT1912)))?[ \t*_]*:?[ \t]*\r?\n[ \t]*\r?\n$/i.test(gap)) return false;
  const labelledTranslation = /\b(KJV|NKJV|BSB|ASV|RV1909|LUT1912)\b/i.exec(gap)?.[1];
  if (labelledTranslation && labelledTranslation.toUpperCase() !== translation) return false;
  // Do not turn a code example's apparent label into an external citation.
  let fence: { marker: string; length: number } | null = null;
  for (const line of text.slice(0, quote.start).split("\n")) {
    const marker = /^[ ]{0,3}(\x60{3,}|~{3,})(.*)$/.exec(line);
    if (!marker) continue;
    if (!fence) fence = { marker: marker[1][0], length: marker[1].length };
    else if (marker[1][0] === fence.marker && marker[1].length >= fence.length && /^[ \t\r]*$/.test(marker[2])) fence = null;
  }
  return fence === null;
}

function associatedGroups(quote: Quotation, text: string, groups: CitationGroup[], translation: TranslationId): CitationGroup[] {
  const inside = groups.filter((group) => group.start >= quote.start && group.end <= quote.end);
  if (inside.length) return inside;
  const nearby = groups.filter((group) => {
    const gap = group.end <= quote.start ? text.slice(group.end, quote.start) : group.start >= quote.end ? text.slice(quote.end, group.start) : "";
    return gap.length <= 220 && (!/\n\s*\n/.test(gap) || immediateMarkdownBlockLabel(group, quote, text, translation)) && (group.end <= quote.start || group.start >= quote.end);
  });
  // A clear immediate introduction owns its following quote. A shorter
  // forward gap must not lend the next sentence's verse to this quotation.
  const formatting = "[\\s*_`]*";
  const version = `(?:(?:\\((?:KJV|NKJV|BSB|ASV|RV1909|LUT1912|WLC|TR)\\)|(?:KJV|NKJV|BSB|ASV|RV1909|LUT1912|WLC|TR))${formatting})?`;
  const introduction = new RegExp(`^${formatting}${version}(?:::{0,1}|(?:says|reads|saith|dice|lautet|sagt)${formatting}${version}[,:]?)${formatting}$`, "i");
  const header = new RegExp(`^${formatting}${version}$`, "i");
  const introduced = nearby.filter((group) => {
    if (group.end > quote.start) return false;
    const gap = text.slice(group.end, quote.start);
    if (introduction.test(gap)) return true;
    const lineStart = text.lastIndexOf("\n", group.start - 1) + 1;
    return gap.includes("\n") && header.test(gap) && /^[\s*#_`]*$/.test(text.slice(lineStart, group.start));
  });
  if (introduced.length) return introduced.sort((a, b) => b.end - a.end).slice(0, 1);
  // Never allow a quote to borrow a convenient citation across an intervening
  // reference. Equidistant competing labels require semantic repair.
  nearby.sort((a, b) => Math.min(Math.abs(a.end - quote.start), Math.abs(a.start - quote.end)) - Math.min(Math.abs(b.end - quote.start), Math.abs(b.start - quote.end)));
  return nearby.slice(0, 1);
}

function quoteBody(quote: Quotation, groups: CitationGroup[], identifiers: OriginalIdentifier[] = [], underscoreAnalysis?: MarkdownUnderscoreAnalysis): string {
  // Source ranges from the whole expanded draft retain enclosing code/HTML
  // context that quotation extraction alone cannot preserve.
  const literalUnderscore = quote.text.includes("_") && (!underscoreAnalysis || markdownRangeHasLiteralUnderscore(underscoreAnalysis, quote.start, quote.end));
  let body = quote.text;
  for (const group of groups) body = body.split(group.sourceText).join("");
  for (const identifier of identifiers) body = body.split(identifier.sourceText).join("");
  body = body.replace(/\((?:WLC|TR)(?:\s+numbering)?\)/gi, "");
  return body.split("\n").map((line) => line.replace(/^\s*>\s?/, "").replace(/^\s*(?:\*\*)?\[?\d{1,3}\]?[.)]?(?:\*\*)?\s+/, "").replace(/^\s*[-\u2013\u2014]?\s*[*_`]*\s*[,;]?\s*\(?(?:KJV|NKJV|BSB|ASV|RV1909|LUT1912)\)?\s*[*_`]*\s*$/i, "")).join(" ").replace(/\((?:KJV|NKJV|BSB|ASV|RV1909|LUT1912)\)/gi, "").replace(literalUnderscore ? /[*`]/g : /[*_`]/g, "").replace(/^\s*["\u201c]|["\u201d]\s*$/g, "").replace(/\s+/g, " ").trim().replace(/^[\s\u2014-]+|[\s\u2014-]+$/g, "");
}

/** Only redundant labels owned by a real standalone marker may be consumed. */
function adjacentMarkerHeadingStart(input: string, markerStart: number, markerEnd: number, group: CitationGroup, translation: TranslationId, minimumStart: number): number {
  const markerLine = input.lastIndexOf("\n", markerStart - 1) + 1;
  if (!/^[ ]{0,3}$/.test(input.slice(markerLine, markerStart)) || !/^[ \t]*(?:\r?\n|$)/.test(input.slice(markerEnd))) return markerStart;
  let start = markerStart;
  let before = markerLine;
  const expected = group.parts.map(formatPart).join(";");
  while (before > minimumStart) {
    const prefix = input.slice(minimumStart, before).replace(/[ \t\r\n]+$/, "");
    if (!prefix) break;
    const lineOffset = prefix.lastIndexOf("\n") + 1;
    const line = prefix.slice(lineOffset);
    const heading = /^[ ]{0,3}(?:#{1,6}[ \t]+)?(.+)$/.exec(line);
    if (!heading) break;
    let label = heading[1];
    if (/^[ ]{0,3}#/.test(line)) label = label.replace(/[ \t]+#+$/, "");
    for (const wrapper of ["**", "__"]) if (label.startsWith(wrapper) && label.endsWith(wrapper)) label = label.slice(wrapper.length, -wrapper.length);
    const edition = /[ \t]+\((KJV|NKJV|BSB|ASV|RV1909|LUT1912)\)$/i.exec(label);
    if (!edition || edition[1].toUpperCase() !== translation) break;
    const reference = label.slice(0, edition.index);
    const headingIssues: ScriptureVerificationIssue[] = [];
    const headings = scanCitations(reference, headingIssues);
    if (headingIssues.length || headings.length !== 1 || headings[0].start !== 0 || headings[0].end !== reference.length || headings[0].parts.map(formatPart).join(";") !== expected) break;
    start = minimumStart + lineOffset;
    before = start;
  }
  if (start === markerStart) return markerStart;
  // Literal examples/quotations and raw HTML must keep their original labels.
  // CommonMark permits unprefixed lazy continuation within a quoted paragraph.
  const precedingLines = input.slice(0, start).split(/\r?\n/);
  precedingLines.pop();
  for (let index = precedingLines.length - 1; index >= 0 && !/^[ \t]*$/.test(precedingLines[index]); index--) {
    if (/^[ ]{0,3}>/.test(precedingLines[index])) return markerStart;
  }
  if (input.slice(0, markerStart).includes("<")) return markerStart;
  let fence: { marker: string; length: number } | null = null;
  for (const line of input.slice(0, markerLine).split("\n")) {
    const match = /^[ ]{0,3}(\x60{3,}|~{3,})(.*)$/.exec(line);
    if (!match) continue;
    if (!fence) fence = { marker: match[1][0], length: match[1].length };
    else if (match[1][0] === fence.marker && match[1].length >= fence.length && /^[ \t\r]*$/.test(match[2])) fence = null;
  }
  if (fence) return markerStart;
  const literals = /"[^"]*(?:"|$)|(?<![\p{L}\p{N}])'[^']*(?:'|$)|“[^”]*(?:”|$)|‘[^’]*(?:’|$)|«[^»]*(?:»|$)|„[^“]*(?:“|$)|(`+)[\s\S]*?(?:\1|$)/gu;
  for (const literal of input.matchAll(literals)) if (literal.index <= start && literal.index + literal[0].length > markerStart) return markerStart;
  return start;
}

/**
 * Checks textual citation/quotation fidelity against the translation loader.
 * This does not prove a theological claim, speaker, or interpretation. Callers
 * must independently review those claims before releasing the buffered draft.
 * No tool output or model-generated verse text is accepted as source evidence.
 */
export async function verifyScriptureDraft(
  inputText: string,
  options: { translation: TranslationId; maxReferences?: number; maxVerses?: number },
): Promise<ScriptureDraftVerification> {
  const issues: ScriptureVerificationIssue[] = [];
  const references: ScriptureReferenceEvidence[] = [];
  const originalEvidence: ScriptureOriginalEvidence[] = [];
  const quotes: ScriptureQuoteCheck[] = [];
  const result = (text: string): ScriptureDraftVerification => ({ ok: !issues.some((issue) => issue.severity === "error"), text, translation: options.translation, references, originalEvidence, quotes, issues });
  const failLimit = (message: string) => issues.push({ code: "verification_limit", severity: "error", message, excerpt: "" });
  if (/\p{Cf}/u.test(inputText)) {
    issues.push({ code: "invalid_reference", severity: "error", message: "Invisible formatting controls can disguise Scripture wording or citations; repair the draft to ordinary text before verification.", excerpt: "Invisible formatting control" });
    return result(inputText);
  }
  if (inputText.length > SCRIPTURE_VERIFICATION_LIMITS.characters) { failLimit("The draft exceeds the complete-verification character bound."); return result(inputText); }
  if (!isTranslationId(options.translation)) {
    issues.push({ code: "source_unavailable", severity: "error", message: "The requested Bible translation is unsupported.", excerpt: "" });
    return result(inputText);
  }
  const maxReferences = Math.min(options.maxReferences ?? SCRIPTURE_VERIFICATION_LIMITS.references, SCRIPTURE_VERIFICATION_LIMITS.references);
  const maxVerses = Math.min(options.maxVerses ?? SCRIPTURE_VERIFICATION_LIMITS.verses, SCRIPTURE_VERIFICATION_LIMITS.verses);
  if (!Number.isInteger(maxReferences) || maxReferences < 1 || !Number.isInteger(maxVerses) || maxVerses < 1) {
    failLimit("Verification bounds must be positive, finite integers.");
    return result(inputText);
  }
  const chapterCache = new Map<string, Promise<string[]>>();
  const load = (order: number, chapter: number) => {
    const key = `${order}:${chapter}`;
    let pending = chapterCache.get(key);
    if (!pending) {
      pending = (async () => {
        const canonical = await getChapter(options.translation, order, chapter);
        if (!canonical.length || Array.from(canonical).some((verse) => typeof verse !== "string")) throw new Error("Incomplete canonical chapter");
        if (canonical.some((verse) => !verse.trim())) {
          if (options.translation === "ASV") {
            if (canonical.some((verse, index) => !verse.trim() && !ASV_OMITTED_SLOTS.has(`${order}:${chapter}:${index + 1}`))) throw new Error("Incomplete canonical chapter");
            return canonical;
          }
          // BSB preserves its publisher's omitted verse slots. Only explicit,
          // matching source metadata can exempt a blank outside the citation.
          if (options.translation !== "BSB") throw new Error("Incomplete canonical chapter");
          const formatted = await loadBsbChapter(order, chapter);
          if (formatted.length !== canonical.length || Array.from(formatted).some((verse, index) => !verse || verse.number !== index + 1 || verse.text !== canonical[index] || (!verse.text.trim() && verse.omitted !== true))) throw new Error("Incomplete canonical chapter");
        }
        return canonical;
      })();
      chapterCache.set(key, pending);
    }
    return pending;
  };
  let verseCount = 0;
  let referenceCount = 0;
  const originalCache = new Map<string, ReturnType<typeof getOriginalVerse>>();
  const mappingCache = new Map<string, ReturnType<typeof getOriginalVerseForKjv>>();
  const mappedOriginal = (verse: ScriptureVerseEvidence) => {
    const key = `${verse.order}:${verse.chapter}:${verse.verse}`;
    let pending = mappingCache.get(key);
    if (!pending) { pending = getOriginalVerseForKjv(verse.order, verse.chapter, verse.verse); mappingCache.set(key, pending); }
    return pending;
  };
  const addOriginal = async (edition: "WLC" | "TR", book: Book, chapter: number, verse: number, kjvReferences: string[], fragment?: OriginalSourceReference): Promise<ScriptureOriginalEvidence | null> => {
    if ((edition === "WLC") !== (book.order <= 39)) throw new Error("Original edition does not contain that testament");
    const key = `${book.order}:${chapter}:${verse}`;
    const existing = originalEvidence.find((evidence) => evidence.order === book.order && evidence.chapter === chapter && evidence.verse === verse && evidence.wordStart === fragment?.wordStart && evidence.wordEnd === fragment?.wordEnd);
    if (existing) { existing.kjvReferences = [...new Set([...existing.kjvReferences, ...kjvReferences])]; return existing; }
    if (++verseCount > maxVerses) { failLimit("Original-language evidence exceeds the complete-verification verse bound."); return null; }
    let pending = originalCache.get(key);
    if (!pending) { pending = getOriginalVerse(book.order, chapter, verse); originalCache.set(key, pending); }
    const original = await pending;
    if (!original?.words.length) return null;
    const tokens = original.words.slice(fragment?.wordStart ?? 0, fragment?.wordEnd ?? original.words.length).map((word) => ({ ...word }));
    const words = tokens.map((word) => word.text);
    if (!words.length) return null;
    const evidence: ScriptureOriginalEvidence = { sourceIdentifier: `${edition} ${chapter}:${verse}`, edition, book: book.name, order: book.order, chapter, verse, text: words.join(" "), words, tokens, kjvReferences, ...(fragment?.wordStart === undefined ? {} : { wordStart: fragment.wordStart }), ...(fragment?.wordEnd === undefined ? {} : { wordEnd: fragment.wordEnd }) };
    originalEvidence.push(evidence);
    return evidence;
  };
  const resolveGroup = async (group: CitationGroup): Promise<void> => {
    for (const part of group.parts) {
      referenceCount += 1;
      if (referenceCount > maxReferences) { failLimit("The draft exceeds the complete-verification reference bound."); return; }
      const reference = formatPart(part);
      if (part.chapter < 1 || part.endChapter > part.book.chapters || part.endChapter < part.chapter || part.chapter > part.book.chapters || (part.verse !== undefined && (part.verse < 1 || part.endVerse === undefined || part.endVerse < 1 || (part.chapter === part.endChapter && part.endVerse < part.verse)))) {
        issues.push({ code: "invalid_reference", severity: "error", message: "The Scripture coordinates or range are outside the canonical Bible.", excerpt: group.sourceText, reference }); continue;
      }
      const verses: ScriptureVerseEvidence[] = [];
      try {
        for (let chapter = part.chapter; chapter <= part.endChapter; chapter += 1) {
          const canonical = await load(part.book.order, chapter);
          const first = chapter === part.chapter ? part.verse ?? 1 : 1;
          const last = chapter === part.endChapter ? part.endVerse ?? canonical.length : canonical.length;
          if (first > canonical.length || last > canonical.length || first > last) {
            issues.push({ code: "invalid_reference", severity: "error", message: "A cited verse does not exist in the canonical chapter; ranges are never clamped.", excerpt: group.sourceText, reference });
            verses.length = 0; break;
          }
          if (verseCount + last - first + 1 > maxVerses) { failLimit("The draft exceeds the complete-verification verse bound."); verses.length = 0; break; }
          for (let verse = first; verse <= last; verse += 1) {
            // An omitted slot supplies no Scripture words. Never fill it from
            // another translation or certify a range that includes it.
            if (!canonical[verse - 1].trim()) throw new Error("The cited verse is omitted from this translation");
            verses.push({ book: part.book.name, order: part.book.order, chapter, verse, text: canonical[verse - 1] });
            verseCount += 1;
          }
        }
      } catch {
        verses.length = 0;
        issues.push({ code: "source_unavailable", severity: "error", message: "The canonical chapter could not be loaded, so this citation cannot be verified.", excerpt: group.sourceText, reference });
      }
      if (verses.length) group.evidence.push({ reference, sourceText: group.sourceText, start: group.start, end: group.end, verses, canonicalText: verses.map((verse) => verse.text).join(" ") });
    }
  };

  // Expand first, then verify the resulting visible text through the same path.
  // Markers inside code fences are deliberately not exempted.
  let text = "";
  let cursor = 0;
  const canonicalBodies: Array<{ start: number; end: number; canonicalText: string }> = [];
  const placeholders = /\[\[SCRIPTURE:([^\]\n]+)\]\]/gi;
  for (const marker of inputText.matchAll(placeholders)) {
    text += inputText.slice(cursor, marker.index);
    const markerIssues: ScriptureVerificationIssue[] = [];
    const groups = scanCitations(marker[1].trim(), markerIssues);
    if (groups.length !== 1 || groups[0].start !== 0 || groups[0].end !== marker[1].trim().length || markerIssues.length) {
      issues.push({ code: "malformed_placeholder", severity: "error", message: "A Scripture placeholder must contain only one complete canonical reference expression.", excerpt: marker[0] });
      text += marker[0];
    } else {
      await resolveGroup(groups[0]);
      if (groups[0].evidence.length !== groups[0].parts.length) text += marker[0];
      else {
        const verses = groups[0].evidence.flatMap((evidence) => evidence.verses);
        const headingStart = adjacentMarkerHeadingStart(inputText, marker.index, marker.index + marker[0].length, groups[0], options.translation, cursor);
        if (headingStart < marker.index) text = text.slice(0, text.length - (marker.index - headingStart));
        text += `**${groups[0].sourceText} (${options.translation})**\n`;
        const start = text.length;
        text += verses.map((verse) => `> ${verse.verse} ${verse.text.replace(/\n/g, "\n> ")}`).join("\n");
        canonicalBodies.push({ start, end: text.length, canonicalText: verses.map((verse) => verse.text).join(" ") });
      }
    }
    cursor = marker.index + marker[0].length;
  }
  text += inputText.slice(cursor);
  if (/\[\[\s*SCRIPTURE\b|SCRIPTURE\s*:[^\n]*\]\]/i.test(text)) issues.push({ code: "malformed_placeholder", severity: "error", message: "An unresolved or malformed Scripture placeholder remains.", excerpt: text.match(/\[\[\s*SCRIPTURE[^\n]*/i)?.[0] ?? "SCRIPTURE marker" });
  if (text.length > SCRIPTURE_VERIFICATION_LIMITS.characters) { failLimit("Canonical expansion exceeds the complete-verification character bound."); return result(text); }
  // The expansion budget is also bounded above, but actual references are
  // counted once in the final text rather than once for each processing pass.
  verseCount = 0;
  referenceCount = 0;
  const identifiers = scanOriginalIdentifiers(text);
  const groups = scanCitations(text, issues, identifiers, canonicalBodies);
  for (const group of groups) {
    if (group.edition) {
      if (group.parts.length !== 1 || group.parts[0].verse === undefined || group.parts[0].chapter !== group.parts[0].endChapter || group.parts[0].verse !== group.parts[0].endVerse) {
        issues.push({ code: "invalid_reference", severity: "error", message: "An original-edition citation must identify one explicit source verse.", excerpt: group.sourceText });
      } else identifiers.push({ start: group.start, end: group.end, sourceText: group.sourceText, edition: group.edition, book: group.parts[0].book, chapter: group.parts[0].chapter, verse: group.parts[0].verse });
    } else { await resolveGroup(group); references.push(...group.evidence); }
  }
  for (const marker of normalizeCitationCharacters(text).matchAll(/\b(?:WLC|TR)\s*\d+\s*:/gi)) {
    if (!identifiers.some((identifier) => marker.index === identifier.start)) issues.push({ code: "invalid_reference", severity: "error", message: "An original-edition identifier has malformed coordinates.", excerpt: text.slice(marker.index, marker.index + 30) });
  }
  const originalByIdentifier = new Map<OriginalIdentifier, ScriptureOriginalEvidence[]>();
  for (const identifier of identifiers) {
    if (++referenceCount > maxReferences) { failLimit("Original-edition citations exceed the complete-verification reference bound."); break; }
    const invalid = (message: string) => issues.push({ code: "invalid_reference", severity: "error", message, excerpt: identifier.sourceText });
    if (/^\s*:|^\s*[-\u2013\u2014\u2212]\s*(?:$|\d)|^\s*[,;]\s*\d|^\p{L}/u.test(text.slice(identifier.end)) || identifier.chapter < 1 || identifier.verse < 1) { invalid("The source identifier has invalid or unsupported range coordinates."); continue; }
    const nearby = references.filter((reference) => Math.min(Math.abs(reference.start - identifier.end), Math.abs(reference.end - identifier.start)) < 500 && !/\n\s*\n/.test(text.slice(Math.min(reference.end, identifier.end), Math.max(reference.start, identifier.start))) && (identifier.edition === "WLC") === (reference.verses[0].order <= 39));
    const orders = new Set(nearby.map((reference) => reference.verses[0].order));
    let book = identifier.book;
    if (!book && orders.size === 1) book = BOOKS.find((candidate) => candidate.order === [...orders][0]);
    if (!book && !orders.size) {
      const context = text.slice(Math.max(0, identifier.start - 180), identifier.end + 180);
      const names = [...context.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])(${bookPattern})(?![\\p{L}\\p{N}])`, "giu"))].map((match) => bookFromMatch(match[1])).filter((candidate): candidate is Book => !!candidate && (identifier.edition === "WLC") === (candidate.order <= 39));
      const distinct = new Set(names.map((candidate) => candidate.order));
      if (distinct.size === 1) book = names[0];
    }
    if (!book || (identifier.edition === "WLC") !== (book.order <= 39)) { invalid("The original-edition identifier needs one unambiguous book in the correct testament."); continue; }
    try {
      const sameBook = nearby.filter((reference) => reference.verses[0].order === book.order);
      const evidence: ScriptureOriginalEvidence[] = [];
      for (const reference of sameBook) {
        for (const verse of reference.verses) {
          const mapped = await mappedOriginal(verse);
          const fragment = mapped?.sourceVersification === identifier.edition ? mapped.sourceReferences.find((source) => source.chapter === identifier.chapter && source.verse === identifier.verse) : undefined;
          if (fragment) {
            const item = await addOriginal(identifier.edition, book, identifier.chapter, identifier.verse, [`${book.name} ${verse.chapter}:${verse.verse}`], fragment);
            if (item) evidence.push(item);
          }
        }
      }
      if (sameBook.length && !evidence.length) { invalid("The original-edition coordinate does not align with the cited KJV verse; adjacent source text cannot substitute for it."); continue; }
      if (!sameBook.length) {
        const item = await addOriginal(identifier.edition, book, identifier.chapter, identifier.verse, []);
        if (item) evidence.push(item);
      }
      if (!evidence.length) { invalid("The cited verse does not exist in the bundled original edition."); continue; }
      originalByIdentifier.set(identifier, evidence);
    } catch {
      issues.push({ code: "source_unavailable", severity: "error", message: "The trusted original-language source could not be loaded.", excerpt: identifier.sourceText });
    }
  }
  const paragraphBreaks = [...text.matchAll(/\n[ \t]*\n/g)].map((match) => match.index + match[0].length);
  const paragraphOf = (offset: number) => paragraphBreaks.filter((end) => end <= offset).length;
  const anchors: Array<{ start: number; end: number; group?: CitationGroup; identifier?: OriginalIdentifier }> = [
    ...groups.filter((group) => !group.edition).map((group) => ({ start: group.start, end: group.end, group })),
    ...identifiers.map((identifier) => ({ start: identifier.start, end: identifier.end, identifier })),
  ].sort((a, b) => a.start - b.start);
  const candidates = quotationCandidates(text, groups);
  const underscoreAnalysis = candidates.some((quote) => quote.text.includes("_")) ? analyzeMarkdownUnderscores(text, { presentation: (source) => normalizeAssistantMarkdown(source, { streaming: false }) }) : undefined;
  for (const quote of candidates) {
    const associated = associatedGroups(quote, text, groups, options.translation);
    const recordQuote = (record: Omit<ScriptureQuoteCheck, "start" | "end" | "citationSpans">) => {
      const citationSpans = associated.map(({ start, end }) => ({ start, end }));
      if ([quote, ...citationSpans].some(({ start, end }) => !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > text.length)) {
        failLimit("Quotation association has ambiguous source offsets."); return;
      }
      quotes.push({ ...record, start: quote.start, end: quote.end, citationSpans });
    };
    const nearbyIdentifiers = identifiers.filter((identifier) => {
      const gap = identifier.end <= quote.start ? text.slice(identifier.end, quote.start) : identifier.start >= quote.end ? text.slice(quote.end, identifier.start) : "";
      return gap.length < 220 && !/\n\s*\n/.test(gap);
    });
    // Exact generated containers already distinguish inserted verse labels
    // from real source numbers on continuation lines. A merged or modified
    // container must still pass the ordinary untrusted quotation path.
    const canonicalBody = canonicalBodies.find((body) => body.start === quote.start && body.end === quote.end);
    const body = canonicalBody?.canonicalText ?? quoteBody(quote, associated, nearbyIdentifiers, underscoreAnalysis);
    if (!normalizedQuote(body)) continue;
    const before = text.slice(Math.max(0, quote.start - 150), quote.start);
    const quoteParagraph = paragraphOf(quote.start);
    const paragraphStart = quoteParagraph ? paragraphBreaks[quoteParagraph - 1] : 0;
    const paragraphEnd = paragraphBreaks[quoteParagraph] ?? text.length;
    // Conservatively honor completeness claims in either word order anywhere
    // around this quote. Exclude the quoted words themselves: a canonical
    // fragment containing "full" is not a promise to reproduce a whole verse.
    const quoteContext = `${text.slice(paragraphStart, quote.start)} ${text.slice(quote.end, paragraphEnd)}`.replace(/[*_`]/g, "");
    const wholeClaim = hasCompletenessClaim(quoteContext);
    const preceding = anchors.filter((anchor) => anchor.end <= quote.start);
    const latest = preceding[preceding.length - 1];
    const active = latest ? preceding.filter((anchor) => paragraphOf(anchor.start) === paragraphOf(latest.start)) : [];
    const activeVerses = new Map(active.flatMap((anchor) => anchor.group?.evidence.flatMap((reference) => reference.verses) ?? []).map((verse) => [`${verse.order}:${verse.chapter}:${verse.verse}`, verse]));
    const activeLabels = new Set([...activeVerses.values()].map((verse) => `${verse.book} ${verse.chapter}:${verse.verse}`));
    const activeOriginal = new Set(active.flatMap((anchor) => anchor.identifier ? originalByIdentifier.get(anchor.identifier) ?? [] : []));
    const namedArtifact = !quote.block && /["\u201c\u2018«»„‚]/.test(text[quote.start] ?? "") && /\b(?:note|study|devotional|reading plan|title)(?:\s+(?:titled|called|named))?\s*$/i.test(before);
    const lexicalGloss = !quote.block && /["\u201c\u2018«»„‚]/.test(text[quote.start] ?? "") && isLexicalGloss(before);
    if (namedArtifact || lexicalGloss) {
      issues.push({ code: "ambiguous_quote", severity: "review", message: namedArtifact ? "A quoted artifact title requires independent semantic review, including any claim in the title or receipt." : "A quoted lexical gloss requires independent semantic review against trusted word metadata; it is not a verbatim Bible quotation.", excerpt: body });
      recordQuote({ text: body, references: [], status: "review" });
      continue;
    }
    if (/[\p{Script=Hebrew}\p{Script=Greek}]/u.test(body)) {
      const evidence = nearbyIdentifiers.flatMap((identifier) => originalByIdentifier.get(identifier) ?? []);
      let joinedVerification: boolean | undefined;
      let corroboratedMention = false;
      const mentionIntent = originalMentionIntent(before);
      try {
        if (!evidence.length && !nearbyIdentifiers.length) {
          for (const verse of associated.flatMap((group) => group.evidence.flatMap((reference) => reference.verses))) {
            const mapped = await mappedOriginal(verse);
            if (!mapped) continue;
            const book = BOOKS.find((candidate) => candidate.order === verse.order)!;
            for (const fragment of mapped.sourceReferences) {
              const item = await addOriginal(mapped.sourceVersification, book, fragment.chapter, fragment.verse, [`${book.name} ${verse.chapter}:${verse.verse}`], fragment);
              if (item) evidence.push(item);
            }
          }
        }
        // A later explanatory paragraph may name a surface token or its lemma
        // without repeating the source label. Corroborate only an exact token
        // in one identifiable trusted source, never borrow across an explicit
        // local citation or concatenate unrelated global source passages.
        if (!associated.length && !nearbyIdentifiers.length && mentionIntent && !wholeClaim) {
          if (!originalEvidence.length) {
            const distinct = latest ? activeVerses : new Map(references.flatMap((reference) => reference.verses).map((verse) => [`${verse.order}:${verse.chapter}:${verse.verse}`, verse]));
            if (distinct.size === 1) {
              const verse = [...distinct.values()][0];
              const mapped = await mappedOriginal(verse);
              const book = BOOKS.find((candidate) => candidate.order === verse.order)!;
              for (const fragment of mapped?.sourceReferences ?? []) await addOriginal(mapped!.sourceVersification, book, fragment.chapter, fragment.verse, [`${book.name} ${verse.chapter}:${verse.verse}`], fragment);
            }
          }
          const matches = originalEvidence.filter((item) => (!latest || activeOriginal.has(item) || item.kjvReferences.some((label) => activeLabels.has(label))) && tokenMentionMatches(body, item, mentionIntent));
          if (matches.length === 1) { evidence.push(matches[0]); corroboratedMention = true; }
          else if (matches.length > 1) issues.push({ code: "ambiguous_quote", severity: "error", message: "The original-language mention matches multiple trusted source passages; identify its source explicitly.", excerpt: body });
        }
        // One KJV verse can comprise several original-source fragments. Only
        // its trusted inverse mapping may establish that ordered join; nearby
        // unrelated original verses are never concatenated opportunistically.
        const singleVerse = associated.length === 1 && associated[0].evidence.length === 1 && associated[0].evidence[0].verses.length === 1 ? associated[0].evidence[0].verses[0] : undefined;
        if (singleVerse) {
          const mapped = await mappedOriginal(singleVerse);
          if (mapped && mapped.sourceReferences.length > 1) {
            const label = `${singleVerse.book} ${singleVerse.chapter}:${singleVerse.verse}`;
            const ordered = mapped.sourceReferences.map((fragment) => evidence.find((item) => item.order === singleVerse.order && item.edition === mapped.sourceVersification && item.chapter === fragment.chapter && item.verse === fragment.verse && item.wordStart === fragment.wordStart && item.wordEnd === fragment.wordEnd && item.kjvReferences.includes(label)));
            const excerpt = /\b(?:uses?|word|term|phrase|fragment|excerpt|part)\b/i.test(text.slice(Math.max(0, quote.start - 100), quote.start));
            const complete = ordered.every((item): item is ScriptureOriginalEvidence => item !== undefined);
            joinedVerification = complete && normalizedQuote(body) === normalizedQuote(ordered.map((item) => item?.text ?? "").join(" "));
            if (!joinedVerification && excerpt && !wholeClaim) joinedVerification = ordered.some((item) => item !== undefined && quoteMatches(body, [{ book: item.book, order: item.order, chapter: item.chapter, verse: item.verse, text: item.text }]));
          }
        }
      } catch {
        issues.push({ code: "source_unavailable", severity: "error", message: "The trusted original-language quotation source could not be loaded.", excerpt: body });
      }
      const sourceEvidence = [...new Set(evidence)];
      const completeSource = sourceEvidence.length === 1 && quoteMatches(body, [{ book: sourceEvidence[0].book, order: sourceEvidence[0].order, chapter: sourceEvidence[0].chapter, verse: sourceEvidence[0].verse, text: sourceEvidence[0].text }], true);
      const verified = corroboratedMention || (wholeClaim ? joinedVerification ?? completeSource : mentionIntent === "lemma" ? evidence.some((item) => tokenMentionMatches(body, item, "lemma")) : joinedVerification ?? evidence.some((item) => quoteMatches(body, [{ book: item.book, order: item.order, chapter: item.chapter, verse: item.verse, text: item.text }])));
      const labels = evidence.map((item) => `${item.book} (${item.sourceIdentifier})`);
      recordQuote({ text: body, references: labels, status: verified ? "verified" : "failed" });
      if (!verified) issues.push({ code: "quote_mismatch", severity: "error", message: "The Hebrew or Greek quotation does not match the trusted original text for the cited source.", excerpt: body, reference: labels.join("; ") });
      continue;
    }
    const scriptureIntent = wholeClaim || /\b(?:scripture|bible|verse|written|saith|jesus\s+(?:said|says)|god\s+(?:said|says)|lord\s+(?:said|says))\b/i.test(before) || /\b(?:saith|verily|whosoever|thou|thee|thy|begotten)\b/i.test(body);
    const userQuote = /\b(?:you\s+(?:said|wrote|asked|mentioned|described)|your\s+(?:words|question)|you\s+told\s+me)\b[^\n]*$/i.test(before);
    const personalQuote = userQuote || (!scriptureIntent && /\bthe\s+phrase\b[^\n]*$/i.test(before));
    const excerptIntent = /\b(?:word|words|phrase|excerpt|fragment|translated|translates|translation)\b/i.test(before) || /^\s*(?:translates|is translated)\b/i.test(text.slice(quote.end, quote.end + 80));
    if (!associated.length && !quote.block && !userQuote && !wholeClaim && excerptIntent && normalizedQuote(body).split(" ").length <= 12 && !/(?:\.{3,}|\u2026)/.test(body)) {
      const distinct = latest ? activeVerses : new Map(references.flatMap((reference) => reference.verses).map((verse) => [`${verse.order}:${verse.chapter}:${verse.verse}`, verse]));
      const matches = [...distinct.values()].filter((verse) => quoteMatches(body, [verse]));
      if (matches.length === 1) {
        const verse = matches[0];
        recordQuote({ text: body, references: [`${verse.book} ${verse.chapter}:${verse.verse}`], status: "verified" });
        continue;
      }
      if (matches.length > 1) {
        issues.push({ code: "ambiguous_quote", severity: "error", message: "The excerpt matches multiple cited verses; identify its source explicitly.", excerpt: body });
        recordQuote({ text: body, references: [], status: "failed" });
        continue;
      }
      if (latest && activeVerses.size && !personalQuote) {
        issues.push({ code: "quote_mismatch", severity: "error", message: "The excerpt does not match the active cited passage; another section's words cannot substitute for it.", excerpt: body });
        recordQuote({ text: body, references: [], status: "failed" });
        continue;
      }
    }
    if (!associated.length || personalQuote) {
      const hard = scriptureIntent && !personalQuote;
      issues.push({ code: hard ? "unattributed_quote" : "ambiguous_quote", severity: hard ? "error" : "review", message: hard ? "A Scripture quotation has no verified citation." : "The quote's source or intent requires independent semantic review.", excerpt: body });
      recordQuote({ text: body, references: [], status: hard ? "failed" : "review" });
      continue;
    }
    const verses = associated.flatMap((group) => group.evidence.flatMap((evidence) => evidence.verses));
    const displayedNumbers = canonicalBody ? verses.map((verse) => verse.verse) : quote.text.split("\n").map((line) => line.replace(/^\s*>\s?/, "").match(/^\s*(?:\*\*)?\[?(\d{1,3})\]?[.)]?(?:\*\*)?\s+/)?.[1]).filter((number): number is string => number !== undefined).map(Number);
    const numberingMatches = !displayedNumbers.length || (displayedNumbers.length === verses.length && displayedNumbers.every((number, index) => number === verses[index].verse));
    const verified = numberingMatches && quoteMatches(body, verses, wholeClaim);
    const labels = associated.flatMap((group) => group.evidence.map((evidence) => evidence.reference));
    recordQuote({ text: body, references: labels, status: verified ? "verified" : "failed" });
    if (!verified) issues.push({ code: "quote_mismatch", severity: "error", message: "The displayed quotation does not match the cited canonical text, or presents only part of a labeled passage.", excerpt: body, reference: labels.join("; ") });
  }
  return result(text);
}

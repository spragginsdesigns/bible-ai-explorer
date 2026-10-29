import { alignFromKjv, originalFragmentMatchesSource } from "./original-versification.mjs";
import { versePlain, verseStrongs } from "./original-text-normalize.mjs";
import { originalQueryClauses, originalQueryMatchesTokens, originalSourceTokens } from "./original-query.mjs";

/**
 * Candidate rows are whole WLC/TR verses. Only a complete query matched inside
 * one trusted fragment may be attributed to a numbered KJV target.
 * @param {string[][]} words
 * @param {string} language
 * @param {{strongs?: readonly string[], text?: string}} options
 */
export function originalFragmentMatchesQuery(words, language, options) {
  const numbers = new Set(verseStrongs(words));
  const clauses = originalQueryClauses(options.text ?? "");
  if (options.text !== undefined && !clauses.length) return false;
  if (!(options.strongs?.length || clauses.length)) return false;
  const tokens = originalSourceTokens(language, words);
  return (!options.strongs?.length || options.strongs.some(id => numbers.has(id))) &&
    originalQueryMatchesTokens(tokens, clauses);
}

/**
 * Reverse the existing precise mapping, validating every source fragment in
 * every target before allowing any source word to claim that KJV coordinate.
 * No source word or legacy indexed KJV column is changed.
 * @param {number} book
 * @param {string[][][][]} original
 * @param {string[][]} kjv
 */
export function buildOriginalConcordance(book, original, kjv) {
  /** @type {"Hebrew"|"Greek"} */
  const language = book <= 39 ? "Hebrew" : "Greek";
  const inverse = alignFromKjv(book, original.map(chapter => chapter.length), kjv.map(chapter => chapter.length));
  /** @type {Map<string, {chapter:number, verse:number, start:number, end:number}[]>} */
  const bySource = new Map();
  for (let chapter = 1; chapter <= kjv.length; chapter++) {
    for (let verse = 1; verse <= kjv[chapter - 1].length; verse++) {
      const sources = inverse(chapter, verse);
      if (!sources.length || sources.some(fragment => {
        const words = original[fragment.chapter - 1]?.[fragment.verse - 1];
        return !words?.length || !originalFragmentMatchesSource(book, fragment, words) ||
          (fragment.wordStart ?? 0) < 0 || (fragment.wordEnd ?? words.length) > words.length ||
          (fragment.wordStart ?? 0) >= (fragment.wordEnd ?? words.length);
      })) continue;
      for (const fragment of sources) {
        const key = `${fragment.chapter}:${fragment.verse}`;
        const entries = bySource.get(key) ?? [];
        entries.push({ chapter, verse, start: fragment.wordStart ?? 0,
          end: fragment.wordEnd ?? original[fragment.chapter - 1][fragment.verse - 1].length });
        bySource.set(key, entries);
      }
    }
  }

  /**
   * Each returned row retains raw source coordinates, precise word offsets,
   * and either a trusted KJV target or an explicitly source-only identity.
   * @param {number} chapter
   * @param {number} verse
   * @param {{strongs?: readonly string[], text?: string, mappedOnly?: boolean}} options
   */
  return (chapter, verse, options) => {
    const words = original[chapter - 1]?.[verse - 1];
    if (!words?.length || !originalFragmentMatchesQuery(words, language, options)) return [];
    const trusted = bySource.get(`${chapter}:${verse}`) ?? [];
    const covered = new Set();
    const candidates = trusted.map(target => {
      for (let at = target.start; at < target.end; at++) covered.add(at);
      return { ...target, sourceOnlyReason: /** @type {string|null} */ (null) };
    });
    // Excluded titles and wholly unaligned verses remain visible as source
    // evidence, but can never become numbered KJV examples.
    for (let at = 0; at < words.length;) {
      if (covered.has(at)) { at++; continue; }
      const start = at;
      while (at < words.length && !covered.has(at)) at++;
      candidates.push({ chapter: 0, verse: 0, start, end: at, sourceOnlyReason: "unmapped-source-fragment" });
    }
    candidates.sort((a, b) => a.start - b.start || a.chapter - b.chapter || a.verse - b.verse);
    const matched = candidates.filter(target => originalFragmentMatchesQuery(words.slice(target.start, target.end), language, options));
    // A conjunction across a split/title boundary is true of the raw verse,
    // not of either individual KJV verse. Retain that fact without inventing
    // a target or weakening the AND predicate to an ANY-word test.
    if (!matched.length) matched.push({ chapter: 0, verse: 0, start: 0, end: words.length, sourceOnlyReason: "query-crosses-fragment-boundary" });
    return matched.filter(target => !options.mappedOnly || target.sourceOnlyReason === null).map(target => {
      const selected = words.slice(target.start, target.end);
      const aligned = target.sourceOnlyReason === null;
      return {
        book, chapter, verse, language,
        text: selected.map(word => word[0]).join(" "), plain: versePlain(language, selected), strongs: verseStrongs(selected),
        kjvBook: aligned ? book : null, kjvChapter: aligned ? target.chapter : null, kjvVerse: aligned ? target.verse : null,
        sourceWordStart: target.start, sourceWordEnd: target.end, sourceOnlyReason: target.sourceOnlyReason,
      };
    });
  };
}

import { versePlain } from "./original-text-normalize.mjs";

/**
 * Query input is already language-normalized by hebrewPlainQuery/greekPlainQuery.
 * Whitespace-separated clauses are ANDed. Punctuation-separated words inside
 * one clause remain adjacent, as in PostgreSQL's parsed quoted lexemes. This
 * keeps punctuation harmless without broadening an internal phrase to ANY or
 * unordered AND. An array item is one clause, matching the prior array API.
 * @param {string | readonly string[]} input
 * @returns {string[][]}
 */
export function originalQueryClauses(input) {
  const chunks = typeof input === "string" ? input.normalize("NFC").toLowerCase().split(/\s+/) : input;
  return chunks.map(chunk => (chunk.normalize("NFC").toLowerCase().match(/[\p{L}\p{N}\p{M}]+/gu) ?? [])
    .filter(word => /[\p{L}\p{N}]/u.test(word))).filter(clause => clause.length > 0);
}

/** @param {string | readonly string[]} input */
export function originalQueryPrefixes(input) {
  return originalQueryClauses(input).flat();
}

/** @param {string | readonly string[]} input */
export function originalQueryTsQuery(input) {
  const clauses = originalQueryClauses(input);
  if (!clauses.length) return null;
  return clauses.map(clause => {
    const terms = clause.map(word => `'${word.replace(/'/g, "''")}':*`);
    return terms.length === 1 ? terms[0] : `(${terms.join(" <-> ")})`;
  }).join(" & ");
}

/**
 * The source side stays identical to the index seed's language normalization.
 * @param {string} language
 * @param {unknown[]} words
 */
export function originalSourceTokens(language, words) {
  return versePlain(language, words).split(/\s+/).filter(Boolean);
}

/**
 * Every complete clause must fit inside this selected source fragment.
 * @param {readonly string[]} tokens
 * @param {ReadonlyArray<ReadonlyArray<string>>} clauses
 */
export function originalQueryMatchesTokens(tokens, clauses) {
  return clauses.every(clause => tokens.some((_, start) => clause.every((prefix, offset) => tokens[start + offset]?.startsWith(prefix))));
}

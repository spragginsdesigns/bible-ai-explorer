/**
 * The LC Greek text (LC-15842, see LC_GREEK in ./audioBible): one JSON per
 * book, chapters → verses in the KJV's numbering, the same text its Alive
 * recording reads. The web reader imports it directly and
 * GET /api/bible/lc-greek serves it to Android and Apple. Webpack needs
 * literal import paths, so every book in LC_GREEK_ALIVE_BOOKS is listed here.
 */
import { hasLcGreek } from "./audioBible";

type Book = string[][];

const loaders: Record<number, () => Promise<Book>> = {
  40: async () => (await import("../../data/lc-greek/40.json")).default as Book,
  41: async () => (await import("../../data/lc-greek/41.json")).default as Book,
  42: async () => (await import("../../data/lc-greek/42.json")).default as Book,
  43: async () => (await import("../../data/lc-greek/43.json")).default as Book,
};

const cache = new Map<number, Book>();

/** A chapter's LC Greek verses, or null when the book or chapter has none. */
export async function loadLcGreekChapter(book: number, chapter: number): Promise<string[] | null> {
  const loader = loaders[book];
  if (!hasLcGreek(book) || !loader) return null;
  let text = cache.get(book);
  if (!text) {
    text = await loader();
    cache.set(book, text);
  }
  return text[chapter - 1] ?? null;
}

/** Every book the loaders list, for the test that pins them to LC_GREEK_ALIVE_BOOKS. */
export const LC_GREEK_BOOKS: readonly number[] = Object.keys(loaders).map(Number);

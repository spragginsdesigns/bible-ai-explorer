/**
 * Lazy access to the bundled KJV text (data/kjv/*.json, chapters → verses).
 * Webpack needs literal import paths, so every book is listed by hand; a
 * book's JSON is only fetched/parsed on first access and then cached for the
 * session. Ported from mobile/src/features/bible/kjv.ts (async on web).
 */
import { BOOKS, bookByOrder } from "./books";

type RawBook = string[][];

const LOADERS: Record<number, () => Promise<RawBook>> = {
  1: async () => (await import("@/data/kjv/01-genesis.json")).default as RawBook,
  2: async () => (await import("@/data/kjv/02-exodus.json")).default as RawBook,
  3: async () => (await import("@/data/kjv/03-leviticus.json")).default as RawBook,
  4: async () => (await import("@/data/kjv/04-numbers.json")).default as RawBook,
  5: async () => (await import("@/data/kjv/05-deuteronomy.json")).default as RawBook,
  6: async () => (await import("@/data/kjv/06-joshua.json")).default as RawBook,
  7: async () => (await import("@/data/kjv/07-judges.json")).default as RawBook,
  8: async () => (await import("@/data/kjv/08-ruth.json")).default as RawBook,
  9: async () => (await import("@/data/kjv/09-1-samuel.json")).default as RawBook,
  10: async () => (await import("@/data/kjv/10-2-samuel.json")).default as RawBook,
  11: async () => (await import("@/data/kjv/11-1-kings.json")).default as RawBook,
  12: async () => (await import("@/data/kjv/12-2-kings.json")).default as RawBook,
  13: async () => (await import("@/data/kjv/13-1-chronicles.json")).default as RawBook,
  14: async () => (await import("@/data/kjv/14-2-chronicles.json")).default as RawBook,
  15: async () => (await import("@/data/kjv/15-ezra.json")).default as RawBook,
  16: async () => (await import("@/data/kjv/16-nehemiah.json")).default as RawBook,
  17: async () => (await import("@/data/kjv/17-esther.json")).default as RawBook,
  18: async () => (await import("@/data/kjv/18-job.json")).default as RawBook,
  19: async () => (await import("@/data/kjv/19-psalms.json")).default as RawBook,
  20: async () => (await import("@/data/kjv/20-proverbs.json")).default as RawBook,
  21: async () => (await import("@/data/kjv/21-ecclesiastes.json")).default as RawBook,
  22: async () => (await import("@/data/kjv/22-song-of-solomon.json")).default as RawBook,
  23: async () => (await import("@/data/kjv/23-isaiah.json")).default as RawBook,
  24: async () => (await import("@/data/kjv/24-jeremiah.json")).default as RawBook,
  25: async () => (await import("@/data/kjv/25-lamentations.json")).default as RawBook,
  26: async () => (await import("@/data/kjv/26-ezekiel.json")).default as RawBook,
  27: async () => (await import("@/data/kjv/27-daniel.json")).default as RawBook,
  28: async () => (await import("@/data/kjv/28-hosea.json")).default as RawBook,
  29: async () => (await import("@/data/kjv/29-joel.json")).default as RawBook,
  30: async () => (await import("@/data/kjv/30-amos.json")).default as RawBook,
  31: async () => (await import("@/data/kjv/31-obadiah.json")).default as RawBook,
  32: async () => (await import("@/data/kjv/32-jonah.json")).default as RawBook,
  33: async () => (await import("@/data/kjv/33-micah.json")).default as RawBook,
  34: async () => (await import("@/data/kjv/34-nahum.json")).default as RawBook,
  35: async () => (await import("@/data/kjv/35-habakkuk.json")).default as RawBook,
  36: async () => (await import("@/data/kjv/36-zephaniah.json")).default as RawBook,
  37: async () => (await import("@/data/kjv/37-haggai.json")).default as RawBook,
  38: async () => (await import("@/data/kjv/38-zechariah.json")).default as RawBook,
  39: async () => (await import("@/data/kjv/39-malachi.json")).default as RawBook,
  40: async () => (await import("@/data/kjv/40-matthew.json")).default as RawBook,
  41: async () => (await import("@/data/kjv/41-mark.json")).default as RawBook,
  42: async () => (await import("@/data/kjv/42-luke.json")).default as RawBook,
  43: async () => (await import("@/data/kjv/43-john.json")).default as RawBook,
  44: async () => (await import("@/data/kjv/44-acts.json")).default as RawBook,
  45: async () => (await import("@/data/kjv/45-romans.json")).default as RawBook,
  46: async () => (await import("@/data/kjv/46-1-corinthians.json")).default as RawBook,
  47: async () => (await import("@/data/kjv/47-2-corinthians.json")).default as RawBook,
  48: async () => (await import("@/data/kjv/48-galatians.json")).default as RawBook,
  49: async () => (await import("@/data/kjv/49-ephesians.json")).default as RawBook,
  50: async () => (await import("@/data/kjv/50-philippians.json")).default as RawBook,
  51: async () => (await import("@/data/kjv/51-colossians.json")).default as RawBook,
  52: async () => (await import("@/data/kjv/52-1-thessalonians.json")).default as RawBook,
  53: async () => (await import("@/data/kjv/53-2-thessalonians.json")).default as RawBook,
  54: async () => (await import("@/data/kjv/54-1-timothy.json")).default as RawBook,
  55: async () => (await import("@/data/kjv/55-2-timothy.json")).default as RawBook,
  56: async () => (await import("@/data/kjv/56-titus.json")).default as RawBook,
  57: async () => (await import("@/data/kjv/57-philemon.json")).default as RawBook,
  58: async () => (await import("@/data/kjv/58-hebrews.json")).default as RawBook,
  59: async () => (await import("@/data/kjv/59-james.json")).default as RawBook,
  60: async () => (await import("@/data/kjv/60-1-peter.json")).default as RawBook,
  61: async () => (await import("@/data/kjv/61-2-peter.json")).default as RawBook,
  62: async () => (await import("@/data/kjv/62-1-john.json")).default as RawBook,
  63: async () => (await import("@/data/kjv/63-2-john.json")).default as RawBook,
  64: async () => (await import("@/data/kjv/64-3-john.json")).default as RawBook,
  65: async () => (await import("@/data/kjv/65-jude.json")).default as RawBook,
  66: async () => (await import("@/data/kjv/66-revelation.json")).default as RawBook,
};

const bookCache = new Map<number, RawBook>();

/** Every chapter of a book, parsed once and cached for the session. */
export async function getKjvBook(order: number): Promise<RawBook> {
  const cached = bookCache.get(order);
  if (cached) return cached;
  const loader = LOADERS[order];
  if (!loader) throw new Error(`Unknown book order: ${order}`);
  const book = await loader();
  bookCache.set(order, book);
  return book;
}

/** All verses of a chapter, 1-indexed by chapter number. Throws when out of range. */
export async function getKjvChapter(order: number, chapter: number): Promise<string[]> {
  const meta = bookByOrder(order);
  if (!meta || chapter < 1 || chapter > meta.chapters) {
    throw new Error(`Unknown chapter: book ${order}, chapter ${chapter}`);
  }
  return (await getKjvBook(order))[chapter - 1];
}

export interface KjvSearchHit {
  order: number;
  chapter: number;
  verse: number;
  text: string;
}

const STOPWORDS = new Set(
  ("a an and are as at be but by for from has have he her his i in is it its me my of on or our shall she that the " +
    "their them they this to unto us was we what when who will with you your thou thee thy ye him verse verses " +
    "bible say says said about does").split(" ")
);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z']+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

export interface KjvKeywordHit extends KjvSearchHit {
  score: number;
}

/**
 * Rank verses by overlap with the query's rare words (IDF-weighted), over the
 * whole bundled KJV. Complements the semantic search: exact-wording recall
 * ("no weapon formed against me") and a fallback that works with AstraDB down.
 * First call loads all book JSONs (a few MB, cached for the session).
 */
export async function keywordSearchKjv(query: string, limit = 5): Promise<KjvKeywordHit[]> {
  const tokens = [...new Set(tokenize(query))];
  if (tokens.length === 0) return [];

  interface Candidate {
    order: number;
    chapter: number;
    verse: number;
    text: string;
    matched: string[];
  }
  const documentFrequency = new Map<string, number>(tokens.map((token) => [token, 0]));
  const candidates: Candidate[] = [];
  const minMatches = Math.min(2, tokens.length);

  for (const book of BOOKS) {
    const chapters = await getKjvBook(book.order);
    for (let chapterIndex = 0; chapterIndex < chapters.length; chapterIndex++) {
      const verses = chapters[chapterIndex];
      for (let verseIndex = 0; verseIndex < verses.length; verseIndex++) {
        const text = verses[verseIndex].toLowerCase();
        let matched: string[] | null = null;
        for (const token of tokens) {
          if (text.includes(token)) {
            documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
            (matched ??= []).push(token);
          }
        }
        if (matched && matched.length >= minMatches) {
          candidates.push({
            order: book.order,
            chapter: chapterIndex + 1,
            verse: verseIndex + 1,
            text: verses[verseIndex],
            matched,
          });
        }
      }
    }
  }

  const TOTAL_VERSES = 31102;
  const scored = candidates.map((candidate) => ({
    order: candidate.order,
    chapter: candidate.chapter,
    verse: candidate.verse,
    text: candidate.text,
    score: candidate.matched.reduce(
      (sum, token) => sum + Math.log(TOTAL_VERSES / Math.max(1, documentFrequency.get(token) ?? 1)),
      0
    ),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/**
 * Case-insensitive substring match over every verse of the bundled KJV, in
 * canonical book/chapter/verse order, capped at `limit` hits. Empty or
 * whitespace-only queries return []. First call loads all book JSONs.
 */
export async function searchKjv(query: string, limit = 100): Promise<KjvSearchHit[]> {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const hits: KjvSearchHit[] = [];
  for (const book of BOOKS) {
    const chapters = await getKjvBook(book.order);
    for (let chapterIndex = 0; chapterIndex < chapters.length; chapterIndex++) {
      const verses = chapters[chapterIndex];
      for (let verseIndex = 0; verseIndex < verses.length; verseIndex++) {
        if (verses[verseIndex].toLowerCase().includes(needle)) {
          hits.push({
            order: book.order,
            chapter: chapterIndex + 1,
            verse: verseIndex + 1,
            text: verses[verseIndex],
          });
          if (hits.length >= limit) return hits;
        }
      }
    }
  }
  return hits;
}

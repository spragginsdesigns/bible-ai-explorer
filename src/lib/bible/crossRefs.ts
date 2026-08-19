/**
 * Lazy access to the bundled cross-reference data (data/crossrefs/*.json,
 * built by scripts/build-cross-references.mjs from the openbible.info
 * cross-reference set, CC-BY). Keys are "chapter:verse"; values are compact
 * tuples: [order, chapter, verse] or [order, chapter, verse, endCh, endVerse],
 * ranked best-first. Webpack needs literal import paths, so every book is
 * listed by hand, mirroring kjv.ts.
 */

// Tuples arrive from JSON as plain number arrays:
// [order, chapter, verse] or [order, chapter, verse, endCh, endVerse].
type RawBookRefs = Record<string, number[][]>;

const LOADERS: Record<number, () => Promise<RawBookRefs>> = {
  1: async () => (await import("@/data/crossrefs/01-genesis.json")).default as RawBookRefs,
  2: async () => (await import("@/data/crossrefs/02-exodus.json")).default as RawBookRefs,
  3: async () => (await import("@/data/crossrefs/03-leviticus.json")).default as RawBookRefs,
  4: async () => (await import("@/data/crossrefs/04-numbers.json")).default as RawBookRefs,
  5: async () => (await import("@/data/crossrefs/05-deuteronomy.json")).default as RawBookRefs,
  6: async () => (await import("@/data/crossrefs/06-joshua.json")).default as RawBookRefs,
  7: async () => (await import("@/data/crossrefs/07-judges.json")).default as RawBookRefs,
  8: async () => (await import("@/data/crossrefs/08-ruth.json")).default as RawBookRefs,
  9: async () => (await import("@/data/crossrefs/09-1-samuel.json")).default as RawBookRefs,
  10: async () => (await import("@/data/crossrefs/10-2-samuel.json")).default as RawBookRefs,
  11: async () => (await import("@/data/crossrefs/11-1-kings.json")).default as RawBookRefs,
  12: async () => (await import("@/data/crossrefs/12-2-kings.json")).default as RawBookRefs,
  13: async () => (await import("@/data/crossrefs/13-1-chronicles.json")).default as RawBookRefs,
  14: async () => (await import("@/data/crossrefs/14-2-chronicles.json")).default as RawBookRefs,
  15: async () => (await import("@/data/crossrefs/15-ezra.json")).default as RawBookRefs,
  16: async () => (await import("@/data/crossrefs/16-nehemiah.json")).default as RawBookRefs,
  17: async () => (await import("@/data/crossrefs/17-esther.json")).default as RawBookRefs,
  18: async () => (await import("@/data/crossrefs/18-job.json")).default as RawBookRefs,
  19: async () => (await import("@/data/crossrefs/19-psalms.json")).default as RawBookRefs,
  20: async () => (await import("@/data/crossrefs/20-proverbs.json")).default as RawBookRefs,
  21: async () => (await import("@/data/crossrefs/21-ecclesiastes.json")).default as RawBookRefs,
  22: async () => (await import("@/data/crossrefs/22-song-of-solomon.json")).default as RawBookRefs,
  23: async () => (await import("@/data/crossrefs/23-isaiah.json")).default as RawBookRefs,
  24: async () => (await import("@/data/crossrefs/24-jeremiah.json")).default as RawBookRefs,
  25: async () => (await import("@/data/crossrefs/25-lamentations.json")).default as RawBookRefs,
  26: async () => (await import("@/data/crossrefs/26-ezekiel.json")).default as RawBookRefs,
  27: async () => (await import("@/data/crossrefs/27-daniel.json")).default as RawBookRefs,
  28: async () => (await import("@/data/crossrefs/28-hosea.json")).default as RawBookRefs,
  29: async () => (await import("@/data/crossrefs/29-joel.json")).default as RawBookRefs,
  30: async () => (await import("@/data/crossrefs/30-amos.json")).default as RawBookRefs,
  31: async () => (await import("@/data/crossrefs/31-obadiah.json")).default as RawBookRefs,
  32: async () => (await import("@/data/crossrefs/32-jonah.json")).default as RawBookRefs,
  33: async () => (await import("@/data/crossrefs/33-micah.json")).default as RawBookRefs,
  34: async () => (await import("@/data/crossrefs/34-nahum.json")).default as RawBookRefs,
  35: async () => (await import("@/data/crossrefs/35-habakkuk.json")).default as RawBookRefs,
  36: async () => (await import("@/data/crossrefs/36-zephaniah.json")).default as RawBookRefs,
  37: async () => (await import("@/data/crossrefs/37-haggai.json")).default as RawBookRefs,
  38: async () => (await import("@/data/crossrefs/38-zechariah.json")).default as RawBookRefs,
  39: async () => (await import("@/data/crossrefs/39-malachi.json")).default as RawBookRefs,
  40: async () => (await import("@/data/crossrefs/40-matthew.json")).default as RawBookRefs,
  41: async () => (await import("@/data/crossrefs/41-mark.json")).default as RawBookRefs,
  42: async () => (await import("@/data/crossrefs/42-luke.json")).default as RawBookRefs,
  43: async () => (await import("@/data/crossrefs/43-john.json")).default as RawBookRefs,
  44: async () => (await import("@/data/crossrefs/44-acts.json")).default as RawBookRefs,
  45: async () => (await import("@/data/crossrefs/45-romans.json")).default as RawBookRefs,
  46: async () => (await import("@/data/crossrefs/46-1-corinthians.json")).default as RawBookRefs,
  47: async () => (await import("@/data/crossrefs/47-2-corinthians.json")).default as RawBookRefs,
  48: async () => (await import("@/data/crossrefs/48-galatians.json")).default as RawBookRefs,
  49: async () => (await import("@/data/crossrefs/49-ephesians.json")).default as RawBookRefs,
  50: async () => (await import("@/data/crossrefs/50-philippians.json")).default as RawBookRefs,
  51: async () => (await import("@/data/crossrefs/51-colossians.json")).default as RawBookRefs,
  52: async () => (await import("@/data/crossrefs/52-1-thessalonians.json")).default as RawBookRefs,
  53: async () => (await import("@/data/crossrefs/53-2-thessalonians.json")).default as RawBookRefs,
  54: async () => (await import("@/data/crossrefs/54-1-timothy.json")).default as RawBookRefs,
  55: async () => (await import("@/data/crossrefs/55-2-timothy.json")).default as RawBookRefs,
  56: async () => (await import("@/data/crossrefs/56-titus.json")).default as RawBookRefs,
  57: async () => (await import("@/data/crossrefs/57-philemon.json")).default as RawBookRefs,
  58: async () => (await import("@/data/crossrefs/58-hebrews.json")).default as RawBookRefs,
  59: async () => (await import("@/data/crossrefs/59-james.json")).default as RawBookRefs,
  60: async () => (await import("@/data/crossrefs/60-1-peter.json")).default as RawBookRefs,
  61: async () => (await import("@/data/crossrefs/61-2-peter.json")).default as RawBookRefs,
  62: async () => (await import("@/data/crossrefs/62-1-john.json")).default as RawBookRefs,
  63: async () => (await import("@/data/crossrefs/63-2-john.json")).default as RawBookRefs,
  64: async () => (await import("@/data/crossrefs/64-3-john.json")).default as RawBookRefs,
  65: async () => (await import("@/data/crossrefs/65-jude.json")).default as RawBookRefs,
  66: async () => (await import("@/data/crossrefs/66-revelation.json")).default as RawBookRefs,
};

const bookCache = new Map<number, RawBookRefs>();

async function getBookRefs(order: number): Promise<RawBookRefs> {
  const cached = bookCache.get(order);
  if (cached) return cached;
  const loader = LOADERS[order];
  if (!loader) throw new Error(`Unknown book order: ${order}`);
  const refs = await loader();
  bookCache.set(order, refs);
  return refs;
}

export interface CrossReference {
  order: number;
  chapter: number;
  verse: number;
  endChapter?: number;
  endVerse?: number;
}

/** Ranked cross-references for one verse, best first. Empty when none exist. */
export async function getCrossReferencesFor(
  order: number,
  chapter: number,
  verse: number
): Promise<CrossReference[]> {
  const book = await getBookRefs(order);
  const tuples = book[`${chapter}:${verse}`] ?? [];
  return tuples
    .filter((tuple) => tuple.length >= 3)
    .map((tuple) => ({
      order: tuple[0],
      chapter: tuple[1],
      verse: tuple[2],
      ...(tuple.length === 5 ? { endChapter: tuple[3], endVerse: tuple[4] } : {}),
    }));
}

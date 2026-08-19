/**
 * Lazy access to the bundled original-language texts (data/originals/*.json,
 * built by scripts/build-original-languages.mjs):
 *
 *   OT  - Westminster Leningrad Codex (OSHB, CC-BY 4.0)
 *   NT  - Scrivener 1894 Textus Receptus, the Greek text underlying the KJV
 *         (Robinson's edition, public domain)
 *   Strong's Hebrew & Greek dictionaries (Open Scriptures, CC-BY-SA)
 *
 * Data shape per book: chapters -> verses -> words, each word a
 * [text, strongsNumber, morphCode] triple. Webpack needs literal import
 * paths, so every book is listed by hand, mirroring kjv.ts.
 */

/** chapters -> verses -> words, each word a [text, strongs, morph] triple. */
type RawBook = string[][][][];

const LOADERS: Record<number, () => Promise<RawBook>> = {
  1: async () => (await import("@/data/originals/01-genesis.json")).default as RawBook,
  2: async () => (await import("@/data/originals/02-exodus.json")).default as RawBook,
  3: async () => (await import("@/data/originals/03-leviticus.json")).default as RawBook,
  4: async () => (await import("@/data/originals/04-numbers.json")).default as RawBook,
  5: async () => (await import("@/data/originals/05-deuteronomy.json")).default as RawBook,
  6: async () => (await import("@/data/originals/06-joshua.json")).default as RawBook,
  7: async () => (await import("@/data/originals/07-judges.json")).default as RawBook,
  8: async () => (await import("@/data/originals/08-ruth.json")).default as RawBook,
  9: async () => (await import("@/data/originals/09-1-samuel.json")).default as RawBook,
  10: async () => (await import("@/data/originals/10-2-samuel.json")).default as RawBook,
  11: async () => (await import("@/data/originals/11-1-kings.json")).default as RawBook,
  12: async () => (await import("@/data/originals/12-2-kings.json")).default as RawBook,
  13: async () => (await import("@/data/originals/13-1-chronicles.json")).default as RawBook,
  14: async () => (await import("@/data/originals/14-2-chronicles.json")).default as RawBook,
  15: async () => (await import("@/data/originals/15-ezra.json")).default as RawBook,
  16: async () => (await import("@/data/originals/16-nehemiah.json")).default as RawBook,
  17: async () => (await import("@/data/originals/17-esther.json")).default as RawBook,
  18: async () => (await import("@/data/originals/18-job.json")).default as RawBook,
  19: async () => (await import("@/data/originals/19-psalms.json")).default as RawBook,
  20: async () => (await import("@/data/originals/20-proverbs.json")).default as RawBook,
  21: async () => (await import("@/data/originals/21-ecclesiastes.json")).default as RawBook,
  22: async () => (await import("@/data/originals/22-song-of-solomon.json")).default as RawBook,
  23: async () => (await import("@/data/originals/23-isaiah.json")).default as RawBook,
  24: async () => (await import("@/data/originals/24-jeremiah.json")).default as RawBook,
  25: async () => (await import("@/data/originals/25-lamentations.json")).default as RawBook,
  26: async () => (await import("@/data/originals/26-ezekiel.json")).default as RawBook,
  27: async () => (await import("@/data/originals/27-daniel.json")).default as RawBook,
  28: async () => (await import("@/data/originals/28-hosea.json")).default as RawBook,
  29: async () => (await import("@/data/originals/29-joel.json")).default as RawBook,
  30: async () => (await import("@/data/originals/30-amos.json")).default as RawBook,
  31: async () => (await import("@/data/originals/31-obadiah.json")).default as RawBook,
  32: async () => (await import("@/data/originals/32-jonah.json")).default as RawBook,
  33: async () => (await import("@/data/originals/33-micah.json")).default as RawBook,
  34: async () => (await import("@/data/originals/34-nahum.json")).default as RawBook,
  35: async () => (await import("@/data/originals/35-habakkuk.json")).default as RawBook,
  36: async () => (await import("@/data/originals/36-zephaniah.json")).default as RawBook,
  37: async () => (await import("@/data/originals/37-haggai.json")).default as RawBook,
  38: async () => (await import("@/data/originals/38-zechariah.json")).default as RawBook,
  39: async () => (await import("@/data/originals/39-malachi.json")).default as RawBook,
  40: async () => (await import("@/data/originals/40-matthew.json")).default as RawBook,
  41: async () => (await import("@/data/originals/41-mark.json")).default as RawBook,
  42: async () => (await import("@/data/originals/42-luke.json")).default as RawBook,
  43: async () => (await import("@/data/originals/43-john.json")).default as RawBook,
  44: async () => (await import("@/data/originals/44-acts.json")).default as RawBook,
  45: async () => (await import("@/data/originals/45-romans.json")).default as RawBook,
  46: async () => (await import("@/data/originals/46-1-corinthians.json")).default as RawBook,
  47: async () => (await import("@/data/originals/47-2-corinthians.json")).default as RawBook,
  48: async () => (await import("@/data/originals/48-galatians.json")).default as RawBook,
  49: async () => (await import("@/data/originals/49-ephesians.json")).default as RawBook,
  50: async () => (await import("@/data/originals/50-philippians.json")).default as RawBook,
  51: async () => (await import("@/data/originals/51-colossians.json")).default as RawBook,
  52: async () => (await import("@/data/originals/52-1-thessalonians.json")).default as RawBook,
  53: async () => (await import("@/data/originals/53-2-thessalonians.json")).default as RawBook,
  54: async () => (await import("@/data/originals/54-1-timothy.json")).default as RawBook,
  55: async () => (await import("@/data/originals/55-2-timothy.json")).default as RawBook,
  56: async () => (await import("@/data/originals/56-titus.json")).default as RawBook,
  57: async () => (await import("@/data/originals/57-philemon.json")).default as RawBook,
  58: async () => (await import("@/data/originals/58-hebrews.json")).default as RawBook,
  59: async () => (await import("@/data/originals/59-james.json")).default as RawBook,
  60: async () => (await import("@/data/originals/60-1-peter.json")).default as RawBook,
  61: async () => (await import("@/data/originals/61-2-peter.json")).default as RawBook,
  62: async () => (await import("@/data/originals/62-1-john.json")).default as RawBook,
  63: async () => (await import("@/data/originals/63-2-john.json")).default as RawBook,
  64: async () => (await import("@/data/originals/64-3-john.json")).default as RawBook,
  65: async () => (await import("@/data/originals/65-jude.json")).default as RawBook,
  66: async () => (await import("@/data/originals/66-revelation.json")).default as RawBook,
};

const bookCache = new Map<number, RawBook>();

async function getOriginalBook(order: number): Promise<RawBook> {
  const cached = bookCache.get(order);
  if (cached) return cached;
  const loader = LOADERS[order];
  if (!loader) throw new Error(`Unknown book order: ${order}`);
  const book = await loader();
  bookCache.set(order, book);
  return book;
}

export interface StrongsEntry {
  lemma: string;
  translit: string;
  def: string;
  kjv: string;
}

type StrongsDictionary = Record<string, StrongsEntry>;

let hebrewDict: StrongsDictionary | null = null;
let greekDict: StrongsDictionary | null = null;

async function getDictionary(language: "hebrew" | "greek"): Promise<StrongsDictionary> {
  if (language === "hebrew") {
    hebrewDict ??= (await import("@/data/originals/strongs-hebrew.json"))
      .default as StrongsDictionary;
    return hebrewDict;
  }
  greekDict ??= (await import("@/data/originals/strongs-greek.json"))
    .default as StrongsDictionary;
  return greekDict;
}

/** Strong's dictionary entry for a number like "H430" or "G3056". */
export async function lookupStrongsEntry(number: string): Promise<StrongsEntry | null> {
  const normalized = number.trim().toUpperCase().replace(/^([HG])0+/, "$1");
  if (!/^[HG]\d+$/.test(normalized)) return null;
  const dict = await getDictionary(normalized.startsWith("H") ? "hebrew" : "greek");
  return dict[normalized] ?? null;
}

export interface OriginalWord {
  /** The word as written (Hebrew with points, or unaccented Greek). */
  text: string;
  strongs: string;
  /** OSHB morphology code (OT) or Robinson parsing code (NT). */
  morph: string;
  /** Dictionary lemma, transliteration and gloss for the Strong's number. */
  lemma?: string;
  translit?: string;
  gloss?: string;
}

export interface OriginalVerse {
  language: "Hebrew" | "Greek";
  textName: string;
  words: OriginalWord[];
}

/**
 * The original-language text of one verse, word by word with Strong's
 * numbers, morphology, and dictionary glosses. Returns null when the verse
 * does not exist in the original-language versification.
 */
export async function getOriginalVerse(
  order: number,
  chapter: number,
  verse: number
): Promise<OriginalVerse | null> {
  const book = await getOriginalBook(order);
  const words = book[chapter - 1]?.[verse - 1];
  if (!words || words.length === 0) return null;

  const isOldTestament = order <= 39;
  const dict = await getDictionary(isOldTestament ? "hebrew" : "greek");
  return {
    language: isOldTestament ? "Hebrew" : "Greek",
    textName: isOldTestament
      ? "Westminster Leningrad Codex"
      : "Scrivener 1894 Textus Receptus",
    words: words.map((word) => {
      const [text, strongs, morph] = word;
      const entry = strongs ? dict[strongs] : undefined;
      return {
        text,
        strongs,
        morph,
        ...(entry
          ? { lemma: entry.lemma, translit: entry.translit, gloss: entry.kjv || entry.def }
          : {}),
      };
    }),
  };
}

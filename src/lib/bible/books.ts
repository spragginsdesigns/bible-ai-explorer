/**
 * Book metadata for the Bible reader (data/books.json, generated alongside the
 * bundled KJV text) plus a loose reference parser so verse cards and Ask-AI
 * links can turn "John 3:16"-style strings into a book/chapter/verse location.
 * Ported from mobile/src/features/bible/books.ts.
 */
import booksJson from "@/data/books.json";

export interface Book {
  order: number;
  name: string;
  abbr: string;
  testament: "OT" | "NT";
  chapters: number;
  file: string;
}

export interface Reference {
  order: number;
  chapter: number;
  verse?: number;
}

export const BOOKS: Book[] = booksJson as Book[];

export function bookByOrder(order: number): Book | null {
  return BOOKS.find((book) => book.order === order) ?? null;
}

/** Genre groupings used to subdivide each testament on the book list. */
export type BookGroup =
  | "Law"
  | "History"
  | "Poetry & Wisdom"
  | "Major Prophets"
  | "Minor Prophets"
  | "Gospels"
  | "Paul's Epistles"
  | "General Epistles"
  | "Prophecy";

export const BOOK_GROUPS: BookGroup[] = [
  "Law",
  "History",
  "Poetry & Wisdom",
  "Major Prophets",
  "Minor Prophets",
  "Gospels",
  "Paul's Epistles",
  "General Epistles",
  "Prophecy",
];

/** Map a book's canonical order (1–66) to its genre group. */
export function bookGroup(order: number): BookGroup | null {
  if (order >= 1 && order <= 5) return "Law";
  if (order >= 6 && order <= 17) return "History";
  if (order >= 18 && order <= 22) return "Poetry & Wisdom";
  if (order >= 23 && order <= 27) return "Major Prophets";
  if (order >= 28 && order <= 39) return "Minor Prophets";
  if (order >= 40 && order <= 43) return "Gospels";
  if (order === 44) return "History";
  if (order >= 45 && order <= 57) return "Paul's Epistles";
  if (order >= 58 && order <= 65) return "General Epistles";
  if (order === 66) return "Prophecy";
  return null;
}

/** Lowercase, drop punctuation, collapse whitespace: "1 Sam." → "1 sam". */
function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extra aliases beyond the data's name/abbr (e.g. "Psalm" vs "Psalms").
 *
 * The short forms are the abbreviations books.json does not carry - it ships
 * exactly one abbr per book ("Mark", not "Mk"). Chat prose links every one of
 * them (src/utils/verseParser.ts), and a link that cannot resolve is a popover
 * with no verse and no "Read in the Bible", so the detection list and this
 * table have to stay in step. Mirrors ABBREVIATION_ALIASES in
 * mobile/src/features/chat/verseLinks.ts.
 */
const EXTRA_ALIASES: Record<string, string> = {
  psalm: "Psalms",
  "song of songs": "Song of Solomon",
  exod: "Exodus",
  eccles: "Ecclesiastes",
  ob: "Obadiah",
  mk: "Mark",
  lk: "Luke",
  jn: "John",
  "1 jn": "1 John",
  "2 jn": "2 John",
  "3 jn": "3 John",
  tit: "Titus",
};

const NAME_TO_BOOK = (() => {
  const map = new Map<string, Book>();
  for (const book of BOOKS) {
    map.set(normalizeName(book.name), book);
    map.set(normalizeName(book.abbr), book);
  }
  for (const [alias, name] of Object.entries(EXTRA_ALIASES)) {
    const book = BOOKS.find((b) => b.name === name);
    if (book) map.set(normalizeName(alias), book);
  }
  return map;
})();

// The separator before the chapter is whitespace OR the period of an
// abbreviation the model wrote without a space ("Gen.1:1"). A range tail may
// cross a chapter boundary ("John 3:16-4:2"); it is matched so the reference
// still resolves, to the verse the range opens at. The en/em dashes are
// written as escapes so the class survives tooling that flattens non-ASCII.
const REFERENCE_PATTERN =
  /^([1-3])?\s*([a-zA-Z. ]+?)(?:\.\s*|\s+)(\d+)(?:\s*:\s*(\d+)(?:\s*[-\u2013\u2014]\s*\d+(?:\s*:\s*\d+)?)?)?$/;

/**
 * Parse "John 3:16", "1 Samuel 2:1-10", "Psalm 23", "Gen 1", "Gen.1:1",
 * "Jn 3:16" (case-insensitive, full names and abbreviations) into a location.
 * A verse range - including a cross-chapter one like "John 3:16-4:2" -
 * resolves to its start verse. Returns null when the input cannot be resolved.
 */
export function resolveReference(input: string): Reference | null {
  const match = input.trim().match(REFERENCE_PATTERN);
  if (!match) return null;

  const [, leadingDigit, namePart, chapterPart, versePart] = match;
  const bookName = `${leadingDigit ? `${leadingDigit} ` : ""}${namePart}`;
  const book = NAME_TO_BOOK.get(normalizeName(bookName));
  if (!book) return null;

  const chapter = Number.parseInt(chapterPart, 10);
  if (!Number.isInteger(chapter) || chapter < 1 || chapter > book.chapters) return null;

  if (versePart === undefined) return { order: book.order, chapter };

  const verse = Number.parseInt(versePart, 10);
  if (!Number.isInteger(verse) || verse < 1) return null;
  return { order: book.order, chapter, verse };
}

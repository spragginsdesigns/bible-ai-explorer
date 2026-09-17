import { resolveReference } from "@/lib/bible/books";
import { stripTranslationTag, TRANSLATION_TAGS } from "@/utils/verseParser";

// USFM book identifiers, in the same canonical order as books.json.
const BOOK_CODES = "GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV".split(" ");
const TAG = new RegExp(`\\s+(${TRANSLATION_TAGS})$`, "i");
const GATEWAY_TRANSLATIONS = new Set(["KJV", "NKJV", "NIV", "ESV", "NASB", "NLT", "RSV", "ASV", "AMP"]);

/** Public reading links never silently substitute another translation. */
export function sharedPassageLink(reference: string, translation: string) {
  const bare = stripTranslationTag(reference).replace(/[\u2013\u2014]/g, "-");
  const location = resolveReference(bare);
  if (!location) return null;
  const version = (reference.trim().match(TAG)?.[1] ?? translation).trim().toUpperCase();
  if (version === "BSB") {
    const book = BOOK_CODES[location.order - 1];
    const range = bare.match(/-\s*(\d+)(?::(\d+))?$/);
    // YouVersion rejects cross-chapter selection URLs. Open the starting
    // chapter, with its next-chapter navigation, instead of a broken range.
    const crossChapter = Boolean(range?.[2]);
    const start = `${book}.${location.chapter}${location.verse && !crossChapter ? `.${location.verse}` : ""}`;
    const end = range && !crossChapter ? range[1] : null;
    return { href: `https://www.bible.com/bible/3034/${start}${end ? `-${end}` : ""}.BSB`, version, provider: "YouVersion", startingChapter: crossChapter };
  }
  if (!GATEWAY_TRANSLATIONS.has(version)) return null;
  const params = new URLSearchParams({ search: bare, version });
  return { href: `https://www.biblegateway.com/passage/?${params}`, version, provider: "Bible Gateway", startingChapter: false };
}

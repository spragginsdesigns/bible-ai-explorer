/**
 * Chapter loading for the Bible reader. KJV, BSB, Reina-Valera 1909 and
 * Lutherbibel 1912 are bundled with the app; NKJV is fetched from bolls.life
 * per chapter with a timeout and cached in memory for the session. Ported from
 * mobile/src/features/bible/translations.ts.
 */
import { loadBsbChapter } from "./bsb";
import { getEbibleChapter } from "./ebible";
import { getKjvChapter } from "./kjv";

export type TranslationId = "KJV" | "NKJV" | "BSB" | "RV1909" | "LUT1912";

/** The languages SureWord answers in. */
export type AnswerLanguage = "en" | "es" | "de";

export const ANSWER_LANGUAGES: readonly AnswerLanguage[] = ["en", "es", "de"];

export const LANGUAGE_NAMES: Record<AnswerLanguage, string> = {
  en: "English",
  es: "Español",
  de: "Deutsch",
};

export const TRANSLATIONS: Record<
  TranslationId,
  { id: TranslationId; label: string; copyright: string; language: AnswerLanguage }
> = {
  BSB: { id: "BSB", label: "Berean Standard Bible", copyright: "Public domain · BSB Publishing", language: "en" },
  KJV: { id: "KJV", label: "KJV", copyright: "Public domain", language: "en" },
  NKJV: { id: "NKJV", label: "NKJV", copyright: "© Thomas Nelson - text via bolls.life", language: "en" },
  RV1909: { id: "RV1909", label: "Reina-Valera 1909", copyright: "Public domain", language: "es" },
  LUT1912: { id: "LUT1912", label: "Lutherbibel 1912", copyright: "Public domain", language: "de" },
};

export const TRANSLATION_IDS = Object.keys(TRANSLATIONS) as TranslationId[];

export function isTranslationId(value: unknown): value is TranslationId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(TRANSLATIONS, value);
}

/** A stored or requested translation, or `fallback` (KJV) when it is not one we serve. */
export function parseTranslationId(value: unknown, fallback: TranslationId = "KJV"): TranslationId {
  return isTranslationId(value) ? value : fallback;
}

export function isAnswerLanguage(value: unknown): value is AnswerLanguage {
  return typeof value === "string" && (ANSWER_LANGUAGES as readonly string[]).includes(value);
}

/** Each language's own Bible, quoted when the reader's Bible is in another language. */
export const LANGUAGE_BIBLES: Record<AnswerLanguage, TranslationId> = {
  en: "KJV",
  es: "RV1909",
  de: "LUT1912",
};

/**
 * The Bible an answer in `language` quotes: the reader's own Bible when it is
 * in that language, otherwise that language's Bible. A Spanish answer never
 * quotes English Scripture, and an English answer never quotes Luther.
 */
export function quotationTranslation(translation: TranslationId, language: AnswerLanguage): TranslationId {
  return TRANSLATIONS[translation].language === language ? translation : LANGUAGE_BIBLES[language];
}

export const CHAPTER_LOAD_ERROR =
  "That chapter could not be loaded. Check your connection and try again.";

// The server reads NKJV inside API routes capped at 10 s (crossrefs), so its
// fetch must give up well before the function does or the timeout never fires
// and the request dies as a platform error. The browser reader has no such
// ceiling and keeps the patient value for slow phone connections.
const NKJV_TIMEOUT_MS = typeof window === "undefined" ? 6000 : 15000;

const nkjvCache = new Map<string, string[]>();
const nkjvPending = new Map<string, Promise<string[]>>();

interface BollsVerseRow {
  verse: number;
  text: string;
}

async function fetchNkjvChapter(order: number, chapter: number): Promise<string[]> {
  const key = `${order}:${chapter}`;
  const cached = nkjvCache.get(key);
  if (cached) return cached;
  const existing = nkjvPending.get(key);
  if (existing) return existing;
  const request = loadNkjvChapter(order, chapter).finally(() => nkjvPending.delete(key));
  nkjvPending.set(key, request);
  return request;
}

async function loadNkjvChapter(order: number, chapter: number): Promise<string[]> {
  const key = `${order}:${chapter}`;
  const cached = nkjvCache.get(key);
  if (cached) return cached;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NKJV_TIMEOUT_MS);
  try {
    const response = await fetch(
      `https://bolls.life/get-chapter/NKJV/${order}/${chapter}/`,
      { signal: controller.signal }
    );
    if (!response.ok) throw new Error(`bolls.life responded ${response.status}`);
    const rows: unknown = await response.json();
    if (!Array.isArray(rows)) throw new Error("Unexpected bolls.life payload");
    const verses = (rows as BollsVerseRow[])
      .slice()
      .sort((a, b) => a.verse - b.verse)
      .map((row) => String(row.text ?? "").replace(/ {2,}/g, " ").trim());
    nkjvCache.set(key, verses);
    return verses;
  } catch (error) {
    // The message is for the reader; the cause keeps the real failure for logs.
    throw new Error(CHAPTER_LOAD_ERROR, { cause: error });
  } finally {
    clearTimeout(timer);
  }
}

export async function getChapter(
  translation: TranslationId,
  order: number,
  chapter: number
): Promise<string[]> {
  if (translation === "BSB") return (await loadBsbChapter(order, chapter)).map(verse => verse.text);
  if (translation === "RV1909" || translation === "LUT1912") {
    try {
      return await getEbibleChapter(translation, order, chapter);
    } catch {
      throw new Error(CHAPTER_LOAD_ERROR);
    }
  }
	if (translation === "KJV") {
    try {
      return await getKjvChapter(order, chapter);
    } catch {
      throw new Error(CHAPTER_LOAD_ERROR);
    }
  }
  return fetchNkjvChapter(order, chapter);
}

/**
 * A single verse's text in the requested translation (1-indexed chapter and
 * verse). Returns undefined when the coordinates are out of range. Used by the
 * chat tools so the AI quotes the translation the user selected.
 */
export async function getVerseText(
  translation: TranslationId,
  order: number,
  chapter: number,
  verse: number
): Promise<string | undefined> {
  const verses = await getChapter(translation, order, chapter);
  return verses[verse - 1];
}

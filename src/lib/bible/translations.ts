/**
 * Chapter loading for the Bible reader. KJV is bundled with the app; NKJV is
 * fetched from bolls.life per chapter with a timeout and cached in memory for
 * the session. Ported from mobile/src/features/bible/translations.ts.
 */
import { getKjvChapter } from "./kjv";

export type TranslationId = "KJV" | "NKJV";

export const TRANSLATIONS: Record<TranslationId, { id: TranslationId; label: string; copyright: string }> = {
  KJV: { id: "KJV", label: "KJV", copyright: "Public domain" },
  NKJV: { id: "NKJV", label: "NKJV", copyright: "© Thomas Nelson — text via bolls.life" },
};

export const CHAPTER_LOAD_ERROR =
  "That chapter could not be loaded. Check your connection and try again.";

const NKJV_TIMEOUT_MS = 15000;

const nkjvCache = new Map<string, string[]>();

interface BollsVerseRow {
  verse: number;
  text: string;
}

async function fetchNkjvChapter(order: number, chapter: number): Promise<string[]> {
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
  } catch {
    throw new Error(CHAPTER_LOAD_ERROR);
  } finally {
    clearTimeout(timer);
  }
}

export async function getChapter(
  translation: TranslationId,
  order: number,
  chapter: number
): Promise<string[]> {
  if (translation === "KJV") {
    try {
      return await getKjvChapter(order, chapter);
    } catch {
      throw new Error(CHAPTER_LOAD_ERROR);
    }
  }
  return fetchNkjvChapter(order, chapter);
}

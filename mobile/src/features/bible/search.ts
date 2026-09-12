import { searchKjv, type KjvSearchHit } from "./kjv";
import { bookByOrder } from "./books";
import type { TranslationId } from "./translations";

export interface BibleSearchHit extends KjvSearchHit {
  translation: TranslationId;
}

export interface BibleSearchResult {
  hits: BibleSearchHit[];
  translation: TranslationId;
}

export const BIBLE_SEARCH_ERROR = "Search could not finish. Check your connection and try again.";

/** Bolls search returns HTML highlights and translator-supplied italics. */
function plainText(text: string): string {
  return text.replace(/<[^>]*>/g, "")
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, (entity) => ({
      "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&nbsp;": " ",
    })[entity] ?? entity)
    .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (entity, code: string) => {
      const point = code.toLowerCase().startsWith("x") ? parseInt(code.slice(1), 16) : Number(code);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    }).replace(/\s+/g, " ").trim();
}

async function searchTranslation(query: string, translation: TranslationId, limit: number, signal?: AbortSignal): Promise<BibleSearchHit[]> {
  if (signal?.aborted) throw new Error(BIBLE_SEARCH_ERROR);
  if (translation === "KJV") {
    return (await searchKjv(query, limit)).map((hit) => ({ ...hit, translation }));
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 15000);
  try {
    // Explicit lexical matching: the provider's default is semantic search.
    const params = new URLSearchParams({ search: query, match_whole: "true", limit: String(limit), page: "1" });
    const response = await fetch(`https://bolls.life/v2/find/NKJV?${params}`, { signal: controller.signal });
    if (!response.ok) throw new Error(BIBLE_SEARCH_ERROR);
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || !("results" in data) || !Array.isArray(data.results)) {
      throw new Error(BIBLE_SEARCH_ERROR);
    }
    return data.results.slice(0, limit).map((row: unknown) => {
      if (!row || typeof row !== "object") throw new Error(BIBLE_SEARCH_ERROR);
      const value = row as Record<string, unknown>;
      const { book, chapter, verse, text } = value;
      const metadata = typeof book === "number" ? bookByOrder(book) : undefined;
      if (value.translation !== "NKJV" || !metadata || !Number.isInteger(chapter) ||
        typeof chapter !== "number" || chapter < 1 || chapter > metadata.chapters ||
        !Number.isInteger(verse) || typeof verse !== "number" || verse < 1 || typeof text !== "string") {
        throw new Error(BIBLE_SEARCH_ERROR);
      }
      return { order: metadata.order, chapter, verse, text: plainText(text), translation };
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

/** Keep KJV available offline; check the other supported translation on a miss. */
export async function searchBible(query: string, translation: TranslationId, limit = 100, signal?: AbortSignal): Promise<BibleSearchResult> {
  const normalized = query.trim().replace(/\s+/g, " ");
  if (normalized.length < 2) return { hits: [], translation };
  const cap = Math.max(1, Math.min(100, Math.floor(limit) || 100));
  const hits = await searchTranslation(normalized, translation, cap, signal);
  if (hits.length) return { hits, translation };
  const alternate = translation === "KJV" ? "NKJV" : "KJV";
  return { hits: await searchTranslation(normalized, alternate, cap, signal), translation: alternate };
}

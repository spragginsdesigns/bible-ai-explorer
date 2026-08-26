/**
 * Turning an authored atlas reference ("Genesis 22:9-13") into a link into the
 * Bible reader. The parser has no imports and the atlas data is not touched, so
 * this costs the browser bundle nothing but `books.json`, which the reader
 * already ships. Android does the same job in `openLocationFor`.
 */
import { parseAtlasRef } from "@/lib/bible/atlas-core";
import { BOOKS } from "@/lib/bible/books";

/** `/bible/chapter?book=1&chapter=22&verse=9`, or null if it cannot be parsed. */
export function readerHrefFor(reference: string): string | null {
  const ref = parseAtlasRef(BOOKS, reference);
  if (!ref) return null;
  const verse = ref.verse ? `&verse=${ref.verse}` : "";
  return `/bible/chapter?book=${ref.order}&chapter=${ref.chapter}${verse}`;
}

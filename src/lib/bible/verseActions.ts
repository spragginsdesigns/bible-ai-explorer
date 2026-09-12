/**
 * Verse action helpers for the Bible reader: the copy/share plain-text format
 * and save-to-note flow. Ported from mobile/src/features/chat/verseActions.ts,
 * using the web app's same-origin /api/notes endpoints (Clerk session cookie).
 */
import type { TranslationId } from "./translations";

export interface VerseRef {
  reference: string;
  text?: string;
  /** Translation that produced this text; absent on legacy/history rows. */
  translation?: TranslationId;
}

/** Resolve an action's explicit translation before the source's provenance. */
export function sourceTranslation(
  verse: VerseRef,
  translation?: TranslationId | string,
): string | undefined {
  const explicit = typeof translation === "string" ? translation.trim() : "";
  return explicit || verse.translation;
}

/** "John 3:16 — \"For God so loved...\" (translation)" plain-text form. */
export function formatVerseForSharing(
  verse: VerseRef,
  translation?: TranslationId | string
): string {
  const body = verse.text?.trim();
  const label = sourceTranslation(verse, translation);
  const suffix = label ? ` (${label})` : "";
  return body
    ? `${verse.reference} — "${body}"${suffix}`
    : `${verse.reference}${suffix}`;
}

/**
 * Save a verse to the notes library: creates a note titled by the reference
 * with the passage as a Scripture blockquote (HTML, so it round-trips with the
 * web/mobile rich text editors). Returns the new note id.
 */
export async function saveVerseToNote(
  verse: VerseRef,
  translation?: TranslationId | string
): Promise<string> {
  const text = verse.text?.trim() ?? "";
  const label = sourceTranslation(verse, translation);
  const htmlContent =
    `<blockquote><p><strong>${escapeHtml(verse.reference)}</strong></p>` +
    (text ? `<p>${escapeHtml(text)}</p>` : "") +
    (label ? `<p>(${escapeHtml(label)})</p>` : "") +
    "</blockquote>";
  const plainText = formatVerseForSharing(verse, translation);
  const wordCount = plainText.split(/\s+/).filter(Boolean).length;

  const createRes = await fetch("/api/notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: verse.reference, folderId: null }),
  });
  if (!createRes.ok) throw new Error("Failed to create note");
  const note: { id: string } = await createRes.json();

  try {
    const patchRes = await fetch(`/api/notes/${note.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ htmlContent, plainText, wordCount }),
    });
    if (!patchRes.ok) throw new Error("Failed to save note content");
  } catch (error) {
    // Best-effort cleanup: without the content PATCH the note is an empty
    // orphan titled by the reference, so remove it before reporting failure.
    try {
      await fetch(`/api/notes/${note.id}`, { method: "DELETE" });
    } catch {
      // Keep the original failure.
    }
    throw error;
  }
  return note.id;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

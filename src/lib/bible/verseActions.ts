/**
 * Verse action helpers for the Bible reader: the copy/share plain-text format
 * and save-to-note flow. Ported from mobile/src/features/chat/verseActions.ts,
 * using the web app's same-origin /api/notes endpoints (Clerk session cookie).
 */
import type { TranslationId } from "./translations";

export interface VerseRef {
  reference: string;
  text?: string;
}

/** "John 3:16 — \"For God so loved...\" (KJV)" plain-text form for copy/share. */
export function formatVerseForSharing(
  verse: VerseRef,
  translation: TranslationId | string = "KJV"
): string {
  const body = verse.text?.trim();
  return body
    ? `${verse.reference} — "${body}" (${translation})`
    : `${verse.reference} (${translation})`;
}

/**
 * Save a verse to the notes library: creates a note titled by the reference
 * with the passage as a Scripture blockquote (HTML, so it round-trips with the
 * web/mobile rich text editors). Returns the new note id.
 */
export async function saveVerseToNote(
  verse: VerseRef,
  translation: TranslationId | string = "KJV"
): Promise<string> {
  const text = verse.text?.trim() ?? "";
  const htmlContent =
    `<blockquote><p><strong>${escapeHtml(verse.reference)}</strong></p>` +
    (text ? `<p>${escapeHtml(text)}</p>` : "") +
    `<p>(${escapeHtml(String(translation))})</p>` +
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

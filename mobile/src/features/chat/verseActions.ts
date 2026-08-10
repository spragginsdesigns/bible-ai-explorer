import { Share } from "react-native";
import * as Clipboard from "expo-clipboard";
import type { GetToken } from "@/lib/api";
import type { RetrievedVerse } from "@/lib/chatView";
import { createNote, patchNote } from "@/features/notes/api";

/** "John 3:16 — \"For God so loved...\" (KJV)" plain-text form for copy/share. */
export function formatVerseForSharing(verse: Pick<RetrievedVerse, "reference" | "text">): string {
	const body = verse.text?.trim();
	return body ? `${verse.reference} — "${body}" (KJV)` : `${verse.reference} (KJV)`;
}

export async function copyVerse(verse: Pick<RetrievedVerse, "reference" | "text">): Promise<void> {
	await Clipboard.setStringAsync(formatVerseForSharing(verse));
}

export async function shareVerse(verse: Pick<RetrievedVerse, "reference" | "text">): Promise<void> {
	await Share.share({ message: formatVerseForSharing(verse) });
}

/**
 * Save a verse to the notes library: creates a note titled by the reference
 * with the passage as a Scripture blockquote (HTML, so it round-trips with the
 * web/mobile rich text editors). Returns the new note id.
 */
export async function saveVerseToNote(
	getToken: GetToken,
	verse: Pick<RetrievedVerse, "reference" | "text">
): Promise<string> {
	const text = verse.text?.trim() ?? "";
	const htmlContent =
		`<blockquote><p><strong>${escapeHtml(verse.reference)}</strong></p>` +
		(text ? `<p>${escapeHtml(text)}</p>` : "") +
		"</blockquote>";
	const plainText = formatVerseForSharing(verse);
	const wordCount = plainText.split(/\s+/).filter(Boolean).length;

	const note = await createNote(getToken, { title: verse.reference, folderId: null });
	await patchNote(getToken, note.id, { htmlContent, plainText, wordCount });
	return note.id;
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

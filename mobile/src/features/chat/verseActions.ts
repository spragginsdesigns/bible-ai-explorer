import { Share } from "react-native";
import * as Clipboard from "expo-clipboard";
import type { GetToken } from "@/lib/api";
import type { RetrievedVerse } from "@/lib/chatView";
import type { TranslationId } from "@/features/bible/translations";
import { createNote, deleteNote, patchNote } from "@/features/notes/api";

type VerseActionSource = Pick<RetrievedVerse, "reference" | "text"> & {
	translation?: TranslationId;
};

/** Parse a route value without allowing an arbitrary string to change reader state. */
export function parseTranslationId(value: unknown): TranslationId | null {
	return value === "KJV" || value === "NKJV" ? value : null;
}

/** A source-card translation wins only for that reader route, never globally. */
export function readerTranslation(
	accountTranslation: TranslationId,
	sourceTranslation: unknown,
): TranslationId {
	return parseTranslationId(sourceTranslation) ?? accountTranslation;
}

/** Build the chapter route for a retrieved source while preserving legacy routes. */
export function readerRouteParams(
	target: { order: number; chapter: number; verse?: number },
	translation?: TranslationId,
): { book: string; chapter: string; verse?: string; translation?: TranslationId } {
	return {
		book: String(target.order),
		chapter: String(target.chapter),
		...(target.verse ? { verse: String(target.verse) } : {}),
		...(translation ? { translation } : {}),
	};
}

/** "John 3:16 — \"For God so loved...\" (KJV)" plain-text form for copy/share. */
export function formatVerseForSharing(
	verse: VerseActionSource,
	translation?: TranslationId
): string {
	const body = verse.text?.trim();
	const label = translation ?? verse.translation;
	const suffix = label ? ` (${label})` : "";
	return body ? `${verse.reference} — "${body}"${suffix}` : `${verse.reference}${suffix}`;
}

/** The narrowly-scoped source attribution carried by a Daily Cross CTA. */
export interface VerseAttachmentOrigin {
	surface: "daily-cross";
	verseOfDayId: string;
	reference: string;
	action: "go-deeper";
}

/** A verse or whole chapter the user attached to their next chat question. */
export interface VerseAttachment {
	reference: string;
	text: string;
	translation: TranslationId;
	origin?: VerseAttachmentOrigin;
}

/**
 * Compose the outgoing user message for /api/ask-question: the formatted
 * passage first, then the user's own question. No canned prompt — when the
 * question is empty the passage goes out on its own.
 */
export function composeMessageWithAttachment(
	question: string,
	attachment: VerseAttachment | null
): string {
	const trimmed = question.trim();
	if (!attachment) return trimmed;
	const verseBlock = formatVerseForSharing(attachment, attachment.translation);
	return trimmed ? `${verseBlock}\n\n${trimmed}` : verseBlock;
}

export async function copyVerse(verse: VerseActionSource, translation?: TranslationId): Promise<void> {
	await Clipboard.setStringAsync(formatVerseForSharing(verse, translation));
}

export async function shareVerse(verse: VerseActionSource, translation?: TranslationId): Promise<void> {
	await Share.share({ message: formatVerseForSharing(verse, translation) });
}

/**
 * Save a verse to the notes library: creates a note titled by the reference
 * with the passage as a Scripture blockquote (HTML, so it round-trips with the
 * web/mobile rich text editors). Returns the new note id.
 */
export async function saveVerseToNote(
	getToken: GetToken,
	verse: VerseActionSource,
	translation?: TranslationId
): Promise<string> {
	const text = verse.text?.trim() ?? "";
	const label = translation ?? verse.translation;
	const translationParagraph = label ? `<p>(${escapeHtml(label)})</p>` : "";
	const htmlContent =
		`<blockquote><p><strong>${escapeHtml(verse.reference)}</strong></p>` +
		(text ? `<p>${escapeHtml(text)}</p>` : "") +
		translationParagraph +
		"</blockquote>";
	const plainText = formatVerseForSharing(verse, translation);
	const wordCount = plainText.split(/\s+/).filter(Boolean).length;

	const note = await createNote(getToken, { title: verse.reference, folderId: null });
	try {
		await patchNote(getToken, note.id, { htmlContent, plainText, wordCount });
	} catch (error) {
		// Best-effort cleanup: without the content PATCH the note is an empty
		// orphan titled by the reference, so remove it before reporting failure.
		try {
			await deleteNote(getToken, note.id);
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

/**
 * Chat-side verse actions, ported from mobile/src/features/chat/verseActions.ts:
 * the attachment pill model, the outgoing-message composer, copy/share, and the
 * deep link into the Bible reader. The reference parser, share format and
 * save-to-note flow live in the shared reader lib (src/lib/bible) and are
 * re-exported here so chat code has a single import point.
 */
import { resolveReference } from "@/lib/bible/books";
import type { TranslationId } from "@/lib/bible/translations";
import {
	formatVerseForSharing,
	saveVerseToNote,
} from "@/lib/bible/verseActions";
import type { RetrievedVerse } from "@/components/useChat";
import type { DailyCrossMessageOrigin } from "@/lib/chat-attachment-types";
import { stripTranslationTag } from "@/utils/verseParser";

export { formatVerseForSharing, saveVerseToNote, resolveReference };

/** A verse or whole chapter the user attached to their next chat question. */
export interface VerseAttachment {
	reference: string;
	text: string;
	translation: TranslationId;
	origin?: DailyCrossMessageOrigin;
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

export async function copyVerse(
	verse: Pick<RetrievedVerse, "reference" | "text">
): Promise<void> {
	await navigator.clipboard.writeText(formatVerseForSharing(verse));
}

/** System share sheet where available, clipboard copy otherwise. */
export async function shareVerse(
	verse: Pick<RetrievedVerse, "reference" | "text">
): Promise<void> {
	const text = formatVerseForSharing(verse);
	if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
		await navigator.share({ text });
		return;
	}
	await navigator.clipboard.writeText(text);
}

/**
 * Deep link into the Bible reader for a "John 3:16"-style reference, e.g.
 * "/bible/chapter?book=43&chapter=3&verse=16". Returns null when the
 * reference cannot be resolved (the caller hides the Read chip).
 */
export function chapterHrefForReference(reference: string): string | null {
	// verseParser may capture a trailing translation tag ("John 3:16 KJV");
	// strip it before resolving or the anchored pattern fails to match. The
	// tag list lives in verseParser, which is what captured the tag - a second
	// copy here is a list that silently drifts out of step with the parser.
	const target = resolveReference(stripTranslationTag(reference));
	if (!target) return null;
	const params = new URLSearchParams({
		book: String(target.order),
		chapter: String(target.chapter),
	});
	if (target.verse) params.set("verse", String(target.verse));
	return `/bible/chapter?${params.toString()}`;
}

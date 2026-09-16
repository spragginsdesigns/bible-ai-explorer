/**
 * The snapshot rules behind "Share an answer" (docs/FEATURES.md, "Share an
 * answer: a public page, and a card image").
 *
 * Everything here is pure and dependency-free apart from `node:crypto`, so
 * tests/shared-answer.test.mjs can import it directly through Node's type
 * stripper. Nothing in this module reads the database: the routes hand it the
 * stored row or the assistant message's metadata and it decides what the
 * public snapshot is allowed to contain.
 *
 * The follow-up markers are stripped by `stripFollowUpMarkers` in
 * src/utils/assistantMarkdown.ts at the call site rather than here - that
 * module is the one place the web, Android and server all share, and
 * duplicating its line-scoped rules would be how the two copies drift.
 */
import { randomBytes } from "node:crypto";

/** Public origin every share link is minted against. */
export const SHARED_ANSWER_ORIGIN = "https://sureword.app";

/**
 * The id is the capability: anyone holding it can read the answer, so it is
 * random rather than derived from the message id. 12 random bytes encode to
 * exactly 16 base64url characters with no padding.
 */
export const SHARED_ANSWER_ID_BYTES = 12;
export const SHARED_ANSWER_ID_LENGTH = 16;

/** `SharedAnswer.question` is VarChar(500); the clip is what keeps it insertable. */
export const MAX_SHARED_QUESTION_LENGTH = 500;
/** The answer column is Text, so this cap is a product decision, not a DB one. */
export const MAX_SHARED_ANSWER_LENGTH = 6000;
/** Chips past this add nothing and wrap the page on a phone. */
export const MAX_SHARED_REFERENCES = 12;
/** A reference longer than this is not a reference; it is a stray string. */
const MAX_REFERENCE_LENGTH = 60;

/** Unfurl title length - past this every client truncates for us, badly. */
export const SHARED_TITLE_LENGTH = 70;
/** Unfurl description length, the shortest common limit across the platforms. */
export const SHARED_DESCRIPTION_LENGTH = 160;
/** How much of the answer the 1200x630 card can hold at a readable size. */
export const SHARED_CARD_EXCERPT_LENGTH = 200;

const ELLIPSIS = "…";

/** Shown when the snapshot has no usable question (an answer with no prompt). */
export const SHARED_ANSWER_FALLBACK_TITLE = "An answer from SureWord";

const SHARED_ANSWER_ID_PATTERN = /^[A-Za-z0-9_-]{16}$/;

/** Mint a new share id. Never derived from the message id. */
export function createSharedAnswerId(): string {
	return randomBytes(SHARED_ANSWER_ID_BYTES).toString("base64url");
}

/**
 * Whether a path segment could be one of our ids. Checked before the query so
 * a hand-typed `/shared/../../etc` is a 404 without touching the database.
 */
export function isSharedAnswerId(value: unknown): value is string {
	return typeof value === "string" && SHARED_ANSWER_ID_PATTERN.test(value);
}

/** The link a user hands someone. */
export function sharedAnswerUrl(id: string, origin: string = SHARED_ANSWER_ORIGIN): string {
	return `${origin}/shared/${id}`;
}

/** The unfurl card. Absolute, because every scraper resolves it off-site. */
export function sharedAnswerCardUrl(id: string, origin: string = SHARED_ANSWER_ORIGIN): string {
	return `${origin}/api/shared/${id}/image`;
}

/**
 * Clip to a hard character budget, preferring the last word boundary so the
 * cut does not land mid-word. The ellipsis is counted inside the budget, so
 * the result is never longer than `max`.
 */
export function clipText(text: string, max: number): string {
	const trimmed = text.trim();
	if (max <= 0) return "";
	if (trimmed.length <= max) return trimmed;
	const head = trimmed.slice(0, max - 1);
	const lastSpace = head.lastIndexOf(" ");
	// Only back off to a word boundary when one sits in the last third; a long
	// unbroken token would otherwise collapse the clip to almost nothing.
	const body = lastSpace > Math.floor(max / 3) ? head.slice(0, lastSpace) : head;
	return `${body.trimEnd()}${ELLIPSIS}`;
}

/** The user's prompt, collapsed to one line and clipped to the column width. */
export function shareQuestion(text: string): string {
	return clipText(text.replace(/\s+/g, " "), MAX_SHARED_QUESTION_LENGTH);
}

/**
 * The answer snapshot. Newlines are preserved - this is markdown the page
 * re-renders - so only the length is enforced here.
 */
export function shareAnswer(text: string): string {
	const normalized = text.replace(/\r\n?/g, "\n").trim();
	if (normalized.length <= MAX_SHARED_ANSWER_LENGTH) return normalized;
	return clipText(normalized, MAX_SHARED_ANSWER_LENGTH);
}

/** The `<title>` and unfurl title. */
export function shareTitle(question: string): string {
	const clipped = clipText(question.replace(/\s+/g, " "), SHARED_TITLE_LENGTH);
	return clipped || SHARED_ANSWER_FALLBACK_TITLE;
}

/** The unfurl description: prose, never markdown syntax. */
export function shareDescription(answer: string): string {
	return clipText(plainTextFromMarkdown(answer), SHARED_DESCRIPTION_LENGTH);
}

/** The answer excerpt printed on the card image. */
export function shareCardExcerpt(answer: string): string {
	return clipText(plainTextFromMarkdown(answer), SHARED_CARD_EXCERPT_LENGTH);
}

/**
 * Flatten assistant markdown to the prose underneath it.
 *
 * Only used where markdown cannot render: the meta description and the card
 * image. The page itself renders the real markdown through the chat renderer,
 * so this never has to be faithful - only readable and free of syntax noise.
 */
export function plainTextFromMarkdown(markdown: string): string {
	return (
		markdown
			.replace(/\r\n?/g, "\n")
			// Fenced blocks carry no prose worth putting in a preview.
			.replace(/```[\s\S]*?```/g, " ")
			.replace(/~~~[\s\S]*?~~~/g, " ")
			// Images first: an image is a link with a leading "!", so dropping it
			// afterwards would leave the alt text floating as a sentence.
			.replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
			.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
			.replace(/^\s{0,3}>+\s?/gm, "")
			.replace(/^\s{0,3}#{1,6}\s+/gm, "")
			.replace(/^\s{0,3}(?:[-*+]|\d+[.)])\s+/gm, "")
			.replace(/^\s{0,3}(?:[-*_]\s*){3,}$/gm, " ")
			.replace(/`([^`]*)`/g, "$1")
			.replace(/(\*\*|__|\*|_|~~)/g, "")
			.replace(/\s+/g, " ")
			.trim()
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pushReference(into: string[], candidate: unknown): void {
	if (typeof candidate !== "string") return;
	const reference = candidate.trim();
	if (!reference || reference.length > MAX_REFERENCE_LENGTH) return;
	if (into.includes(reference)) return;
	into.push(reference);
}

function collectFromVerses(into: string[], verses: unknown): void {
	if (!Array.isArray(verses)) return;
	for (const verse of verses) {
		if (isRecord(verse)) pushReference(into, verse.reference);
	}
}

/**
 * The reference chips, read out of the assistant row's stored metadata.
 *
 * Two shapes exist side by side and both still appear in production rows:
 * `metadata.retrievedVerses` on turns written before tool calls were
 * persisted, and `metadata.parts[].output.verses` on every turn since
 * (`persistableParts` in src/lib/ai/status-narration.ts). Order is the order
 * the answer used them, deduplicated, so the chips read the way the answer does.
 */
export function extractReferences(metadata: unknown): string[] {
	const references: string[] = [];
	if (!isRecord(metadata)) return references;

	collectFromVerses(references, metadata.retrievedVerses);

	const parts = metadata.parts;
	if (Array.isArray(parts)) {
		for (const part of parts) {
			if (!isRecord(part)) continue;
			const output = part.output;
			if (isRecord(output)) collectFromVerses(references, output.verses);
		}
	}

	return references.slice(0, MAX_SHARED_REFERENCES);
}

/**
 * The translation label for the snapshot. A turn's metadata does not carry
 * one today, so the account's current setting is the fallback; the literal is
 * the last resort, matching the column default.
 */
export function shareTranslation(metadata: unknown, userTranslation: string | null | undefined): string {
	if (isRecord(metadata) && typeof metadata.translation === "string" && metadata.translation.trim()) {
		return metadata.translation.trim();
	}
	if (typeof userTranslation === "string" && userTranslation.trim()) return userTranslation.trim();
	return "KJV";
}

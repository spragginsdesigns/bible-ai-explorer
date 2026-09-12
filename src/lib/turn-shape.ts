import type { Verbosity } from "@/lib/ai/models";
import { questionReference } from "@/utils/questionPresentation";
import { parseVerseReferences } from "@/utils/verseParser";

/**
 * Conversational turn shape: a short follow-up gets a short answer.
 *
 * The obvious lever, the `verbosity` run option, is dead for the house access
 * path (41 of 44 accounts): `resolveModel` returns `verbosity: null` and no
 * prompt hints there by design. So the shape has to reach the model as a
 * sentence in the uncached half of the system prompt, which every provider
 * and every access path actually reads.
 *
 * Keyed on conversation position plus the absence of a named passage, never on
 * length alone: a short but deep opening question ("is Christ eternally
 * begotten?") must still get the full study, and "what about Romans 9?" is a new
 * passage, not a follow-up.
 */

/** Longest user message still treated as a quick follow-up. */
export const SHORT_FOLLOW_UP_MAX_CHARS = 120;

export const SHORT_FOLLOW_UP_HINT =
	"This is a short follow-up in an ongoing conversation. Answer in one to three short conversational paragraphs, no headings, no lists, and no recap of what was already said, unless the user asks for more.";

/** Recorded on the assistant message as `metadata.turnShape` when the hint shaped it. */
export type TurnShape = "short";

export interface TurnShapeMessage {
	role: string;
	parts: readonly unknown[];
	metadata?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function textOf(message: TurnShapeMessage): string {
	return message.parts
		.map((part) => (isRecord(part) && part.type === "text" && typeof part.text === "string" ? part.text : ""))
		.join("")
		.trim();
}

/**
 * An attachment or a Daily Cross hand-off is new material even when the typed
 * words are few ("what's this?" under a PDF), so it is never a quick follow-up.
 */
function carriesNewMaterial(message: TurnShapeMessage): boolean {
	if (message.parts.some((part) => isRecord(part) && part.type === "file")) return true;
	if (!isRecord(message.metadata)) return false;
	const ids = message.metadata.attachmentIds;
	if (Array.isArray(ids) && ids.length > 0) return true;
	return message.metadata.origin !== undefined && message.metadata.origin !== null;
}

/**
 * Two existing parsers, because each covers what the other misses:
 * `questionReference` catches chapter-only references by full book name
 * ("Romans 9"), and the chat link parser catches abbreviations with a verse
 * ("Rom 8:28", "Ps. 23:1") and validates them against the real canon.
 */
function namesScripture(text: string): boolean {
	if (questionReference(text) !== null) return true;
	return parseVerseReferences(text).some((segment) => segment.type === "verse-ref");
}

/**
 * The prompt sentence for this turn, or null when the turn should keep the
 * model's ordinary shape. `verbosity` is whatever the user chose in the picker
 * (requested or stored); any explicit choice wins over the hint.
 */
export function turnShapeHint(
	messages: readonly TurnShapeMessage[],
	options: { verbosity?: Verbosity | null } = {},
): string | null {
	if (options.verbosity) return null;

	const lastUserIndex = messages.findLastIndex((message) => message.role === "user");
	if (lastUserIndex < 0) return null;
	const earlier = messages.slice(0, lastUserIndex);
	// Same rule as the route's isOpeningQuestion: one user message means this
	// is the opening question, which always gets the full answer.
	if (!earlier.some((message) => message.role === "user")) return null;
	// A retry after a failed first answer has a prior user turn but nothing to
	// follow up on yet.
	if (!earlier.some((message) => message.role === "assistant" && textOf(message))) return null;

	const last = messages[lastUserIndex];
	if (carriesNewMaterial(last)) return null;
	const text = textOf(last);
	if (!text || text.length >= SHORT_FOLLOW_UP_MAX_CHARS) return null;
	// Slash commands carry their own reply shapes ("/search" lists verses).
	if (text.startsWith("/")) return null;
	if (namesScripture(text)) return null;
	return SHORT_FOLLOW_UP_HINT;
}

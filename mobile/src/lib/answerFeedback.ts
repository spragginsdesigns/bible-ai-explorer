import { apiJson, type GetToken } from "@/lib/api";
import { stripFollowUpMarkers } from "@/lib/assistantMarkdown";

/**
 * The user's own thumb on one settled assistant answer (docs/FEATURES.md,
 * "Answer feedback, and how it reaches the doctrinal eval harness"). It lives
 * in its own `Message` columns server-side, never in `metadata`, because the
 * ask-question persist replaces `metadata` wholesale on a retry.
 */
export type AnswerFeedback = "up" | "down";

/** The server answers 400 above this; the input stops the user well before. */
export const FEEDBACK_REASON_MAX_LENGTH = 500;

/**
 * The reason chips under a thumbs down. Mirror of `FEEDBACK_TAGS` in
 * `src/lib/chat/answer-feedback.ts`, which is the contract: the id is what goes
 * on the wire, the label is what this client shows, and the order is the order
 * they appear in. There is no package shared across the three trees, so
 * `tests/answer-feedback.test.mjs` pins this copy to the server's list by
 * grepping for each id and label as a double-quoted literal.
 */
export const FEEDBACK_TAGS = [
	{ id: "not-kjv", label: "Not KJV" },
	{ id: "doctrine", label: "Doctrinally off" },
	{ id: "missed-question", label: "Missed my question" },
	{ id: "wrong-verse", label: "Wrong or missing verse" },
	{ id: "too-long", label: "Too long" },
] as const;

export type FeedbackTagId = (typeof FEEDBACK_TAGS)[number]["id"];

/** Shape of PATCH /api/conversations/[id]/messages/[messageId]. */
export interface AnswerFeedbackResponse {
	id: string;
	feedback: AnswerFeedback | null;
	feedbackReason: string | null;
	feedbackTags: string[];
	feedbackAt: string | null;
}

/** Rate an answer, or clear the rating with `null`. Shared by every caller. */
export type SetAnswerFeedback = (
	messageId: string,
	feedback: AnswerFeedback | null,
	reason?: string,
	tags?: readonly FeedbackTagId[],
) => void;

/**
 * The answer as the user would paste it: their own markdown, minus the
 * [FOLLOWUP] marker lines that are instructions to the client rather than part
 * of the answer. Streaming is false because only a settled answer is copyable.
 *
 * It lives here rather than beside `stripFollowUpMarkers` because
 * `assistantMarkdown.ts` is held byte-identical to the web copy below its
 * header (`tests/assistant-markdown.test.mjs`), so a mobile-only export there
 * would be a divergence.
 */
export function copyableAnswerText(content: string): string {
	return stripFollowUpMarkers(content, { streaming: false }).trim();
}

/**
 * Tapping the thumb that is already chosen clears it; every other tap chooses
 * the one that was tapped. The whole toggle rule, kept pure so the optimistic
 * update and its revert can be reasoned about without a render.
 */
export function nextFeedback(
	current: AnswerFeedback | null | undefined,
	tapped: AnswerFeedback,
): AnswerFeedback | null {
	return current === tapped ? null : tapped;
}

/** Narrow an unknown (a DB row column, a metadata value) to a thumb. */
export function parseAnswerFeedback(value: unknown): AnswerFeedback | null {
	return value === "up" || value === "down" ? value : null;
}

/**
 * Persist the thumb. A reason and its chips only mean anything alongside
 * `"down"`, so they are dropped otherwise rather than sent for the server to
 * ignore. An empty chip list is omitted too: the server treats an absent field
 * and an empty array the same, and omitting it keeps the body honest about
 * what the user actually chose.
 */
export function setMessageFeedback(
	getToken: GetToken,
	conversationId: string,
	messageId: string,
	feedback: AnswerFeedback | null,
	reason?: string,
	tags?: readonly FeedbackTagId[],
): Promise<AnswerFeedbackResponse> {
	const trimmed = reason?.trim();
	const feedbackReason =
		feedback === "down" && trimmed ? trimmed.slice(0, FEEDBACK_REASON_MAX_LENGTH) : undefined;
	const feedbackTags =
		feedback === "down" && tags && tags.length > 0 ? [...tags] : undefined;
	return apiJson<AnswerFeedbackResponse>(
		getToken,
		`/api/conversations/${conversationId}/messages/${messageId}`,
		{
			method: "PATCH",
			body: {
				feedback,
				...(feedbackReason === undefined ? {} : { feedbackReason }),
				...(feedbackTags === undefined ? {} : { feedbackTags }),
			},
		},
	);
}

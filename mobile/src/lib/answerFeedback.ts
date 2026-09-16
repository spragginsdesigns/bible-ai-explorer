import { apiJson, type GetToken } from "@/lib/api";

/**
 * The user's own thumb on one settled assistant answer (docs/FEATURES.md,
 * "Answer feedback, and how it reaches the doctrinal eval harness"). It lives
 * in its own `Message` columns server-side, never in `metadata`, because the
 * ask-question persist replaces `metadata` wholesale on a retry.
 */
export type AnswerFeedback = "up" | "down";

/** The server answers 400 above this; the input stops the user well before. */
export const FEEDBACK_REASON_MAX_LENGTH = 500;

/** Shape of PATCH /api/conversations/[id]/messages/[messageId]. */
export interface AnswerFeedbackResponse {
	id: string;
	feedback: AnswerFeedback | null;
	feedbackReason: string | null;
	feedbackAt: string | null;
}

/** Rate an answer, or clear the rating with `null`. Shared by every caller. */
export type SetAnswerFeedback = (
	messageId: string,
	feedback: AnswerFeedback | null,
	reason?: string,
) => void;

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
 * Persist the thumb. A reason only means anything alongside `"down"`, so it is
 * dropped otherwise rather than sent for the server to ignore.
 */
export function setMessageFeedback(
	getToken: GetToken,
	conversationId: string,
	messageId: string,
	feedback: AnswerFeedback | null,
	reason?: string,
): Promise<AnswerFeedbackResponse> {
	const trimmed = reason?.trim();
	const feedbackReason =
		feedback === "down" && trimmed ? trimmed.slice(0, FEEDBACK_REASON_MAX_LENGTH) : undefined;
	return apiJson<AnswerFeedbackResponse>(
		getToken,
		`/api/conversations/${conversationId}/messages/${messageId}`,
		{
			method: "PATCH",
			body: {
				feedback,
				...(feedbackReason === undefined ? {} : { feedbackReason }),
			},
		},
	);
}

/**
 * Answer feedback, browser half (docs/FEATURES.md, "Answer feedback, and how
 * it reaches the doctrinal eval harness").
 *
 * A thumb is one human judgment about one answer, stored beside the answer on
 * the `Message` row. This module is the only place the web client talks to the
 * rating route, and it holds no React so the rules stay testable on their own.
 */

/** The two judgments a reader can record. `null` everywhere means "cleared". */
export type AnswerFeedback = "up" | "down";

/** Matches the `feedbackReason` column's limit; the route 400s above it. */
export const FEEDBACK_REASON_MAX_LENGTH = 500;

/** The rating as the route reports it back after a write. */
export interface AnswerFeedbackState {
	feedback: AnswerFeedback | null;
	feedbackReason: string | null;
	feedbackAt: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function asFeedback(value: unknown): AnswerFeedback | null {
	return value === "up" || value === "down" ? value : null;
}

function asText(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

/**
 * Record, change, or clear the reader's thumb on one assistant answer.
 *
 * A reason only ever travels with `"down"`: the column is meaningless
 * otherwise and the route ignores it, so sending it would only invite a
 * confusing round-trip. The reason is trimmed and dropped when empty, which is
 * what "Skip" amounts to.
 */
export async function setAnswerFeedback(
	conversationId: string,
	messageId: string,
	feedback: AnswerFeedback | null,
	reason?: string
): Promise<AnswerFeedbackState> {
	const trimmedReason = feedback === "down" ? (reason ?? "").trim() : "";
	const response = await fetch(
		`/api/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`,
		{
			method: "PATCH",
			credentials: "same-origin",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				feedback,
				...(trimmedReason ? { feedbackReason: trimmedReason.slice(0, FEEDBACK_REASON_MAX_LENGTH) } : {}),
			}),
		}
	);

	const body: unknown = await response.json().catch(() => null);
	if (!response.ok) {
		const message = isRecord(body) && typeof body.error === "string" ? body.error : null;
		throw new Error(message ?? `Could not save that rating (${response.status}).`);
	}

	// A route that answered 200 without echoing the row is still a success; the
	// value the caller asked for is the honest thing to show.
	if (!isRecord(body)) {
		return { feedback, feedbackReason: trimmedReason || null, feedbackAt: null };
	}
	return {
		feedback: asFeedback(body.feedback),
		feedbackReason: asText(body.feedbackReason),
		feedbackAt: asText(body.feedbackAt),
	};
}

/**
 * Pull the ratings out of a conversation-history payload, so reopening a chat
 * replays the thumb the reader already chose. Rows without one are simply
 * absent from the map.
 */
export function feedbackByMessageId(rows: unknown): Record<string, AnswerFeedback> {
	if (!Array.isArray(rows)) return {};
	const ratings: Record<string, AnswerFeedback> = {};
	for (const row of rows) {
		if (!isRecord(row) || typeof row.id !== "string") continue;
		const feedback = asFeedback(row.feedback);
		if (feedback) ratings[row.id] = feedback;
	}
	return ratings;
}

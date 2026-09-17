/**
 * Answer feedback, browser half (docs/FEATURES.md, "Answer feedback, and how
 * it reaches the doctrinal eval harness").
 *
 * A thumb is one human judgment about one answer, stored beside the answer on
 * the `Message` row. This module is the only place the web client talks to the
 * rating route, and it holds no React so the rules stay testable on their own.
 */

import { FEEDBACK_TAGS, type FeedbackTagId } from "./answer-feedback";
import { stripFollowUpMarkers } from "@/utils/assistantMarkdown";

/** The two judgments a reader can record. `null` everywhere means "cleared". */
export type AnswerFeedback = "up" | "down";

/** Matches the `feedbackReason` column's limit; the route 400s above it. */
export const FEEDBACK_REASON_MAX_LENGTH = 500;

/** The rating as the route reports it back after a write. */
export interface AnswerFeedbackState {
	feedback: AnswerFeedback | null;
	feedbackReason: string | null;
	feedbackTags: FeedbackTagId[];
	feedbackAt: string | null;
}

/** What a thumbs down carries beyond the judgment itself. */
export interface AnswerFeedbackDetails {
	reason?: string;
	tags?: readonly FeedbackTagId[];
}

const FEEDBACK_TAG_IDS: ReadonlySet<string> = new Set(FEEDBACK_TAGS.map((tag) => tag.id));

/**
 * The answer as the reader would paste it: their own markdown, minus the
 * [FOLLOWUP] marker lines, which are instructions to the client rather than
 * part of the answer. Streaming is false because only a settled answer offers
 * a Copy action.
 *
 * It lives here rather than beside `stripFollowUpMarkers` because
 * `src/utils/assistantMarkdown.ts` is held byte-identical to the Android copy
 * below its header (`tests/assistant-markdown.test.mjs`), so a web-only export
 * there would be a divergence. `mobile/src/lib/answerFeedback.ts` keeps its
 * twin of this function for exactly the same reason.
 */
export function copyableAnswerText(content: string): string {
	return stripFollowUpMarkers(content, { streaming: false }).trim();
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
 * Chips this build understands, in the order given. An id from a newer server
 * is dropped rather than thrown: an unknown chip should cost the reader a chip,
 * never the rating it belongs to.
 */
function asTags(value: unknown): FeedbackTagId[] {
	if (!Array.isArray(value)) return [];
	const tags: FeedbackTagId[] = [];
	for (const entry of value) {
		if (typeof entry !== "string" || !FEEDBACK_TAG_IDS.has(entry)) continue;
		const tag = entry as FeedbackTagId;
		if (!tags.includes(tag)) tags.push(tag);
	}
	return tags;
}

/**
 * Record, change, or clear the reader's thumb on one assistant answer.
 *
 * A reason and its chips only ever travel with `"down"`: the columns are
 * meaningless otherwise and the route ignores them, so sending them would only
 * invite a confusing round-trip. The reason is trimmed and dropped when empty,
 * and an empty chip list is omitted rather than sent as `[]` - the route reads
 * an absent field the same way, and omitting it keeps the body honest about
 * what the reader actually chose. Both empty is what "Skip" amounts to.
 */
export async function setAnswerFeedback(
	conversationId: string,
	messageId: string,
	feedback: AnswerFeedback | null,
	details?: AnswerFeedbackDetails
): Promise<AnswerFeedbackState> {
	const isDown = feedback === "down";
	const trimmedReason = isDown ? (details?.reason ?? "").trim() : "";
	const tags = isDown ? asTags(details?.tags ?? []) : [];
	const response = await fetch(
		`/api/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`,
		{
			method: "PATCH",
			credentials: "same-origin",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				feedback,
				...(trimmedReason ? { feedbackReason: trimmedReason.slice(0, FEEDBACK_REASON_MAX_LENGTH) } : {}),
				...(tags.length > 0 ? { feedbackTags: tags } : {}),
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
		return { feedback, feedbackReason: trimmedReason || null, feedbackTags: tags, feedbackAt: null };
	}
	return {
		feedback: asFeedback(body.feedback),
		feedbackReason: asText(body.feedbackReason),
		feedbackTags: asTags(body.feedbackTags),
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

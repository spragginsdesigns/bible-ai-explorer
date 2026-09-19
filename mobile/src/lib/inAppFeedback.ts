/**
 * In-app feedback, Android mirror of `src/lib/feedback/in-app-feedback.ts`.
 *
 * The server owns the rules; this file exists so the screen can show the same
 * chips and stop an obviously empty or oversized message before it costs a
 * round trip. `tests/in-app-feedback-mirror.test.mjs` pins the ids, the labels
 * and the limits to the server's copy, because a chip this client sends that
 * the server has never heard of is a 400 the person reads as "it broke".
 */

export const FEEDBACK_CATEGORIES = [
	{ id: "bug", label: "Something is broken" },
	{ id: "idea", label: "I have an idea" },
	{ id: "praise", label: "Something I love" },
	{ id: "other", label: "Something else" },
] as const;

export type FeedbackCategoryId = (typeof FEEDBACK_CATEGORIES)[number]["id"];

export const MAX_FEEDBACK_MESSAGE_LENGTH = 2000;
export const MAX_REPLY_EMAIL_LENGTH = 254;

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Shape only, and only to spare a round trip; the server decides. */
export function looksLikeEmail(value: string): boolean {
	const trimmed = value.trim();
	return trimmed.length > 0 && trimmed.length <= MAX_REPLY_EMAIL_LENGTH && EMAIL_SHAPE.test(trimmed);
}

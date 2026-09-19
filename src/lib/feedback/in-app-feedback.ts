/**
 * In-app feedback: what a person wrote to us from inside the app.
 *
 * This module is the whole validation half of POST /api/feedback. Pure,
 * React-free and Prisma-free, so the rules can be tested without a database
 * and mirrored by every client (`mobile/src/lib/inAppFeedback.ts`,
 * `macos/Shared/Feedback/InAppFeedback.swift`).
 *
 * Deliberately separate from answer feedback (src/lib/chat/answer-feedback.ts):
 * a thumb is a judgment about one answer and belongs beside that answer, while
 * this is a message to a person and belongs on its own row.
 */

/**
 * Why they are writing. Four, not a taxonomy: each one changes what happens
 * next, and anything finer would be a form people abandon. The id goes on the
 * wire and into `Feedback.category`; the label is what every client shows, in
 * this order.
 */
export const FEEDBACK_CATEGORIES = [
	{ id: "bug", label: "Something is broken" },
	{ id: "idea", label: "I have an idea" },
	{ id: "praise", label: "Something I love" },
	{ id: "other", label: "Something else" },
] as const;

export type FeedbackCategoryId = (typeof FEEDBACK_CATEGORIES)[number]["id"];

const CATEGORY_IDS: ReadonlySet<string> = new Set(FEEDBACK_CATEGORIES.map((item) => item.id));

/** Long enough for a real report with steps, short enough to stay a message. */
export const MAX_FEEDBACK_MESSAGE_LENGTH = 2000;
/** A client version string like "1.71.0 (77)"; anything longer is a client bug. */
export const MAX_APP_VERSION_LENGTH = 64;
/** The longest address RFC 5321 allows. */
export const MAX_REPLY_EMAIL_LENGTH = 254;

/** Shape only: the address is for writing back, not for proving anything. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface FeedbackSubmission {
	category: FeedbackCategoryId;
	message: string;
	appVersion: string | null;
	replyEmail: string | null;
}

export type ParsedFeedbackSubmission =
	| { ok: true; data: FeedbackSubmission }
	| { ok: false; error: string };

function asRecord(value: unknown): Record<string, unknown> | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

/**
 * Read a submission off the wire.
 *
 * `platform` is not read here even though the row stores one: it is resolved
 * from the request's own headers on the server, so a client cannot file its
 * complaints under another client's name.
 */
export function parseFeedbackSubmission(body: unknown): ParsedFeedbackSubmission {
	const record = asRecord(body);
	if (!record) return { ok: false, error: "A feedback body must be an object." };

	const category = record.category;
	if (typeof category !== "string" || !CATEGORY_IDS.has(category)) {
		return { ok: false, error: "Pick what your feedback is about." };
	}

	const rawMessage = record.message;
	if (typeof rawMessage !== "string") {
		return { ok: false, error: "message must be a string." };
	}
	const message = rawMessage.trim();
	if (message.length === 0) {
		return { ok: false, error: "Tell us what happened." };
	}
	if (message.length > MAX_FEEDBACK_MESSAGE_LENGTH) {
		return {
			ok: false,
			error: `Feedback must be ${MAX_FEEDBACK_MESSAGE_LENGTH} characters or fewer.`,
		};
	}

	// A version we cannot read is dropped rather than refused: the person's
	// message matters more than the metadata around it.
	const rawVersion = record.appVersion;
	const appVersion =
		typeof rawVersion === "string" && rawVersion.trim().length > 0
			? rawVersion.trim().slice(0, MAX_APP_VERSION_LENGTH)
			: null;

	// An address that cannot be replied to is worth a 400: someone who asked
	// for an answer and silently will not get one is the worst outcome here.
	const rawEmail = record.replyEmail;
	let replyEmail: string | null = null;
	if (typeof rawEmail === "string" && rawEmail.trim().length > 0) {
		const trimmed = rawEmail.trim();
		if (trimmed.length > MAX_REPLY_EMAIL_LENGTH || !EMAIL_SHAPE.test(trimmed)) {
			return { ok: false, error: "That email address does not look right." };
		}
		replyEmail = trimmed;
	}

	return {
		ok: true,
		data: { category: category as FeedbackCategoryId, message, appVersion, replyEmail },
	};
}

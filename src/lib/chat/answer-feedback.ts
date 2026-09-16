/**
 * Answer feedback: the user's own thumb on one assistant answer. The contract
 * lives in docs/FEATURES.md ("Answer feedback, and how it reaches the
 * doctrinal eval harness").
 *
 * A thumb is a human judgment, kept beside the answer in its own Message
 * columns and never folded into the mechanical score in src/lib/ai/answer-eval.ts.
 * This module is the whole validation half of
 * PATCH /api/conversations/[id]/messages/[messageId]: pure, React-free and
 * Prisma-free so the rules can be tested without a database. The one rule that
 * needs a row - only an assistant message may be rated - stays in the route.
 */

/** The two thumbs. `null` on the wire means "clear my rating". */
export type AnswerFeedback = "up" | "down";

/** Exactly the three Message columns this patch writes, always all three. */
export type AnswerFeedbackPatch = {
	feedback: AnswerFeedback | null;
	feedbackReason: string | null;
	feedbackAt: Date | null;
};

export type ParsedFeedbackPatch =
	/** `data: null` means the body carried no `feedback` field: leave the columns alone. */
	| { ok: true; data: AnswerFeedbackPatch | null }
	| { ok: false; error: string };

/** Matches the `@db.Text` column's documented cap; longer is a 400, not a truncation. */
export const MAX_FEEDBACK_REASON_LENGTH = 500;

function asRecord(value: unknown): Record<string, unknown> | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

/**
 * Read the feedback half of a PATCH body. The body may also carry `content` or
 * `metadata`; those are the route's business and are ignored here.
 *
 * `now` is injected so a test can assert the exact stamp.
 */
export function parseFeedbackPatch(body: unknown, now: Date = new Date()): ParsedFeedbackPatch {
	const record = asRecord(body);
	if (!record) return { ok: true, data: null };

	const rawFeedback = record.feedback;
	// JSON cannot produce `undefined`, so an undefined value is an absent field.
	if (rawFeedback === undefined) return { ok: true, data: null };
	if (rawFeedback !== null && rawFeedback !== "up" && rawFeedback !== "down") {
		return { ok: false, error: 'feedback must be "up", "down", or null.' };
	}

	// The length is checked before the thumb is consulted: an oversized reason
	// is a malformed request whatever it is attached to, and answering 400 is
	// how the client learns the field was too long instead of silently losing it.
	const rawReason = record.feedbackReason;
	let reason: string | null = null;
	if (rawReason !== undefined && rawReason !== null) {
		if (typeof rawReason !== "string") {
			return { ok: false, error: "feedbackReason must be a string." };
		}
		const trimmed = rawReason.trim();
		if (trimmed.length > MAX_FEEDBACK_REASON_LENGTH) {
			return {
				ok: false,
				error: `A reason must be ${MAX_FEEDBACK_REASON_LENGTH} characters or fewer.`,
			};
		}
		reason = trimmed.length > 0 ? trimmed : null;
	}

	if (rawFeedback === null) {
		// Clearing wipes all three columns, reason included: a reason with no
		// thumb would outlive the judgment it explains.
		return { ok: true, data: { feedback: null, feedbackReason: null, feedbackAt: null } };
	}

	return {
		ok: true,
		data: {
			feedback: rawFeedback,
			// A reason only ever means something next to a thumbs down.
			feedbackReason: rawFeedback === "down" ? reason : null,
			feedbackAt: new Date(now.getTime()),
		},
	};
}

/** The response shape for a feedback patch: the three columns and the id. */
export type AnswerFeedbackResponse = {
	id: string;
	feedback: AnswerFeedback | null;
	feedbackReason: string | null;
	feedbackAt: string | null;
};

/** Serialize a rated message row for the wire (`feedbackAt` as ISO or null). */
export function answerFeedbackResponse(message: {
	id: string;
	feedback: string | null;
	feedbackReason: string | null;
	feedbackAt: Date | null;
}): AnswerFeedbackResponse {
	return {
		id: message.id,
		feedback: message.feedback === "up" || message.feedback === "down" ? message.feedback : null,
		feedbackReason: message.feedbackReason,
		feedbackAt: message.feedbackAt ? message.feedbackAt.toISOString() : null,
	};
}

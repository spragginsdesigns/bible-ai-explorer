import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { createRateLimiter, rateLimitKey } from "@/lib/rateLimit";
import { parseFeedbackSubmission } from "@/lib/feedback/in-app-feedback";
import { captureServerEvent, flushAnalytics } from "@/lib/analytics/server";
import { ANALYTICS_EVENTS, platformFromHeaders, sizeBucket } from "@/lib/analytics/events";

/**
 * Send feedback (docs/FEATURES.md, "Send feedback").
 *
 * One row, one direction. Usage analytics can say that people stop after a
 * first answer; only a person can say why, and this is the only route in the
 * app where they get to say it in their own words.
 *
 * The message is stored and never reported: the analytics event carries the
 * category and the length of what was written, because the prose can name a
 * church, a family or a crisis, and it belongs to the person who wrote it.
 */

// A person sending more than a handful of notes in five minutes is a script,
// not a correspondent. Low enough to stop one, far past anyone with something
// to say.
const FEEDBACK_RATE_LIMIT = 10;
const FEEDBACK_RATE_WINDOW_MS = 5 * 60 * 1000;

const feedbackRateLimiter = createRateLimiter({
	limit: FEEDBACK_RATE_LIMIT,
	windowMs: FEEDBACK_RATE_WINDOW_MS,
});

export async function POST(req: Request): Promise<Response> {
	try {
		const userId = await getAuthUser();

		const rate = feedbackRateLimiter.check(rateLimitKey(req, userId));
		if (!rate.allowed) {
			return NextResponse.json(
				{ error: "That is a lot of feedback at once. Try again in a few minutes." },
				{ status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
			);
		}

		const body: unknown = await req.json().catch(() => null);
		const parsed = parseFeedbackSubmission(body);
		if (!parsed.ok) {
			return NextResponse.json({ error: parsed.error }, { status: 400 });
		}

		// Resolved from the request, not from the body: a client cannot file
		// its complaints under another client's name.
		const platform = platformFromHeaders(req.headers);

		const saved = await prisma.feedback.create({
			data: {
				userId,
				category: parsed.data.category,
				message: parsed.data.message,
				platform,
				appVersion: parsed.data.appVersion,
				replyEmail: parsed.data.replyEmail,
			},
			select: { id: true, createdAt: true },
		});

		captureServerEvent({
			userId,
			event: ANALYTICS_EVENTS.feedbackSubmitted,
			platform,
			properties: {
				category: parsed.data.category,
				length: sizeBucket(parsed.data.message.length),
				wantsReply: Boolean(parsed.data.replyEmail),
				appVersion: parsed.data.appVersion,
			},
		});
		await flushAnalytics();

		return NextResponse.json({ id: saved.id, createdAt: saved.createdAt.toISOString() });
	} catch (err) {
		if (err instanceof Response) return err;
		console.error("Failed to save feedback:", err);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

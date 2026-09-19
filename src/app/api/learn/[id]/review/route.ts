import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthUser } from "@/lib/auth";
import { captureServerEvent, flushAnalytics } from "@/lib/analytics/server";
import { ANALYTICS_EVENTS, platformFromHeaders } from "@/lib/analytics/events";
import { LearnReviewConflict, reviewCardById, reviewCardOperation } from "@/lib/learn";

const reviewSchema = z.union([
 z.object({ result: z.enum(["again", "good"]) }).strict(),
 z.object({
  result: z.enum(["again", "good"]),
  operationId: z.string().uuid(),
  expectedRevision: z.number().int().min(0).max(2147483646),
  reviewedAt: z.string().datetime({ offset: true }).refine((value) => {
   const date = new Date(value);
   // Zod validates calendar dates. Restrict event times to the Unix epoch onward.
   return Number.isFinite(date.getTime()) && date.getTime() >= 0 && date.getTime() <= Date.now() + 300_000;
  }),
  timezone: z.string().min(1).max(100).refine((value) => {
   try { if (/^[+-]/.test(value)) return false; new Intl.DateTimeFormat("en-US", { timeZone: value }); return true; } catch { return false; }
  }),
 }).strict(),
]);

/**
 * Record one review and hand back the card as it now stands. The lookup is
 * userId-scoped, so another user's id is a 404 rather than a write.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
	try {
		const userId = await getAuthUser();
		const { id } = await params;

		const parsed = reviewSchema.safeParse(await req.json().catch(() => null));
		if (!parsed.success) {
			return NextResponse.json(
				{ error: "Invalid review. Supply result alone, or result with operationId, expectedRevision, reviewedAt and timezone." },
				{ status: 400 }
			);
		}

		const card = "operationId" in parsed.data
			? await reviewCardOperation(userId, id, parsed.data)
			: await reviewCardById(userId, id, parsed.data.result);
		if (!card) {
			return NextResponse.json({ error: "Not found" }, { status: 404 });
		}
		// A replayed operation is one review arriving twice after a dropped
		// response, not a second review, and counting it would inflate exactly
		// the number a flaky network already distorts.
		if (!("replayed" in card && card.replayed)) {
			captureServerEvent({
				userId,
				event: ANALYTICS_EVENTS.learnReviewed,
				platform: platformFromHeaders(req.headers),
				properties: { result: parsed.data.result },
			});
			await flushAnalytics();
		}
		return NextResponse.json(card);
	} catch (error) {
		if (error instanceof Response) return error;
		if (error instanceof LearnReviewConflict) {
			return NextResponse.json({ error: error.message, code: error.code, currentCard: error.currentCard }, { status: 409 });
		}
		console.error("[api/learn/:id/review] POST failed", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

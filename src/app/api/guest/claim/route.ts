import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { captureServerEvent, flushAnalytics } from "@/lib/analytics/server";
import { ANALYTICS_EVENTS, platformFromHeaders } from "@/lib/analytics/events";
import {
	GUEST_COOKIE,
	GUEST_RETENTION_DAYS,
	guestConversationTitle,
	isGuestId,
} from "@/lib/guest-rules";

/**
 * Save the study a guest started before signing up (docs/FEATURES.md, "Try
 * before you sign up").
 *
 * The guest id arrives only as the httpOnly `sw_guest` cookie the ask route
 * set, so a signed-in caller can claim nothing but the turns this browser
 * asked. The claim is a conditional update first: two tabs racing both run
 * it, exactly one stamps the rows, and only that one builds the conversation.
 *
 * Answers `{ conversationId }`, or `{ conversationId: null }` when there was
 * nothing to adopt. Either way the cookie is cleared, so the next guest on a
 * shared computer starts clean.
 */
export async function POST(req: Request) {
	try {
		const userId = await getAuthUser();
		const jar = await cookies();
		const guestId = jar.get(GUEST_COOKIE)?.value;

		const clear = (body: { conversationId: string | null }) => {
			const response = NextResponse.json(body);
			response.cookies.set(GUEST_COOKIE, "", { path: "/", maxAge: 0 });
			return response;
		};

		if (!isGuestId(guestId)) return clear({ conversationId: null });

		const oldest = new Date(Date.now() - GUEST_RETENTION_DAYS * 24 * 60 * 60 * 1000);
		const claimedAt = new Date();

		const conversationId = await prisma.$transaction(async (tx) => {
			const stamped = await tx.guestTurn.updateMany({
				where: { guestId, claimedAt: null, answer: { not: null }, createdAt: { gte: oldest } },
				data: { claimedAt, claimedByUserId: userId },
			});
			if (stamped.count === 0) return null;

			const turns = await tx.guestTurn.findMany({
				where: { guestId, claimedAt, claimedByUserId: userId },
				orderBy: { createdAt: "asc" },
				select: { question: true, answer: true, createdAt: true },
			});
			const conversation = await tx.conversation.create({
				data: { userId, title: guestConversationTitle(turns[0]?.question ?? "") },
				select: { id: true },
			});
			// Two rows per turn. The assistant row sits one millisecond after its
			// question so ordering by createdAt can never swap a pair.
			await tx.message.createMany({
				data: turns.flatMap((turn) => [
					{
						conversationId: conversation.id,
						role: "user",
						content: turn.question,
						createdAt: turn.createdAt,
					},
					{
						conversationId: conversation.id,
						role: "assistant",
						content: turn.answer ?? "",
						createdAt: new Date(turn.createdAt.getTime() + 1),
						metadata: { source: "guest" },
					},
				]),
			});
			return conversation.id;
		});

		if (conversationId) {
			captureServerEvent({
				userId,
				event: ANALYTICS_EVENTS.guestClaimed,
				platform: platformFromHeaders(req.headers),
			});
			await flushAnalytics();
		}
		return clear({ conversationId });
	} catch (err) {
		if (err instanceof Response) return err;
		console.error("Guest claim failed:", err);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

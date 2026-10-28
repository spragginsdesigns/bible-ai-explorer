import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createRateLimiter, rateLimitKey } from "@/lib/rateLimit";
import { CHAT_NOTIFICATION_STOP_TTL_MS, parseChatNotificationAttemptId } from "@/lib/chat-notification-stop";

const stopRateLimiter = createRateLimiter({ limit: 30, windowMs: 60_000 });

export async function POST(req: Request) {
	try {
		const userId = await getAuthUser();
		const rate = stopRateLimiter.check(rateLimitKey(req, userId));
		if (!rate.allowed) {
			return NextResponse.json({ error: "Too many requests" }, {
				status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) },
			});
		}
		const body: unknown = await req.json().catch(() => null);
		const data = body && typeof body === "object" && !Array.isArray(body)
			? body as Record<string, unknown> : {};
		const conversationId = data.conversationId;
		const attemptId = parseChatNotificationAttemptId(data.attemptId);
		if (typeof conversationId !== "string" || !conversationId || conversationId.length > 128 ||
			conversationId.trim() !== conversationId || !attemptId) {
			return NextResponse.json({ error: "Invalid input" }, { status: 400 });
		}

		// Ownership is checked before any tombstone read/write. Missing and
		// foreign conversations have the same response, without an existence oracle.
		const conversation = await prisma.conversation.findFirst({
			where: { id: conversationId, userId }, select: { id: true },
		});
		if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 });
		const now = new Date();
		const where = { userId_conversationId_attemptId: { userId, conversationId, attemptId } };
		try {
			await prisma.chatNotificationStop.upsert({
				where,
				create: { userId, conversationId, attemptId, createdAt: now,
					expiresAt: new Date(now.getTime() + CHAT_NOTIFICATION_STOP_TTL_MS) },
				// Retries are idempotent and do not turn a one-hour tombstone into
				// an indefinitely renewed conversation flag.
				update: {},
			});
		} catch (error) {
			// Some Prisma upsert shapes can race on their first insert. A row
			// already written for this exact owned attempt is the same acknowledgement.
			const code = error && typeof error === "object" && "code" in error ? error.code : null;
			if (code === "P2002") {
				const existing = await prisma.chatNotificationStop.findUnique({ where, select: { attemptId: true } });
				if (!existing) throw error;
			} else if (code === "P2003") {
				// The owned conversation/account was deleted after the ownership read.
				return NextResponse.json({ error: "Not found" }, { status: 404 });
			} else throw error;
		}
		return NextResponse.json({ stopped: true });
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("[chat-notification-stop] Could not acknowledge Stop");
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

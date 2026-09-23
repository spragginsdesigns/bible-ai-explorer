import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { createRateLimiter, rateLimitKey } from "@/lib/rateLimit";
import { captureServerEvent, flushAnalytics } from "@/lib/analytics/server";
import { ANALYTICS_EVENTS, platformFromHeaders } from "@/lib/analytics/events";
import { stripFollowUpMarkers } from "@/utils/assistantMarkdown";
import {
	createSharedAnswerId,
	extractReferences,
	shareAnswer,
	shareQuestion,
	shareTranslation,
	sharedAnswerUrl,
} from "@/lib/shared-answer";

/**
 * Share an answer (docs/FEATURES.md, "Share an answer: a public page, and a
 * card image").
 *
 * POST takes a conversation and one of its assistant messages and writes a
 * SNAPSHOT: the question, the answer text and the references are copied into
 * SharedAnswer so the public page never reads Message. Editing or deleting the
 * conversation afterwards therefore cannot change or leak what a link shows,
 * and revoking is the only way to take a link back.
 *
 * Sharing is idempotent on the message: a second tap on an already-shared
 * answer returns the same link rather than minting a second capability for the
 * same text, and re-sharing a revoked answer un-revokes the original id.
 */

// A share is one row and no model call, so the ceiling only has to stop a
// script minting thousands of public ids; it is well past any real use.
const SHARE_RATE_LIMIT = 30;
const SHARE_RATE_WINDOW_MS = 5 * 60 * 1000;

const shareRateLimiter = createRateLimiter({
	limit: SHARE_RATE_LIMIT,
	windowMs: SHARE_RATE_WINDOW_MS,
});

interface ShareRequestBody {
	conversationId: string;
	messageId: string;
}

function readBody(body: unknown): ShareRequestBody | null {
	if (typeof body !== "object" || body === null) return null;
	const record = body as Record<string, unknown>;
	const conversationId = record.conversationId;
	const messageId = record.messageId;
	if (typeof conversationId !== "string" || !conversationId.trim()) return null;
	if (typeof messageId !== "string" || !messageId.trim()) return null;
	return { conversationId: conversationId.trim(), messageId: messageId.trim() };
}

function shareResponse(share: { id: string; createdAt: Date }) {
	return NextResponse.json({
		id: share.id,
		url: sharedAnswerUrl(share.id),
		createdAt: share.createdAt,
	});
}

export async function POST(req: Request) {
	try {
		const userId = await getAuthUser();
		// Three exits answer with a link: a fresh share, an already-shared answer
		// tapped again, and the loser of a race. They are one user action with
		// different costs, so they share an event and are told apart by newShare.
		const captureShare = async (newShare: boolean) => {
			captureServerEvent({
				userId,
				event: ANALYTICS_EVENTS.answerShared,
				platform: platformFromHeaders(req.headers),
				properties: { newShare },
			});
			await flushAnalytics();
		};

		const limit = shareRateLimiter.check(rateLimitKey(req, userId));
		if (!limit.allowed) {
			return NextResponse.json(
				{ error: "Too many shares. Try again in a minute." },
				{ status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
			);
		}

		const body = readBody(await req.json().catch(() => null));
		if (!body) {
			return NextResponse.json(
				{ error: "conversationId and messageId are required." },
				{ status: 400 },
			);
		}

		// Ownership is the conversation's, exactly as every other conversation
		// route checks it. A message id alone proves nothing.
		const conversation = await prisma.conversation.findFirst({
			where: { id: body.conversationId, userId },
			select: { id: true },
		});
		if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 });

		const message = await prisma.message.findFirst({
			where: { id: body.messageId, conversationId: conversation.id },
			select: { id: true, role: true, content: true, metadata: true, createdAt: true },
		});
		if (!message) return NextResponse.json({ error: "Not found" }, { status: 404 });
		if (message.role !== "assistant") {
			return NextResponse.json({ error: "Only an answer can be shared." }, { status: 400 });
		}

		const existing = await prisma.sharedAnswer.findUnique({
			where: { messageId: message.id },
			select: { id: true, userId: true, createdAt: true, revokedAt: true },
		});
		if (existing) {
			if (existing.userId !== userId) {
				return NextResponse.json({ error: "Not found" }, { status: 404 });
			}
			// Re-sharing after a revoke reuses the id rather than leaving the old
			// one dead and minting a second capability for the same text.
			if (existing.revokedAt) {
				await prisma.sharedAnswer.update({
					where: { id: existing.id },
					data: { revokedAt: null },
				});
			}
			await captureShare(false);
			return shareResponse(existing);
		}

		// The prompt that produced the answer: the nearest user row at or before
		// the assistant row. `lte` rather than `lt` because a regenerate rewrites
		// the assistant row while keeping the original receipt time, which can
		// land the pair on the same timestamp.
		const prompt = await prisma.message.findFirst({
			where: {
				conversationId: conversation.id,
				role: "user",
				createdAt: { lte: message.createdAt },
				NOT: { id: message.id },
			},
			orderBy: [{ createdAt: "desc" }, { id: "desc" }],
			select: { content: true },
		});

		const account = await prisma.user.findUnique({
			where: { id: userId },
			select: { translation: true },
		});

		// Assistant rows are persisted already stripped, but rows written before
		// that was true are not, and the public page has no client-side stripper
		// to fall back on.
		const answer = shareAnswer(stripFollowUpMarkers(message.content, { streaming: false }));
		if (!answer) {
			return NextResponse.json({ error: "That answer is empty." }, { status: 400 });
		}

		const data = {
			userId,
			conversationId: conversation.id,
			messageId: message.id,
			question: shareQuestion(prompt?.content ?? ""),
			answer,
			references: extractReferences(message.metadata),
			translation: shareTranslation(message.metadata, account?.translation),
		};

		try {
			const created = await prisma.sharedAnswer.create({
				data: { id: createSharedAnswerId(), ...data },
				select: { id: true, createdAt: true },
			});
			await captureShare(true);
			return shareResponse(created);
		} catch (error) {
			// Two taps in flight at once: the unique messageId arbitrates and the
			// loser returns the row the winner wrote.
			if (
				error instanceof Prisma.PrismaClientKnownRequestError &&
				error.code === "P2002"
			) {
				const raced = await prisma.sharedAnswer.findUnique({
					where: { messageId: message.id },
					select: { id: true, createdAt: true },
				});
				if (raced) {
					await captureShare(false);
					return shareResponse(raced);
				}
			}
			throw error;
		}
	} catch (err) {
		if (err instanceof Response) return err;
		console.error("Share answer failed:", err);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

/** The owner's own links, for Settings -> Privacy -> Shared answers. */
export async function GET() {
	try {
		const userId = await getAuthUser();
		const shares = await prisma.sharedAnswer.findMany({
			where: { userId },
			orderBy: { createdAt: "desc" },
			select: { id: true, question: true, createdAt: true, revokedAt: true, listedAt: true },
		});
		return NextResponse.json({
			shares: shares.map((share) => ({
				id: share.id,
				url: sharedAnswerUrl(share.id),
				question: share.question,
				createdAt: share.createdAt,
				revokedAt: share.revokedAt,
				listed: share.listedAt !== null && share.revokedAt === null,
			})),
		});
	} catch (err) {
		if (err instanceof Response) return err;
		console.error("Share list failed:", err);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

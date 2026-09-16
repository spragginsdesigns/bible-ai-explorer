import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { answerFeedbackResponse, parseFeedbackPatch } from "@/lib/chat/answer-feedback";

/**
 * Edit one message in a conversation the caller owns.
 *
 * Two bodies share this handler. `{ content, metadata }` is the original edit.
 * `{ feedback, feedbackReason }` is the user's thumb on an answer
 * (docs/FEATURES.md, "Answer feedback, and how it reaches the doctrinal eval
 * harness"); its rules live in src/lib/chat/answer-feedback.ts, and a feedback
 * body answers with just the four feedback fields.
 */
export async function PATCH(
	req: Request,
	{ params }: { params: Promise<{ id: string; messageId: string }> }
) {
	try {
		const userId = await getAuthUser();
		const { id, messageId } = await params;
		// Verify ownership via conversation
		const conversation = await prisma.conversation.findFirst({
			where: { id, userId },
		});
		if (!conversation) {
			return NextResponse.json({ error: "Not found" }, { status: 404 });
		}

		const body: unknown = await req.json().catch(() => null);
		const feedback = parseFeedbackPatch(body);
		if (!feedback.ok) {
			return NextResponse.json({ error: feedback.error }, { status: 400 });
		}

		if (feedback.data) {
			// A thumb is a judgment about an answer, so the user's own message is
			// not rateable. Scoped to the conversation already proven to be theirs.
			const target = await prisma.message.findFirst({
				where: { id: messageId, conversationId: id },
				select: { role: true },
			});
			if (!target) {
				return NextResponse.json({ error: "Not found" }, { status: 404 });
			}
			if (target.role !== "assistant") {
				return NextResponse.json({ error: "Only an answer can be rated." }, { status: 400 });
			}
		}

		const patch = (typeof body === "object" && body !== null && !Array.isArray(body)
			? body
			: {}) as { content?: unknown; metadata?: Prisma.InputJsonValue };
		const message = await prisma.message.update({
			where: { id: messageId, conversationId: id },
			data: {
				...(typeof patch.content === "string" && { content: patch.content }),
				...(patch.metadata !== undefined && { metadata: patch.metadata }),
				...(feedback.data ?? {}),
			},
		});

		if (feedback.data) {
			return NextResponse.json(answerFeedbackResponse(message));
		}
		return NextResponse.json(message);
	} catch (err) {
		if (err instanceof Response) return err;
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

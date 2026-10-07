import "server-only";

import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { parseUserIdAllowlist } from "@/lib/entitlements-rules";
import {
	answerRatingWhere,
	feedbackMessageWhere,
	isAdminUserId,
	modelIdFromMetadata,
	pickReviewPage,
	previousUserTurnId,
	reviewFetchDepth,
	reviewKindsFor,
	type MarkReviewedInput,
	type ReviewFilters,
	type ReviewStub,
} from "@/lib/admin/feedback-review-rules";

/**
 * The database half of the owner's review queue (/admin/feedback). The rules
 * are pure and live in `feedback-review-rules.ts`.
 *
 * Only Clerk user ids are shown, never an email: not the account's, and not
 * the optional reply address on a Send feedback row (the page says whether
 * one was left, and nothing more).
 */

/** The signed-in admin's Clerk id, or null for everyone else (render 404). */
export async function currentAdminUserId(): Promise<string | null> {
	const { userId } = await auth();
	const allowlist = parseUserIdAllowlist(process.env.ADMIN_USER_IDS);
	return isAdminUserId(userId, allowlist) ? userId : null;
}

export interface ReviewRating {
	kind: "rating";
	id: string;
	at: string;
	reviewedAt: string | null;
	userId: string;
	conversationId: string;
	tags: string[];
	reason: string | null;
	question: string | null;
	answer: string;
	modelId: string | null;
}

export interface ReviewMessage {
	kind: "message";
	id: string;
	at: string;
	reviewedAt: string | null;
	userId: string;
	category: string;
	message: string;
	platform: string;
	appVersion: string | null;
	wantsReply: boolean;
}

export type ReviewItem = ReviewRating | ReviewMessage;

export interface ReviewPage {
	items: ReviewItem[];
	hasMore: boolean;
}

async function ratingStubs(filters: ReviewFilters, now: Date): Promise<ReviewStub[]> {
	const rows = await prisma.message.findMany({
		where: answerRatingWhere(filters, now),
		select: { id: true, feedbackAt: true },
		orderBy: [{ feedbackAt: "desc" }, { id: "desc" }],
		take: reviewFetchDepth(filters),
	});
	return rows.map((row) => ({ kind: "rating" as const, id: row.id, at: row.feedbackAt ?? new Date(0) }));
}

async function messageStubs(filters: ReviewFilters, now: Date): Promise<ReviewStub[]> {
	const rows = await prisma.feedback.findMany({
		where: feedbackMessageWhere(filters, now),
		select: { id: true, createdAt: true },
		orderBy: [{ createdAt: "desc" }, { id: "desc" }],
		take: reviewFetchDepth(filters),
	});
	return rows.map((row) => ({ kind: "message" as const, id: row.id, at: row.createdAt }));
}

async function loadRatings(ids: string[]): Promise<Map<string, ReviewRating>> {
	if (ids.length === 0) return new Map();
	const rows = await prisma.message.findMany({
		where: { id: { in: ids } },
		select: {
			id: true,
			conversationId: true,
			content: true,
			metadata: true,
			feedbackTags: true,
			feedbackReason: true,
			feedbackAt: true,
			feedbackReviewedAt: true,
			conversation: { select: { userId: true } },
		},
	});

	// Ids and roles only for the walk; content is read for the chosen turns.
	const conversationIds = [...new Set(rows.map((row) => row.conversationId))];
	const turns = await prisma.message.findMany({
		where: { conversationId: { in: conversationIds } },
		select: { id: true, conversationId: true, role: true },
		orderBy: [{ conversationId: "asc" }, { createdAt: "asc" }],
	});
	const threads = new Map<string, { id: string; role: string }[]>();
	for (const turn of turns) {
		const list = threads.get(turn.conversationId) ?? [];
		list.push(turn);
		threads.set(turn.conversationId, list);
	}
	const questionIdFor = new Map<string, string>();
	for (const row of rows) {
		const questionId = previousUserTurnId(threads.get(row.conversationId) ?? [], row.id);
		if (questionId) questionIdFor.set(row.id, questionId);
	}
	const questions = await prisma.message.findMany({
		where: { id: { in: [...new Set(questionIdFor.values())] } },
		select: { id: true, content: true },
	});
	const questionText = new Map(questions.map((question) => [question.id, question.content]));

	return new Map(
		rows.map((row) => {
			const questionId = questionIdFor.get(row.id);
			const item: ReviewRating = {
				kind: "rating",
				id: row.id,
				at: (row.feedbackAt ?? new Date(0)).toISOString(),
				reviewedAt: row.feedbackReviewedAt?.toISOString() ?? null,
				userId: row.conversation.userId,
				conversationId: row.conversationId,
				tags: row.feedbackTags,
				reason: row.feedbackReason,
				question: questionId ? (questionText.get(questionId) ?? null) : null,
				answer: row.content,
				modelId: modelIdFromMetadata(row.metadata),
			};
			return [row.id, item];
		})
	);
}

async function loadMessages(ids: string[]): Promise<Map<string, ReviewMessage>> {
	if (ids.length === 0) return new Map();
	const rows = await prisma.feedback.findMany({
		where: { id: { in: ids } },
		select: {
			id: true,
			userId: true,
			category: true,
			message: true,
			platform: true,
			appVersion: true,
			replyEmail: true,
			createdAt: true,
			reviewedAt: true,
		},
	});
	return new Map(
		rows.map((row) => {
			const item: ReviewMessage = {
				kind: "message",
				id: row.id,
				at: row.createdAt.toISOString(),
				reviewedAt: row.reviewedAt?.toISOString() ?? null,
				userId: row.userId,
				category: row.category,
				message: row.message,
				platform: row.platform,
				appVersion: row.appVersion,
				wantsReply: Boolean(row.replyEmail),
			};
			return [row.id, item];
		})
	);
}

/** One newest-first page of the queue, full rows for that page only. */
export async function loadReviewPage(filters: ReviewFilters, now = new Date()): Promise<ReviewPage> {
	const kinds = reviewKindsFor(filters);
	const lists = await Promise.all(
		kinds.map((kind) => (kind === "rating" ? ratingStubs(filters, now) : messageStubs(filters, now)))
	);
	const { items: stubs, hasMore } = pickReviewPage(lists, filters);

	const [ratings, messages] = await Promise.all([
		loadRatings(stubs.filter((stub) => stub.kind === "rating").map((stub) => stub.id)),
		loadMessages(stubs.filter((stub) => stub.kind === "message").map((stub) => stub.id)),
	]);

	const items: ReviewItem[] = [];
	for (const stub of stubs) {
		const item = stub.kind === "rating" ? ratings.get(stub.id) : messages.get(stub.id);
		// A row deleted between the two reads (account deletion) just drops out.
		if (item) items.push(item);
	}
	return { items, hasMore };
}

/**
 * Persist the review mark. Scoped to what the queue shows, so a stray id can
 * never stamp an unrated message. Returns false when nothing matched.
 */
export async function setReviewed({ kind, id, reviewed }: MarkReviewedInput, now = new Date()): Promise<boolean> {
	const stamp = reviewed ? now : null;
	const result =
		kind === "rating"
			? await prisma.message.updateMany({
					where: { id, role: "assistant", feedback: "down" },
					data: { feedbackReviewedAt: stamp },
				})
			: await prisma.feedback.updateMany({ where: { id }, data: { reviewedAt: stamp } });
	return result.count > 0;
}

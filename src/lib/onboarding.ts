import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
	GETTING_STARTED_ITEMS,
	WELCOME_TEXT,
	WELCOME_TITLE,
	resolveChoiceCard,
	type GettingStartedKey,
} from "@/lib/onboarding-rules";

/**
 * "Walk with me" on the server (docs/onboarding/PLAN.md): opening the welcome
 * conversation, telling a welcome turn apart from an ordinary one, and the
 * Getting started card. The conversation itself is run by the chat route with
 * `onboardingGuidance`; this module only decides who gets one and seeds it.
 */

export type OnboardingStartMode = "auto" | "manual";

export type OnboardingStartResult =
	/** The welcome conversation to open. `created` when this call made it. */
	| { status: "active"; conversationId: string; created: boolean }
	/** Already finished or skipped; nothing opens on its own. */
	| { status: "done" }
	/** An existing member: the welcome is for new sign-ups only. */
	| { status: "not_eligible" };

/**
 * When Walk with me reached production. An account created after it is a new
 * sign-up by definition, even if it chatted before any welcome opened: Kim
 * (Android 1.100.0, 2026-10-25) and an iOS 1.24.0 reader (2026-10-26) both
 * signed up on builds that never ask for a welcome, sent a first message, and
 * were then refused one forever as "existing members".
 */
export const WALK_WITH_ME_LAUNCHED_AT = new Date("2026-10-25T00:00:00Z");

/** Signed up since the welcome existed, so it is meant for them. */
function isNewSignUp(createdAt: Date | null | undefined): boolean {
	return Boolean(createdAt && createdAt >= WALK_WITH_ME_LAUNCHED_AT);
}

/**
 * A new sign-up chatting in an ordinary conversation with no welcome open:
 * the build in their hand cannot open one (Android before 1.101.0, iOS
 * before 1.26.0), or opening it failed offline. Rather than leave them with
 * no getting to know you at all, those chats run the interview in plain words
 * (`textInterviewGuidance`), as every account had before Walk with me.
 */
export function needsTextInterview(
	user: { onboardedAt: Date | null; onboardingConversationId: string | null; createdAt: Date } | null | undefined,
	welcomeTurn: boolean,
): boolean {
	return Boolean(user && !welcomeTurn && !user.onboardedAt && !user.onboardingConversationId && isNewSignUp(user.createdAt));
}

/** SureWord's first message, with the text size card under it, as stored parts. */
function welcomeParts() {
	const card = resolveChoiceCard({ step: "textScale" });
	return [
		{ type: "text", text: WELCOME_TEXT },
		{
			type: "tool-presentChoices",
			toolCallId: `welcome-${randomUUID()}`,
			state: "output-available",
			input: { step: "textScale", question: card.question, options: card.options, allowOther: card.allowOther },
			output: card,
		},
	];
}

/**
 * Open (or return) the welcome conversation.
 *
 * `auto` is what every client calls after sign-in and the consent sheet. It
 * opens a welcome only for a brand-new account: `onboardedAt` null and
 * either created since Walk with me launched or with no conversation of its
 * own yet. A web guest's claimed turns do not count, so a guest who signs up
 * still walks straight into the welcome. An existing member never gets one
 * pushed at them (Austin, 2026-10-25).
 *
 * `manual` is "Walk me through SureWord" in Settings: anyone, any time. It
 * reopens the welcome conversation when there is one, so it picks up where it
 * stopped, and clears `onboardedAt` so SureWord carries on with it.
 *
 * Idempotent under concurrency: the account row is locked for the whole
 * decision, so two calls at once (two devices, a double mount) get the same
 * conversation rather than two welcomes.
 */
export async function startOnboarding(userId: string, mode: OnboardingStartMode): Promise<OnboardingStartResult> {
	return prisma.$transaction(
		async (tx) => {
			await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
			const user = await tx.user.findUnique({
				where: { id: userId },
				select: { onboardedAt: true, onboardingConversationId: true, createdAt: true },
			});
			if (!user) return { status: "not_eligible" as const };

			const existing = user.onboardingConversationId
				? await tx.conversation.findFirst({
						where: { id: user.onboardingConversationId, userId },
						select: { id: true },
					})
				: null;

			if (mode === "auto") {
				if (user.onboardedAt) return { status: "done" as const };
				if (existing) return { status: "active" as const, conversationId: existing.id, created: false };
				const own = isNewSignUp(user.createdAt)
					? 0
					: await tx.conversation.count({
							where: {
								userId,
								messages: { none: { metadata: { path: ["source"], equals: "guest" } } },
							},
						});
				if (own > 0) return { status: "not_eligible" as const };
			} else if (existing) {
				if (user.onboardedAt) await tx.user.update({ where: { id: userId }, data: { onboardedAt: null } });
				return { status: "active" as const, conversationId: existing.id, created: false };
			}

			const conversation = await tx.conversation.create({
				data: { userId, title: WELCOME_TITLE },
				select: { id: true },
			});
			await tx.message.create({
				data: {
					conversationId: conversation.id,
					role: "assistant",
					content: WELCOME_TEXT,
					metadata: JSON.parse(JSON.stringify({ parts: welcomeParts(), source: "onboarding" })),
				},
			});
			await tx.user.update({
				where: { id: userId },
				data: { onboardingConversationId: conversation.id, onboardedAt: null },
			});
			return { status: "active" as const, conversationId: conversation.id, created: true };
		},
		{ timeout: 15000 },
	);
}

/**
 * True when this chat turn is part of the welcome: it is in the welcome
 * conversation and the person has not finished or skipped it. Only these
 * turns ride the onboarding usage surface.
 */
export function isOnboardingTurn(
	user: { onboardedAt: Date | null; onboardingConversationId: string | null } | null | undefined,
	conversationId: string | null,
): boolean {
	return Boolean(
		user && !user.onboardedAt && conversationId && user.onboardingConversationId === conversationId,
	);
}

export interface GettingStartedProgress {
	/** False once every row is done, the card was dismissed, or this account never had the welcome. */
	show: boolean;
	items: Record<GettingStartedKey, boolean>;
}

/**
 * The Getting started card on Today. Every tick is real use read from the
 * table that records it; nothing ticks itself. Only accounts that came in
 * through the welcome see the card, so existing members are never shown one.
 */
export async function gettingStartedProgress(userId: string): Promise<GettingStartedProgress> {
	const [user, chapter, insightUsage, memory, church] = await Promise.all([
		prisma.user.findUnique({
			where: { id: userId },
			select: {
				onboardingConversationId: true,
				firstInsightAt: true,
				firstCrossOpenedAt: true,
				gettingStartedDismissedAt: true,
			},
		}),
		prisma.readingLogChapter.findFirst({ where: { userId }, select: { userId: true } }),
		prisma.aiUsageRequest.findFirst({
			where: { userId, surface: "verse-insight", status: "completed" },
			select: { id: true },
		}),
		prisma.verseMemory.findFirst({ where: { userId }, select: { id: true } }),
		prisma.userChurch.findUnique({ where: { userId }, select: { userId: true } }),
	]);
	const items: Record<GettingStartedKey, boolean> = {
		readChapter: Boolean(chapter),
		tapVerse: Boolean(user?.firstInsightAt || insightUsage),
		dailyWord: Boolean(user?.firstCrossOpenedAt),
		learnVerse: Boolean(memory),
		church: Boolean(church),
	};
	const allDone = GETTING_STARTED_ITEMS.every((item) => items[item.key]);
	return {
		show: Boolean(user?.onboardingConversationId) && !user?.gettingStartedDismissedAt && !allDone,
		items,
	};
}

/** Stamp a first-use column once; later calls change nothing. Never throws. */
export async function stampFirstUse(userId: string, field: "firstInsightAt" | "firstCrossOpenedAt"): Promise<void> {
	try {
		await prisma.user.updateMany({ where: { id: userId, [field]: null }, data: { [field]: new Date() } });
	} catch (error) {
		console.error(`[onboarding] stamping ${field} failed:`, error);
	}
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findTodayCross, generateDailyCross, storeDailyCross } from "@/lib/daily-cross";
import { refreshSuggestedQuestions } from "@/lib/suggested-questions";
import { sendPushMessages, type PendingPush } from "@/lib/push";
import { recipientFromRow } from "@/lib/push-routing";
import { planMorningAudience } from "@/lib/push-audience";
import { aiConsentedUserIds } from "@/lib/preferences-contract";
import {
	PUSH_ACTIVITY_WINDOW_MS,
	lastActivityByUser,
	splitByActivity,
	type UserActivityRow,
} from "@/lib/cron-audience";

// Loops over users with a per-user AI call and a push send; needs the full
// function budget. Node runtime is required (Prisma + fs for the KJV corpus).
export const maxDuration = 300;

const MAX_USERS_PER_RUN = 50;
const DAILY_CROSS_CONCURRENCY = MAX_USERS_PER_RUN;
const DAILY_CROSS_GENERATION_BUDGET_MS = 210_000;
const DAILY_CROSS_CHANNEL_ID = "daily-cross";


/** Local hour (0-23) in an IANA timezone; null when the timezone is invalid. */
function localHour(timezone: string, now: Date): number | null {
	try {
		const parts = new Intl.DateTimeFormat("en-US", {
			timeZone: timezone,
			hour: "numeric",
			hour12: false,
		}).formatToParts(now);
		const hour = parts.find((part) => part.type === "hour");
		// hour12: false can render midnight as "24" in some ICU versions.
		return hour ? Number(hour.value) % 24 : null;
	} catch {
		return null;
	}
}

/**
 * Keep very long verses tray-friendly (the longest KJV verse runs ~430
 * characters); the full text is one tap away on the Daily Cross screen.
 */
function trayVerse(text: string, max = 240): string {
	return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Each user's newest activity inside the push window, from one grouped query
 * over every activity source rather than four lookups per user. Returns null
 * when the read fails, so the caller can choose how to degrade.
 */
async function loadRecentActivity(userIds: readonly string[], now: Date): Promise<Map<string, Date> | null> {
	if (userIds.length === 0) return new Map();
	// Columns are UTC `timestamp(3)`; casting the ISO string to `timestamp`
	// drops the Z and compares wall clock to wall clock, both in UTC.
	const since = new Date(now.getTime() - PUSH_ACTIVITY_WINDOW_MS).toISOString();
	const ids = [...userIds];
	try {
		const rows = await prisma.$queryRaw<UserActivityRow[]>`
			SELECT c."userId" AS "userId", MAX(m."createdAt") AS "lastActiveAt"
			FROM "Message" m JOIN "Conversation" c ON c.id = m."conversationId"
			WHERE c."userId" = ANY(${ids}::text[]) AND m.role = 'user' AND m."createdAt" >= ${since}::timestamp
			GROUP BY c."userId"
			UNION ALL
			SELECT "userId", MAX("readAt") FROM "ReadingEvent"
			WHERE "userId" = ANY(${ids}::text[]) AND "readAt" >= ${since}::timestamp
			GROUP BY "userId"
			UNION ALL
			SELECT "userId", MAX("updatedAt") FROM "VerseHighlight"
			WHERE "userId" = ANY(${ids}::text[]) AND "updatedAt" >= ${since}::timestamp
			GROUP BY "userId"
			UNION ALL
			SELECT "userId", MAX("updatedAt") FROM "Note"
			WHERE "userId" = ANY(${ids}::text[]) AND "updatedAt" >= ${since}::timestamp
			GROUP BY "userId"
		`;
		return lastActivityByUser(rows);
	} catch (error) {
		console.error("[cron/verse-of-day] Activity lookup failed:", error);
		return null;
	}
}

/**
 * The due users who agreed to the AI data-sharing sheet (docs/ios/ai-consent.md).
 * Nobody taps anything for the morning day, so only these get one written
 * from their reading, notes, chat and memories; everyone else gets the day a
 * brand-new account gets. A failed read narrows to nobody, never to everybody.
 */
async function loadAiConsented(userIds: readonly string[]): Promise<Set<string>> {
	if (userIds.length === 0) return new Set();
	try {
		const rows = await prisma.user.findMany({
			where: { id: { in: [...userIds] } },
			select: { id: true, aiConsentVersion: true, aiConsentAt: true },
		});
		return aiConsentedUserIds(rows);
	} catch (error) {
		console.error("[cron/verse-of-day] Consent lookup failed; writing every day without personal context:", error);
		return new Set();
	}
}

async function mapWithConcurrency<T, R>(
	items: readonly T[],
	limit: number,
	mapper: (item: T) => Promise<R>,
): Promise<R[]> {
	const results = new Array<R>(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const index = next;
			next += 1;
			results[index] = await mapper(items[index]);
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(Math.max(1, limit), items.length) }, () => worker()),
	);
	return results;
}

/**
 * Hourly cron: every registered push token carries its timezone and preferred
 * local hour, so each run serves the users whose local time just reached their
 * notify hour. One push per user per run, fanned out to their devices in a
 * single Expo message - see planMorningAudience for how disagreeing devices
 * and stale installs are resolved.
 */
export async function GET(request: Request) {
	const expected = process.env.CRON_SECRET;
	if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const now = new Date();
	const enabledTokens = await prisma.pushToken.findMany({
		where: { enabled: true },
		select: {
			id: true,
			userId: true,
			token: true,
			timezone: true,
			notifyHour: true,
			updatedAt: true,
			platform: true,
			webP256dh: true,
			webAuth: true,
		},
	});
	// Planning works on token strings; a browser recipient also needs its
	// subscription keys, so they are re-attached by row id when sending.
	const tokenRows = new Map(enabledTokens.map((row) => [row.id, row]));
	// Due-ness is decided once per user (their newest device's timezone and
	// hour), never per token: per-token due checks are how one account with a
	// pile of stale install tokens received dozens of identical mornings.
	const planned = planMorningAudience(enabledTokens, now, localHour);
	// Filtered before the per-run cap, so an hour crowded with dormant accounts
	// cannot push an active one out of its slot. A failed lookup keeps the old
	// behaviour for the push (everyone planned) and narrates nobody ahead of
	// time - a missed morning is worse than a missed pre-warm, and on-demand
	// audio still covers anyone who opens the day.
	const recentActivity = await loadRecentActivity(
		planned.map((audience) => audience.userId),
		now,
	);
	const { active, inactive } = recentActivity
		? splitByActivity(planned, recentActivity, now, PUSH_ACTIVITY_WINDOW_MS)
		: { active: planned, inactive: [] };
	const dueUsers = active.slice(0, MAX_USERS_PER_RUN);
	const consented = await loadAiConsented(dueUsers.map((user) => user.userId));
	const generationSignal = AbortSignal.timeout(DAILY_CROSS_GENERATION_BUDGET_MS);
	// Sol/xhigh selection plus Sol/high writing is intentionally more expensive
	// than the old single utility call. Start the capped due cohort together and
	// give every call one shared abort deadline; serial waves cannot fit inside
	// the platform limit, while the hard 50-user cap bounds the provider burst.
	const prepared = await mapWithConcurrency(dueUsers, DAILY_CROSS_CONCURRENCY, async ({ userId, recipients }) => {
		try {
			// A day already generated on demand (the user opened the Daily Cross
			// screen before their notify hour) is reused, not regenerated — one
			// guided day per user per day, whoever asks first.
			const existing = await findTodayCross(userId);
			// Personal context only with consent on record; otherwise the day
			// is chosen and written from Scripture alone.
			const personalContext = consented.has(userId);
			const cross =
				existing ?? (await generateDailyCross(userId, { abortSignal: generationSignal, personalContext }));
			if (!existing) await storeDailyCross(userId, cross);

			// Pre-warm the day's welcome-screen questions now that the new cross
			// exists for them to build on, so the first app open never waits on a
			// model call. Best-effort: the morning push must not depend on it.
			// The questions are built from the same study context, so they wait
			// for consent too; the welcome screen asks for them on open.
			if (!existing && personalContext && !generationSignal.aborted) {
				await refreshSuggestedQuestions(userId, { abortSignal: generationSignal }).catch((error) => {
					console.error(`[cron/verse-of-day] Suggested-questions refresh failed for ${userId}:`, error);
				});
			}

			const reference = `${cross.book} ${cross.chapter}:${cross.verse}`;
			const push: PendingPush = {
				recipients: recipients.map((recipient) => {
					const row = tokenRows.get(recipient.tokenId);
					return row ? recipientFromRow(row) : recipient;
				}),
				title: "✝ Pick up your cross",
				// subtitle renders on iOS only; Android carries the reference
				// inside the body instead.
				subtitle: reference,
				// Lead with the Scripture itself - the AI's why-line waits on
				// the Daily Cross screen the tap opens.
				body: `“${trayVerse(cross.text)}” - ${reference}`,
				data: { screen: "cross", book: cross.book, chapter: cross.chapter, verse: cross.verse },
				// The app's heads-up channel; clients older than 1.17.0 lack it
				// and fall back to a default channel - the push still displays.
				channelId: DAILY_CROSS_CHANNEL_ID,
			};
			return { ok: true as const, pushes: [push] };
		} catch (error) {
			console.error(`[cron/verse-of-day] Failed user ${userId}:`, error);
			return { ok: false as const, pushes: [] as PendingPush[] };
		}
	});
	const pending = prepared.flatMap((result) => result.pushes);
	const sent = prepared.filter((result) => result.ok).length;
	const failed = prepared.length - sent;

	const deactivatedTokens = await sendPushMessages(pending, "cron/verse-of-day");

	// Narration is requested explicitly by the reader, never by the cron.
	return NextResponse.json({
		plannedUsers: planned.length,
		skippedInactiveUsers: inactive.length,
		activityCheck: recentActivity ? "ok" : "failed",
		dueUsers: dueUsers.length,
		sent,
		failed,
		pushesQueued: pending.length,
		deactivatedTokens,
	});
}

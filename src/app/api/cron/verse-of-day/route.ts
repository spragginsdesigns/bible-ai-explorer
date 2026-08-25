import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findTodayCross, generateDailyCross, storeDailyCross } from "@/lib/daily-cross";
import { refreshSuggestedQuestions } from "@/lib/suggested-questions";
import { sendExpoPushMessages, type PendingPush } from "@/lib/push";

// Loops over users with a per-user AI call and a push send; needs the full
// function budget. Node runtime is required (Prisma + fs for the KJV corpus).
export const maxDuration = 300;

const MAX_USERS_PER_RUN = 50;
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
 * Hourly cron: every registered push token carries its timezone and preferred
 * local hour, so each run serves the users whose local time just reached their
 * notify hour. One verse per user per run, even with several devices.
 */
export async function GET(request: Request) {
	const expected = process.env.CRON_SECRET;
	if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const now = new Date();
	const enabledTokens = await prisma.pushToken.findMany({ where: { enabled: true } });
	const dueTokens = enabledTokens.filter((token) => localHour(token.timezone, now) === token.notifyHour);

	const tokensByUser = new Map<string, typeof dueTokens>();
	for (const token of dueTokens) {
		const list = tokensByUser.get(token.userId) ?? [];
		list.push(token);
		tokensByUser.set(token.userId, list);
	}

	const dueUsers = Array.from(tokensByUser.entries()).slice(0, MAX_USERS_PER_RUN);
	const pending: PendingPush[] = [];
	let sent = 0;
	let failed = 0;

	// Sequential on purpose: each iteration is one cheap AI call plus a few
	// reads, and the per-run cap keeps the whole loop within the function limit.
	for (const [userId, tokens] of dueUsers) {
		try {
			// A day already generated on demand (the user opened the Daily Cross
			// screen before their notify hour) is reused, not regenerated — one
			// guided day per user per day, whoever asks first.
			const existing = await findTodayCross(userId);
			const cross = existing ?? (await generateDailyCross(userId));
			if (!existing) await storeDailyCross(userId, cross);

			// Pre-warm the day's welcome-screen questions now that the new cross
			// exists for them to build on, so the first app open never waits on a
			// model call. Best-effort: the morning push must not depend on it.
			if (!existing) {
				await refreshSuggestedQuestions(userId).catch((error) => {
					console.error(`[cron/verse-of-day] Suggested-questions refresh failed for ${userId}:`, error);
				});
			}

			const reference = `${cross.book} ${cross.chapter}:${cross.verse}`;
			for (const token of tokens) {
				pending.push({
					tokenId: token.id,
					to: token.token,
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
				});
			}
			sent += 1;
		} catch (error) {
			failed += 1;
			console.error(`[cron/verse-of-day] Failed user ${userId}:`, error);
		}
	}

	const deactivatedTokens = await sendExpoPushMessages(pending, "cron/verse-of-day");

	return NextResponse.json({
		dueUsers: dueUsers.length,
		sent,
		failed,
		pushesQueued: pending.length,
		deactivatedTokens,
	});
}

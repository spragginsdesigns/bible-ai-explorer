import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findTodayCross, generateDailyCross, storeDailyCross } from "@/lib/daily-cross";
import { getOrCreateDailyCrossAudio } from "@/lib/daily-cross-audio";
import { refreshSuggestedQuestions } from "@/lib/suggested-questions";
import { sendExpoPushMessages, type PendingPush } from "@/lib/push";

// Loops over users with a per-user AI call and a push send; needs the full
// function budget. Node runtime is required (Prisma + fs for the KJV corpus).
export const maxDuration = 300;

const MAX_USERS_PER_RUN = 50;
const DAILY_CROSS_CHANNEL_ID = "daily-cross";

/**
 * How many narrations one run may make. Only SureWord Pro accounts are
 * eligible and each is billed per character, so this is the ceiling on what a
 * single hour can cost - not a throughput target.
 */
const MAX_AUDIO_PER_RUN = 60;

/**
 * Wall-clock budget for the audio pass, measured from the start of the
 * request. A narration takes ~30-60s and `maxDuration` is 300s, so the pass
 * stops well before the platform kills the function - a run that gets through
 * four devotionals and defers the rest is a good run; a run that is killed
 * mid-write is not. Whoever is skipped is picked up the moment they open the
 * screen, because the on-demand path schedules audio too.
 */
const AUDIO_BUDGET_MS = 240_000;

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

	// Narrate AFTER the pushes are away, never before: a spoken devotional is a
	// slow, billable extra, and nobody should lose their morning notification
	// because one narration was hanging. Sequential, capped, and bounded by the
	// clock - see MAX_AUDIO_PER_RUN / AUDIO_BUDGET_MS.
	const audio = { generated: 0, skipped: 0, failed: 0 };
	for (const [userId] of dueUsers) {
		if (audio.generated >= MAX_AUDIO_PER_RUN || Date.now() - now.getTime() > AUDIO_BUDGET_MS) {
			audio.skipped += 1;
			continue;
		}
		try {
			// Idempotent: a ready row, a pending row under three minutes old, a free
			// account and an unconfigured deployment all return without spending
			// anything, so this is one narration per user per day at most.
			const result = await getOrCreateDailyCrossAudio(userId);
			if (result.status === "ready") audio.generated += 1;
			else if (result.status === "failed") audio.failed += 1;
			else audio.skipped += 1;
		} catch (error) {
			audio.failed += 1;
			console.error(`[cron/verse-of-day] Audio failed for user ${userId}:`, error);
		}
	}
	if (audio.skipped > 0) {
		console.log(
			`[cron/verse-of-day] Audio: ${audio.generated} generated, ${audio.skipped} skipped (locked, unconfigured, already made, or out of budget), ${audio.failed} failed`
		);
	}

	return NextResponse.json({
		dueUsers: dueUsers.length,
		sent,
		failed,
		pushesQueued: pending.length,
		deactivatedTokens,
		audio,
	});
}

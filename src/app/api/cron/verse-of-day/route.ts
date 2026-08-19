import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findTodayCross, generateDailyCross, storeDailyCross } from "@/lib/daily-cross";

// Loops over users with a per-user AI call and a push send; needs the full
// function budget. Node runtime is required (Prisma + fs for the KJV corpus).
export const maxDuration = 300;

const MAX_USERS_PER_RUN = 50;
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_PUSH_CHUNK_SIZE = 100;

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

interface PendingPush {
	tokenId: string;
	to: string;
	title: string;
	subtitle: string;
	body: string;
	data: { screen: "cross"; book: string; chapter: number; verse: number };
}

/**
 * Keep very long verses tray-friendly (the longest KJV verse runs ~430
 * characters); the full text is one tap away on the Daily Cross screen.
 */
function trayVerse(text: string, max = 240): string {
	return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

interface ExpoPushTicket {
	status: "ok" | "error";
	details?: { error?: string };
}

/**
 * Send the queued messages through the Expo push API in chunks and retire
 * tokens Expo reports as DeviceNotRegistered. Returns how many tokens were
 * deactivated.
 */
async function sendPushMessages(messages: PendingPush[]): Promise<number> {
	let deactivated = 0;

	for (let start = 0; start < messages.length; start += EXPO_PUSH_CHUNK_SIZE) {
		const chunk = messages.slice(start, start + EXPO_PUSH_CHUNK_SIZE);
		try {
			const response = await fetch(EXPO_PUSH_URL, {
				method: "POST",
				headers: { "Content-Type": "application/json", Accept: "application/json" },
				body: JSON.stringify(
					chunk.map((message) => ({
						to: message.to,
						title: message.title,
						// subtitle renders on iOS only; Android carries the
						// reference inside the body instead.
						subtitle: message.subtitle,
						body: message.body,
						data: message.data,
						// High priority so FCM delivers during Doze instead of
						// holding the morning verse until a maintenance window;
						// channelId routes it to the app's heads-up channel
						// (clients older than 1.17.0 lack it and fall back to a
						// default channel — the notification still displays).
						priority: "high",
						channelId: "daily-cross",
					}))
				),
			});
			if (!response.ok) {
				console.error(`[cron/verse-of-day] Expo push API answered ${response.status}.`);
				continue;
			}

			const receipt = (await response.json()) as { data?: ExpoPushTicket[] };
			const tickets = Array.isArray(receipt.data) ? receipt.data : [];
			for (let index = 0; index < tickets.length; index++) {
				const ticket = tickets[index];
				if (ticket?.status !== "error") continue;
				if (ticket.details?.error === "DeviceNotRegistered") {
					await prisma.pushToken.delete({ where: { id: chunk[index].tokenId } }).catch(() => {});
					deactivated += 1;
				} else {
					// Non-fatal ticket errors (InvalidCredentials, rate limits, …)
					// must be visible in logs; today they would vanish silently.
					console.error(`[cron/verse-of-day] Push ticket error:`, ticket.details ?? ticket);
				}
			}
		} catch (error) {
			console.error("[cron/verse-of-day] Expo push send failed:", error);
		}
	}

	return deactivated;
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

			const reference = `${cross.book} ${cross.chapter}:${cross.verse}`;
			for (const token of tokens) {
				pending.push({
					tokenId: token.id,
					to: token.token,
					title: "✝ Pick up your cross",
					subtitle: reference,
					// Lead with the Scripture itself — the AI's why-line waits on
					// the Daily Cross screen the tap opens.
					body: `“${trayVerse(cross.text)}” — ${reference}`,
					data: { screen: "cross", book: cross.book, chapter: cross.chapter, verse: cross.verse },
				});
			}
			sent += 1;
		} catch (error) {
			failed += 1;
			console.error(`[cron/verse-of-day] Failed user ${userId}:`, error);
		}
	}

	const deactivatedTokens = await sendPushMessages(pending);

	return NextResponse.json({
		dueUsers: dueUsers.length,
		sent,
		failed,
		pushesQueued: pending.length,
		deactivatedTokens,
	});
}

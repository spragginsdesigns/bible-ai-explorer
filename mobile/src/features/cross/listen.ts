import type { DailyCrossAudio } from "@/features/notifications/api";

/**
 * Pure state rules for "Listen" - today's spoken devotional. Kept out of the
 * component so the things that are easy to get wrong (which of five states the
 * card is in, and how the speed chip cycles) can be tested directly.
 *
 * Mirrors src/components/cross/listen.ts on web.
 */

/** How often to re-ask the server while a devotional is being prepared. */
export const LISTEN_POLL_INTERVAL_MS = 3_000;

/**
 * Preparing takes ~30-60s. Past this the card stops polling and offers a retry
 * rather than shimmering forever at someone whose generation quietly died.
 */
export const LISTEN_POLL_TIMEOUT_MS = 4 * 60 * 1000;

/**
 * A signed audio URL lives 24 hours, but the tab or screen holding it may have
 * been open far longer than the listen. When playback errors out on a URL this
 * old, the card re-fetches once and resumes rather than accusing the user's
 * connection - a URL fetched moments ago that fails is a real failure.
 */
export const LISTEN_URL_STALE_AFTER_MS = 10 * 60 * 1000;

export type ListenPhase = "hidden" | "locked" | "preparing" | "ready" | "failed";

/**
 * What the card should show.
 *
 * There is no "idle" phase any more. Nothing is generated on a tap: the day
 * and its narration are made together, so by the time this card is on screen
 * the devotional is ready, being made, or has failed. Both clients mount it
 * only inside a loaded day, which is why "none" - and a null payload before
 * the first poll answers - read as "being made" rather than "nothing here".
 */
export function listenPhase(audio: DailyCrossAudio | null): ListenPhase {
	// A server that cannot narrate must offer nothing at all - not even for a
	// Pro account. This outranks every other status.
	if (audio?.status === "unavailable") return "hidden";
	// A locked benefit stays visible; hiding it would sell nothing and explain
	// nothing. Outranks the rest: a free account has no audio to be in.
	if (audio?.status === "locked") return "locked";
	if (audio?.status === "ready" && audio.url) return "ready";
	if (audio?.status === "failed") return "failed";
	// "pending", "none" before the scheduled generation has claimed the row, a
	// ready row with no URL, or nothing fetched yet.
	return "preparing";
}

/** Whether the card should keep polling the server in this phase. */
export function shouldPollListen(phase: ListenPhase): boolean {
	return phase === "preparing";
}

/**
 * Whether a playback error is worth one silent retry with a freshly signed URL
 * instead of a failure card. `urlFetchedAt` is when the client received the
 * URL, and `alreadyRetried` stops a genuinely dead blob looping forever.
 */
export function shouldRefreshListenUrl(
	urlFetchedAt: number | null,
	alreadyRetried: boolean,
	now: number = Date.now()
): boolean {
	if (alreadyRetried || urlFetchedAt === null) return false;
	return now - urlFetchedAt >= LISTEN_URL_STALE_AFTER_MS;
}

/** Seconds as m:ss (or h:mm:ss past an hour), for elapsed / total readouts. */
export function formatClock(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
	const whole = Math.floor(seconds);
	const hours = Math.floor(whole / 3600);
	const minutes = Math.floor((whole % 3600) / 60);
	const secs = whole % 60;
	const padded = String(secs).padStart(2, "0");
	if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${padded}`;
	return `${minutes}:${padded}`;
}

/**
 * Playback speeds offered on the Listen card, in cycle order. 1x sits second
 * so the chip a listener taps most often is one tap from the slowest and one
 * from the faster half; going past 2x makes a devotional unintelligible rather
 * than efficient.
 */
export const LISTEN_RATES = [0.75, 1, 1.25, 1.5, 2] as const;

export const DEFAULT_LISTEN_RATE = 1;

/** localStorage key on web; the Android settings store holds the same value. */
export const LISTEN_RATE_PREF_KEY = "sureword.listenRate";

/**
 * The next speed in the cycle. An unrecognised current rate (a hand-edited
 * preference, an older build's value) restarts at the top rather than falling
 * out of the cycle.
 */
export function nextListenRate(rate: number): number {
	const index = LISTEN_RATES.findIndex((candidate) => candidate === rate);
	return LISTEN_RATES[(index + 1) % LISTEN_RATES.length];
}

/** A stored or incoming rate, or the default when it is not one we offer. */
export function normalizeListenRate(rate: unknown): number {
	const value = typeof rate === "string" ? Number(rate) : rate;
	return typeof value === "number" &&
		LISTEN_RATES.includes(value as (typeof LISTEN_RATES)[number])
		? value
		: DEFAULT_LISTEN_RATE;
}

/**
 * The speed as a chip label: "1x", "0.75x". Never rounded - a label that
 * disagreed with the speed would be telling the listener the wrong thing.
 */
export function formatListenRate(rate: number): string {
	return `${rate}x`;
}

/**
 * Playback progress as 0-1. The player's own duration wins once it has loaded
 * the file; the server's word-count estimate fills the bar in until then.
 */
export function listenProgress(currentTime: number, duration: number): number {
	if (!Number.isFinite(duration) || duration <= 0) return 0;
	if (!Number.isFinite(currentTime) || currentTime <= 0) return 0;
	return Math.min(1, currentTime / duration);
}

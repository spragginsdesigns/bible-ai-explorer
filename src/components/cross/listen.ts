/**
 * Pure state rules for "Listen" - today's spoken devotional. Kept out of the
 * component so the one thing that is easy to get wrong (what the card shows
 * between tapping play and the audio existing) can be tested directly.
 *
 * Mirrors mobile/src/features/cross/listen.ts, minus its `listenProgress`:
 * web's `<input type="range">` fills its own track, where Android draws the
 * rail by hand and needs the fraction.
 */

/** How the server describes today's spoken devotional. */
export type DailyCrossAudioStatus = "none" | "pending" | "ready" | "failed";

/** Today's spoken devotional, as served by /api/verse-of-day/audio. */
export interface DailyCrossAudio {
	status: DailyCrossAudioStatus;
	/** Short-lived signed URL; only present while status is "ready". */
	url: string | null;
	title: string | null;
	/** The narrated text, for "Read along". */
	script: string | null;
	durationSec: number | null;
	generatedAt: string | null;
}

/** How often to re-ask the server while a devotional is being prepared. */
export const LISTEN_POLL_INTERVAL_MS = 3_000;

/**
 * Preparing takes ~30-60s. Past this the card stops polling and offers a retry
 * rather than shimmering forever at someone whose generation quietly died.
 */
export const LISTEN_POLL_TIMEOUT_MS = 4 * 60 * 1000;

export type ListenPhase = "idle" | "preparing" | "ready" | "failed";

/**
 * What the card should show. `requested` is true once the user has tapped play
 * in this session: it is what turns "no audio yet" from an invitation into a
 * wait, before the server has answered even once.
 */
export function listenPhase(audio: DailyCrossAudio | null, requested: boolean): ListenPhase {
	if (audio?.status === "ready" && audio.url) return "ready";
	if (audio?.status === "pending") return "preparing";
	if (audio?.status === "failed") return "failed";
	// "none", a ready row with no URL, or nothing fetched yet.
	return requested ? "preparing" : "idle";
}

/** Whether the card should keep polling the server in this phase. */
export function shouldPollListen(phase: ListenPhase): boolean {
	return phase === "preparing";
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

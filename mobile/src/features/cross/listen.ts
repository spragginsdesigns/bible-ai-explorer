import type { DailyCrossAudio } from "@/features/notifications/api";

/**
 * Pure state rules for "Listen" - today's spoken devotional. Kept out of the
 * component so the one thing that is easy to get wrong (what the card shows
 * between tapping play and the audio existing) can be tested directly.
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

/**
 * Playback progress as 0-1. The player's own duration wins once it has loaded
 * the file; the server's word-count estimate fills the bar in until then.
 */
export function listenProgress(currentTime: number, duration: number): number {
	if (!Number.isFinite(duration) || duration <= 0) return 0;
	if (!Number.isFinite(currentTime) || currentTime <= 0) return 0;
	return Math.min(1, currentTime / duration);
}

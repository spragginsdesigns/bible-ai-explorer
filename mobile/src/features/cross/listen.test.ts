import { describe, expect, it } from "vitest";
import type { DailyCrossAudio } from "@/features/notifications/api";
import {
	DEFAULT_LISTEN_RATE,
	LISTEN_RATES,
	LISTEN_URL_STALE_AFTER_MS,
	formatClock,
	formatListenRate,
	listenPhase,
	listenProgress,
	nextListenRate,
	normalizeListenRate,
	shouldPollListen,
	shouldRefreshListenUrl,
} from "./listen";

function audio(overrides: Partial<DailyCrossAudio>): DailyCrossAudio {
	return {
		status: "none",
		url: null,
		streamUrl: null,
		title: null,
		script: null,
		durationSec: null,
		generatedAt: null,
		plan: "pro",
		...overrides,
	};
}

describe("listenPhase", () => {
	it("waits by default - the devotional is made with the day, not on a tap", () => {
		// Nothing here is an invitation any more: a card on screen means a day
		// exists, and a day always schedules its narration.
		expect(listenPhase(null)).toBe("preparing");
		expect(listenPhase(audio({ status: "none" }))).toBe("preparing");
		expect(listenPhase(audio({ status: "pending" }))).toBe("preparing");
	});

	it("follows the server once it reports", () => {
		expect(listenPhase(audio({ status: "failed" }))).toBe("failed");
		expect(listenPhase(audio({ status: "ready", url: "https://blob/x.mp3" }))).toBe("ready");
	});

	it("does not call a ready row playable without a URL", () => {
		expect(listenPhase(audio({ status: "ready", url: null }))).toBe("preparing");
	});

	it("hides the card outright when the server cannot narrate", () => {
		// No ELEVENLABS_API_KEY: no card at all, never a button that can only
		// fail. Outranks every other status, Pro included.
		expect(listenPhase(audio({ status: "unavailable" }))).toBe("hidden");
		expect(listenPhase(audio({ status: "unavailable", plan: "pro" }))).toBe("hidden");
	});

	it("shows a free account the Pro panel rather than hiding the benefit", () => {
		expect(listenPhase(audio({ status: "locked", plan: "free" }))).toBe("locked");
	});

	it("polls only while preparing", () => {
		expect(shouldPollListen("preparing")).toBe(true);
		expect(shouldPollListen("ready")).toBe(false);
		expect(shouldPollListen("failed")).toBe(false);
		expect(shouldPollListen("hidden")).toBe(false);
		// A locked card must never poll - it would be a request per three
		// seconds, forever, for an answer that cannot change.
		expect(shouldPollListen("locked")).toBe(false);
	});
});

describe("playback speed", () => {
	it("cycles through every offered rate and wraps", () => {
		const seen = [DEFAULT_LISTEN_RATE];
		for (let step = 0; step < LISTEN_RATES.length - 1; step++) {
			seen.push(nextListenRate(seen[seen.length - 1]));
		}
		expect(new Set(seen).size).toBe(LISTEN_RATES.length);
		expect(nextListenRate(seen[seen.length - 1])).toBe(DEFAULT_LISTEN_RATE);
	});

	it("restarts the cycle from a rate this build no longer offers", () => {
		expect(LISTEN_RATES).toContain(nextListenRate(3.5));
	});

	it("normalizes anything stored, including the string localStorage returns", () => {
		expect(normalizeListenRate("1.5")).toBe(1.5);
		expect(normalizeListenRate(1.5)).toBe(1.5);
		expect(normalizeListenRate("banana")).toBe(DEFAULT_LISTEN_RATE);
		expect(normalizeListenRate(null)).toBe(DEFAULT_LISTEN_RATE);
		expect(normalizeListenRate(undefined)).toBe(DEFAULT_LISTEN_RATE);
		// A rate we do not offer must not reach the player.
		expect(normalizeListenRate(4)).toBe(DEFAULT_LISTEN_RATE);
	});

	it("labels the speed exactly, never rounded", () => {
		expect(formatListenRate(1)).toBe("1x");
		expect(formatListenRate(0.75)).toBe("0.75x");
		expect(formatListenRate(1.25)).toBe("1.25x");
	});
});

describe("shouldRefreshListenUrl", () => {
	const now = Date.UTC(2026, 7, 26, 12, 0, 0);

	it("re-signs once for a URL old enough to have expired", () => {
		expect(shouldRefreshListenUrl(now - LISTEN_URL_STALE_AFTER_MS - 1, false, now)).toBe(true);
	});

	it("does not loop on a blob that is genuinely gone", () => {
		expect(shouldRefreshListenUrl(now - LISTEN_URL_STALE_AFTER_MS - 1, true, now)).toBe(false);
	});

	it("treats a fresh URL failing as a real failure", () => {
		expect(shouldRefreshListenUrl(now - 30_000, false, now)).toBe(false);
		expect(shouldRefreshListenUrl(null, false, now)).toBe(false);
	});
});

describe("formatClock", () => {
	it("reads as a player clock", () => {
		expect(formatClock(0)).toBe("0:00");
		expect(formatClock(9)).toBe("0:09");
		expect(formatClock(75)).toBe("1:15");
		expect(formatClock(3600)).toBe("1:00:00");
		expect(formatClock(3725)).toBe("1:02:05");
	});

	it("never shows NaN or a negative position", () => {
		expect(formatClock(Number.NaN)).toBe("0:00");
		expect(formatClock(-4)).toBe("0:00");
		expect(formatClock(Number.POSITIVE_INFINITY)).toBe("0:00");
	});
});

describe("listenProgress", () => {
	it("is a clamped fraction", () => {
		expect(listenProgress(30, 120)).toBe(0.25);
		expect(listenProgress(200, 120)).toBe(1);
		expect(listenProgress(-5, 120)).toBe(0);
	});

	it("is zero before a duration is known", () => {
		expect(listenProgress(10, 0)).toBe(0);
		expect(listenProgress(10, Number.NaN)).toBe(0);
	});
});

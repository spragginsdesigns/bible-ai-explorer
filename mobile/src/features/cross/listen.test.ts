import { describe, expect, it } from "vitest";
import type { DailyCrossAudio } from "@/features/notifications/api";
import {
	LISTEN_URL_STALE_AFTER_MS,
	formatClock,
	listenPhase,
	listenProgress,
	shouldPollListen,
	shouldRefreshListenUrl,
} from "./listen";

function audio(overrides: Partial<DailyCrossAudio>): DailyCrossAudio {
	return {
		status: "none",
		url: null,
		title: null,
		script: null,
		durationSec: null,
		generatedAt: null,
		...overrides,
	};
}

describe("listenPhase", () => {
	it("invites before the user has asked for anything", () => {
		expect(listenPhase(null, false)).toBe("idle");
		expect(listenPhase(audio({ status: "none" }), false)).toBe("idle");
	});

	it("waits as soon as the user taps, before the server has answered", () => {
		expect(listenPhase(null, true)).toBe("preparing");
		expect(listenPhase(audio({ status: "none" }), true)).toBe("preparing");
	});

	it("follows the server once it reports", () => {
		expect(listenPhase(audio({ status: "pending" }), true)).toBe("preparing");
		expect(listenPhase(audio({ status: "failed" }), true)).toBe("failed");
		expect(
			listenPhase(audio({ status: "ready", url: "https://blob/x.mp3" }), false)
		).toBe("ready");
	});

	it("does not call a ready row playable without a URL", () => {
		expect(listenPhase(audio({ status: "ready", url: null }), true)).toBe("preparing");
		expect(listenPhase(audio({ status: "ready", url: null }), false)).toBe("idle");
	});

	it("hides the card outright when the server cannot narrate", () => {
		// What production serves until ELEVENLABS_API_KEY is set: no card at all,
		// never a button that can only fail. A tap cannot conjure credentials.
		expect(listenPhase(audio({ status: "unavailable" }), false)).toBe("hidden");
		expect(listenPhase(audio({ status: "unavailable" }), true)).toBe("hidden");
	});

	it("polls only while preparing", () => {
		expect(shouldPollListen("preparing")).toBe(true);
		expect(shouldPollListen("idle")).toBe(false);
		expect(shouldPollListen("ready")).toBe(false);
		expect(shouldPollListen("failed")).toBe(false);
		expect(shouldPollListen("hidden")).toBe(false);
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

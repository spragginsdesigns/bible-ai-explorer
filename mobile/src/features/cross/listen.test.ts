import { describe, expect, it } from "vitest";
import type { DailyCrossAudio } from "@/features/notifications/api";
import { formatClock, listenPhase, listenProgress, shouldPollListen } from "./listen";

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

	it("polls only while preparing", () => {
		expect(shouldPollListen("preparing")).toBe(true);
		expect(shouldPollListen("idle")).toBe(false);
		expect(shouldPollListen("ready")).toBe(false);
		expect(shouldPollListen("failed")).toBe(false);
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

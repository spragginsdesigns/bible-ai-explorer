import { beforeEach, describe, expect, it } from "vitest";
import {
	markLaunchAnimationStartedThisSession,
	recordLaunchAppState,
	resetLaunchAnimationSessionForTests,
	shouldShowLaunchAnimationThisSession,
} from "./launchAnimationSession";

describe("Android launch animation session", () => {
	beforeEach(() => resetLaunchAnimationSessionForTests());

	it("plays once for a fresh JavaScript process", () => {
		expect(shouldShowLaunchAnimationThisSession()).toBe(true);
	});

	it("stays dismissed across later root mounts in the same process", () => {
		markLaunchAnimationStartedThisSession();

		expect(shouldShowLaunchAnimationThisSession()).toBe(false);
		expect(shouldShowLaunchAnimationThisSession()).toBe(false);
	});

	it("replays once when returning from a real background through inactive", () => {
		markLaunchAnimationStartedThisSession();
		expect(recordLaunchAppState("background")).toBe(false);
		expect(recordLaunchAppState("inactive")).toBe(false);
		expect(recordLaunchAppState("active")).toBe(true);
		expect(recordLaunchAppState("active")).toBe(false);
	});

	it("does not replay for permission dialogs or duplicate active events", () => {
		expect(recordLaunchAppState("inactive")).toBe(false);
		expect(recordLaunchAppState("active")).toBe(false);
		expect(recordLaunchAppState("active")).toBe(false);
	});
});

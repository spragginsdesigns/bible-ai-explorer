import { beforeEach, describe, expect, it } from "vitest";
import {
	markLaunchAnimationStartedThisSession,
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
});

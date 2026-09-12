import { describe, expect, it } from "vitest";
import {
	shouldRequestPermission,
	signalNotificationPermissionMoment,
	subscribePermissionTriggers,
	type PermissionDecisionInput,
	type PermissionTrigger,
} from "./permissionPrompt";

const notGranted = { granted: false, canAskAgain: true };
const defaults = { enabled: true, chatReplies: true };

function decide(overrides: Partial<PermissionDecisionInput>): boolean {
	return shouldRequestPermission({
		settings: defaults,
		asked: false,
		osStatus: notGranted,
		trigger: "first-answer",
		...overrides,
	});
}

describe("shouldRequestPermission", () => {
	it("never asks when the OS already granted, whatever the trigger", () => {
		const triggers: PermissionTrigger[] = ["first-answer", "cross-visit", "settings-enabled"];
		for (const trigger of triggers) {
			expect(decide({ trigger, osStatus: { granted: true, canAskAgain: true } })).toBe(false);
		}
	});

	it("asks on the first settled chat answer", () => {
		expect(decide({ trigger: "first-answer" })).toBe(true);
	});

	it("asks on the first Pick Up Your Cross visit", () => {
		expect(decide({ trigger: "cross-visit" })).toBe(true);
	});

	it("does not ask again once this install has shown the dialog", () => {
		expect(decide({ trigger: "first-answer", asked: true })).toBe(false);
		expect(decide({ trigger: "cross-visit", asked: true })).toBe(false);
	});

	it("asks when the user switches notifications on in Settings, even after a prior ask", () => {
		expect(decide({ trigger: "settings-enabled", asked: true })).toBe(true);
		expect(
			decide({
				trigger: "settings-enabled",
				asked: true,
				osStatus: { granted: false, canAskAgain: false },
			})
		).toBe(true);
	});

	it("does not ask on a passive moment when both push streams are off", () => {
		expect(
			decide({ trigger: "cross-visit", settings: { enabled: false, chatReplies: false } })
		).toBe(false);
		expect(
			decide({ trigger: "first-answer", settings: { enabled: false, chatReplies: true } })
		).toBe(true);
	});

	it("does not ask on a passive moment the OS would silently refuse", () => {
		expect(decide({ trigger: "cross-visit", osStatus: { granted: false, canAskAgain: false } })).toBe(
			false
		);
	});
});

describe("permission trigger bus", () => {
	it("holds a trigger fired before the listener subscribes, then delivers it once", () => {
		signalNotificationPermissionMoment("cross-visit");
		const received: PermissionTrigger[] = [];
		const unsubscribe = subscribePermissionTriggers((trigger) => received.push(trigger));
		expect(received).toEqual(["cross-visit"]);

		signalNotificationPermissionMoment("first-answer");
		expect(received).toEqual(["cross-visit", "first-answer"]);
		unsubscribe();

		const later: PermissionTrigger[] = [];
		const unsubscribeLater = subscribePermissionTriggers((trigger) => later.push(trigger));
		expect(later).toEqual([]);
		unsubscribeLater();
	});

	it("keeps a queued Settings request over a later passive moment", () => {
		signalNotificationPermissionMoment("settings-enabled");
		signalNotificationPermissionMoment("first-answer");
		const received: PermissionTrigger[] = [];
		const unsubscribe = subscribePermissionTriggers((trigger) => received.push(trigger));
		expect(received).toEqual(["settings-enabled"]);
		unsubscribe();
	});
});

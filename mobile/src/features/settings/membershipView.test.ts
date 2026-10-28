import { describe, expect, it } from "vitest";
import { canOfferPlayUpgrade, externalManagementLine, subscriptionStatusLine } from "./membershipView";

const fmt = (date: Date) => date.toISOString().slice(0, 10);
const periodEnd = "2026-11-27T00:00:00.000Z";

describe("subscriptionStatusLine", () => {
	it("says nothing without a subscription", () => {
		expect(subscriptionStatusLine("free", null, fmt)).toBeNull();
		expect(subscriptionStatusLine("pro", undefined, fmt)).toBeNull();
	});

	it("names the renewal date for an active Pro subscription", () => {
		expect(subscriptionStatusLine("pro", { status: "active", periodEnd, cancelAtPeriodEnd: false }, fmt)).toBe(
			"Current billing period ends 2026-11-27.",
		);
	});

	it("says when paid access ends after a cancel", () => {
		expect(subscriptionStatusLine("pro", { status: "active", periodEnd, cancelAtPeriodEnd: true }, fmt)).toBe(
			"Paid access ends 2026-11-27.",
		);
	});

	it("explains a failed payment before a lapse", () => {
		expect(subscriptionStatusLine("free", { status: "past_due", periodEnd }, fmt)).toBe(
			"Your last payment did not go through. Update your payment method to restore Pro.",
		);
	});

	it("says when a lapsed subscription ended", () => {
		expect(subscriptionStatusLine("free", { status: "canceled", periodEnd }, fmt)).toBe("Paid access ended 2026-11-27.");
	});

	it("drops an unreadable date instead of printing Invalid Date", () => {
		expect(subscriptionStatusLine("pro", { status: "active", periodEnd: "nope" }, fmt)).toBeNull();
	});
});

describe("externalManagementLine", () => {
	it("points App Store and web subscribers to where they bought", () => {
		expect(externalManagementLine("pro", { provider: "app_store" })).toContain("Apple ID settings");
		expect(externalManagementLine("pro", { provider: "stripe" })).toContain("sureword.app");
	});

	it("leaves Google Play to its own link", () => {
		expect(externalManagementLine("pro", { provider: "google-play" })).toBeNull();
	});

	it("never points a lapsed subscriber at another store", () => {
		expect(externalManagementLine("free", { provider: "stripe", status: "canceled" })).toBeNull();
		expect(externalManagementLine("free", { provider: "stripe", status: "past_due" })).toContain("sureword.app");
	});
});

describe("canOfferPlayUpgrade", () => {
	const free = { plan: "free" as const, owner: false, playCheckoutAvailable: true };

	it("offers Pro to a Free Android reader when Play checkout is on", () => {
		expect(canOfferPlayUpgrade("android", free)).toBe(true);
	});

	it("never offers it without Play checkout, to Pro, to the owner, or off Android", () => {
		expect(canOfferPlayUpgrade("android", { ...free, playCheckoutAvailable: false })).toBe(false);
		expect(canOfferPlayUpgrade("android", { plan: "free", owner: false })).toBe(false);
		expect(canOfferPlayUpgrade("android", { ...free, plan: "pro" })).toBe(false);
		expect(canOfferPlayUpgrade("android", { ...free, owner: true })).toBe(false);
		expect(canOfferPlayUpgrade("ios", free)).toBe(false);
		expect(canOfferPlayUpgrade("android", null)).toBe(false);
	});
});

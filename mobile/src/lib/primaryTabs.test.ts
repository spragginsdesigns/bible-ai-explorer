import { describe, expect, it } from "vitest";
import { isPrimaryTabRoute, PRIMARY_TAB_ROUTES } from "@/lib/primaryTabs";

describe("primary tab routes", () => {
	it("orders the five destinations around the daily walk", () => {
		expect(PRIMARY_TAB_ROUTES).toEqual(["today", "bible", "index", "connections", "study"]);
	});

	it.each(["settings", "memories", "sign-in", "notes"])(
		"keeps push-only route %s out of the tab bar",
		(route) => {
			expect(isPrimaryTabRoute(route)).toBe(false);
		},
	);
});

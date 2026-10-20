import { describe, expect, it } from "vitest";
import { isPrimaryTabRoute, PRIMARY_TAB_ROUTES } from "@/lib/primaryTabs";

describe("primary tab routes", () => {
	it("renders only the four user-facing destinations", () => {
		expect(PRIMARY_TAB_ROUTES).toEqual(["index", "bible", "connections", "notes"]);
	});

	it.each(["settings", "memories", "sign-in"])(
		"keeps push-only route %s out of the tab bar",
		(route) => {
			expect(isPrimaryTabRoute(route)).toBe(false);
		},
	);
});

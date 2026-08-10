import { describe, expect, it } from "vitest";
import { formatRelativeDate } from "./format";

describe("formatRelativeDate", () => {
	it("returns empty string for invalid input", () => {
		expect(formatRelativeDate("not-a-date")).toBe("");
	});

	it("covers the minute/hour/day buckets", () => {
		const now = Date.now();
		expect(formatRelativeDate(new Date(now - 20_000).toISOString())).toBe("just now");
		expect(formatRelativeDate(new Date(now - 5 * 60_000).toISOString())).toBe("5m ago");
		expect(formatRelativeDate(new Date(now - 3 * 3_600_000).toISOString())).toBe("3h ago");
		expect(formatRelativeDate(new Date(now - 2 * 86_400_000).toISOString())).toBe("2d ago");
	});

	it("falls back to a locale date past a week", () => {
		const old = new Date(Date.now() - 30 * 86_400_000);
		expect(formatRelativeDate(old.toISOString())).toBe(old.toLocaleDateString());
	});
});

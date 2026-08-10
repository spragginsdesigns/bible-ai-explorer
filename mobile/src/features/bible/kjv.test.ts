import { describe, expect, it } from "vitest";
import { searchKjv } from "./kjv";

describe("searchKjv", () => {
	it("matches case-insensitively", () => {
		const lower = searchKjv("in the beginning", 5);
		const upper = searchKjv("IN THE BEGINNING", 5);
		expect(lower.length).toBeGreaterThan(0);
		expect(lower).toEqual(upper);
	});

	it("returns hits in canonical book/chapter/verse order", () => {
		const hits = searchKjv("God", 200);
		expect(hits.length).toBeGreaterThan(1);
		for (let i = 1; i < hits.length; i++) {
			const prev = hits[i - 1];
			const curr = hits[i];
			const before =
				prev.order < curr.order ||
				(prev.order === curr.order &&
					(prev.chapter < curr.chapter ||
						(prev.chapter === curr.chapter && prev.verse < curr.verse)));
			expect(before).toBe(true);
		}
	});

	it("finds a known verse with the right location and text", () => {
		const hits = searchKjv("For God so loved the world");
		expect(hits).toHaveLength(1);
		expect(hits[0].order).toBe(43);
		expect(hits[0].chapter).toBe(3);
		expect(hits[0].verse).toBe(16);
		expect(hits[0].text.toLowerCase()).toContain("for god so loved the world");
	});

	it("respects the limit", () => {
		expect(searchKjv("the", 7)).toHaveLength(7);
		expect(searchKjv("the").length).toBeLessThanOrEqual(100);
	});

	it("returns [] for empty or whitespace-only queries", () => {
		expect(searchKjv("")).toEqual([]);
		expect(searchKjv("   ")).toEqual([]);
	});
});

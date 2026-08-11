import { describe, expect, it } from "vitest";

import { CATEGORY_LABELS, groupMemoriesByCategory } from "./utils";
import type { MemoryRecord } from "./api";

function memory(id: string, category: string): MemoryRecord {
	return { id, content: `memory ${id}`, category, updatedAt: "2026-08-10T00:00:00Z" };
}

describe("CATEGORY_LABELS", () => {
	it("labels every canonical category", () => {
		expect(CATEGORY_LABELS.profile).toBe("Profile");
		expect(CATEGORY_LABELS.prayer).toBe("Prayer requests");
		expect(CATEGORY_LABELS.study).toBe("Study");
		expect(CATEGORY_LABELS.preference).toBe("Preferences");
		expect(CATEGORY_LABELS.general).toBe("General");
	});
});

describe("groupMemoriesByCategory", () => {
	it("returns an empty array when there is nothing to group", () => {
		expect(groupMemoriesByCategory([])).toEqual([]);
	});

	it("orders groups by the canonical category order, not input order", () => {
		const groups = groupMemoriesByCategory([
			memory("1", "general"),
			memory("2", "study"),
			memory("3", "profile"),
		]);
		expect(groups.map((group) => group.category)).toEqual(["profile", "study", "general"]);
	});

	it("keeps every memory inside its category bucket", () => {
		const groups = groupMemoriesByCategory([
			memory("1", "prayer"),
			memory("2", "prayer"),
			memory("3", "profile"),
		]);
		expect(groups[0].category).toBe("profile");
		expect(groups[0].items.map((item) => item.id)).toEqual(["3"]);
		expect(groups[1].category).toBe("prayer");
		expect(groups[1].items.map((item) => item.id)).toEqual(["1", "2"]);
	});

	it("omits categories with no memories", () => {
		const groups = groupMemoriesByCategory([memory("1", "study")]);
		expect(groups.map((group) => group.category)).toEqual(["study"]);
	});

	it("attaches the display label to each group", () => {
		const groups = groupMemoriesByCategory([memory("1", "prayer")]);
		expect(groups[0].label).toBe("Prayer requests");
	});

	it("folds unknown categories into General", () => {
		const groups = groupMemoriesByCategory([
			memory("1", "health"),
			memory("2", "general"),
		]);
		expect(groups).toHaveLength(1);
		expect(groups[0].category).toBe("general");
		expect(groups[0].items.map((item) => item.id)).toEqual(["1", "2"]);
	});
});

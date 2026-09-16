import { describe, expect, it } from "vitest";

import {
	CATEGORY_LABELS,
	groupMemoriesByCategory,
	prayerActionsFor,
	prayerAskedLabel,
	prayerStatusOf,
	PRAYER_RESOLVED_TAGS,
} from "./utils";
import type { MemoryRecord } from "./api";

function memory(id: string, category: string, extra: Partial<MemoryRecord> = {}): MemoryRecord {
	return { id, content: `memory ${id}`, category, updatedAt: "2026-08-10T00:00:00Z", ...extra };
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

describe("prayerStatusOf", () => {
	it("reads the status of a prayer memory", () => {
		expect(prayerStatusOf(memory("1", "prayer", { status: "open" }))).toBe("open");
		expect(prayerStatusOf(memory("2", "prayer", { status: "answered" }))).toBe("answered");
		expect(prayerStatusOf(memory("3", "prayer", { status: "closed" }))).toBe("closed");
	});

	it("is null for a prayer row with no status, from a server without the columns", () => {
		expect(prayerStatusOf(memory("1", "prayer"))).toBeNull();
		expect(prayerStatusOf(memory("2", "prayer", { status: null }))).toBeNull();
	});

	it("is null for a status this build cannot name", () => {
		// Cast, not `any`: the server could add a fourth state, and the row must
		// then show no actions rather than the wrong ones.
		const unknown = { ...memory("1", "prayer"), status: "waiting" } as unknown as MemoryRecord;
		expect(prayerStatusOf(unknown)).toBeNull();
	});

	it("ignores a status on a non-prayer memory", () => {
		expect(prayerStatusOf(memory("1", "study", { status: "open" }))).toBeNull();
	});
});

describe("prayerActionsFor", () => {
	it("offers Answered and Close on an open request", () => {
		expect(prayerActionsFor("open").map((action) => action.label)).toEqual(["Answered", "Close"]);
		expect(prayerActionsFor("open").map((action) => action.status)).toEqual(["answered", "closed"]);
	});

	it("offers only Reopen on a resolved request", () => {
		for (const status of ["answered", "closed"] as const) {
			expect(prayerActionsFor(status).map((action) => action.label)).toEqual(["Reopen"]);
			expect(prayerActionsFor(status)[0].status).toBe("open");
		}
	});

	it("tags a resolved request quietly", () => {
		expect(PRAYER_RESOLVED_TAGS.answered).toBe("Answered");
		expect(PRAYER_RESOLVED_TAGS.closed).toBe("Closed");
	});
});

describe("prayerAskedLabel", () => {
	const now = new Date("2026-09-15T12:00:00Z");

	it("reads as 'asked 12 Sep' inside the current year", () => {
		expect(prayerAskedLabel("2026-09-12T12:00:00.000Z", now)).toBe("asked 12 Sep");
	});

	it("adds the year once the request is from an earlier one", () => {
		expect(prayerAskedLabel("2025-12-24T12:00:00.000Z", now)).toBe("asked 24 Dec 2025");
	});

	it("is null when there is no date, or the date is unusable", () => {
		expect(prayerAskedLabel(null, now)).toBeNull();
		expect(prayerAskedLabel(undefined, now)).toBeNull();
		expect(prayerAskedLabel("", now)).toBeNull();
		expect(prayerAskedLabel("not a date", now)).toBeNull();
	});
});

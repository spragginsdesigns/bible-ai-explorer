import assert from "node:assert/strict";
import test from "node:test";

import {
	DAILY_CROSS_FALLBACK_CANDIDATES,
	selectDailyCrossFallback,
	validateDailyCrossSelection,
	isDailyCrossSelectionAllowed,
	dailyCrossReferenceKey,
} from "../src/lib/daily-cross-selection.ts";

const NOW = new Date("2026-08-27T12:00:00.000Z");

function selection(overrides = {}) {
	return {
		mode: "theme",
		primaryTheme: "A steady hope",
		primaryThemeKey: "hope",
		secondaryThemeKeys: ["trust"],
		book: "Romans",
		chapter: 8,
		verse: 28,
		selectionReason: "The passage meets the user's present need.",
		noveltyReason: "It is outside both rolling exclusion windows.",
		evidence: [{ kind: "reading", id: null, summary: "Romans was in the recent reading context.", origin: "test" }],
		confidence: 0.8,
		...overrides,
	};
}

test("exact verse inside the rolling 30-day window is blocked", () => {
	const result = validateDailyCrossSelection(selection(), [{
		book: "Romans", chapter: 8, verse: 28,
		sentAt: new Date("2026-08-10T12:00:00.000Z"),
		primaryThemeKey: "faith",
	}], NOW);
	assert.equal(result.ok, false);
	assert.equal(result.blockedByVerse, true);
	assert.match(result.errors[0], /30 days/);
});

test("the exact verse is allowed once it falls outside 30 days", () => {
	const result = validateDailyCrossSelection(selection(), [{
		book: "Romans", chapter: 8, verse: 28,
		sentAt: new Date("2026-07-27T11:59:59.000Z"),
		primaryThemeKey: "faith",
	}], NOW);
	assert.equal(result.ok, true);
});

test("primary theme inside the rolling 3-day window is blocked", () => {
	const result = validateDailyCrossSelection(selection(), [{
		book: "Philippians", chapter: 4, verse: 13,
		sentAt: new Date("2026-08-26T12:00:00.000Z"),
		primaryThemeKey: "hope",
	}], NOW);
	assert.equal(result.ok, false);
	assert.equal(result.blockedByTheme, true);
	assert.equal(result.blockedByVerse, false);
});

test("focus mode bypasses only the theme block, not the verse block", () => {
	const recent = [{
		book: "Philippians", chapter: 4, verse: 13,
		sentAt: new Date("2026-08-26T12:00:00.000Z"),
		primaryThemeKey: "hope",
	}];
	assert.equal(isDailyCrossSelectionAllowed(selection({ mode: "focus", book: "John", chapter: 15, verse: 5 }), recent, NOW), true);
	const sameVerse = validateDailyCrossSelection(selection({ mode: "focus" }), [{
		...recent[0], book: "Romans", chapter: 8, verse: 28,
	}], NOW);
	assert.equal(sameVerse.ok, false);
	assert.equal(sameVerse.blockedByVerse, true);
});

test("curated fallback is deterministic, varied, and excludes recent refs/themes", () => {
	const recent = [{
		book: "Psalms", chapter: 27, verse: 1,
		sentAt: NOW,
		primaryThemeKey: "courage",
	}];
	const first = selectDailyCrossFallback({ seed: "hermetic-seed", recentSelections: recent, now: NOW });
	const second = selectDailyCrossFallback({ seed: "hermetic-seed", recentSelections: recent, now: NOW });
	assert.deepEqual(first, second);
	assert.notEqual(dailyCrossReferenceKey(first), "john 3:16");
	assert.notEqual(dailyCrossReferenceKey(first), "psalms 27:1");
	assert.notEqual(first.primaryThemeKey, "courage");
	assert.equal(validateDailyCrossSelection(first, recent, NOW).ok, true);
});

test("focus fallback can reuse a recent theme but still excludes its recent verse", () => {
	const recent = [{
		book: "Psalms", chapter: 27, verse: 1,
		sentAt: NOW,
		primaryThemeKey: "courage",
	}];
	const fallback = selectDailyCrossFallback({ mode: "focus", focus: "courage", seed: 1, recentSelections: recent, now: NOW });
	assert.notEqual(dailyCrossReferenceKey(fallback), "psalms 27:1");
	assert.equal(validateDailyCrossSelection(fallback, recent, NOW).ok, true);
});

test("fallback pool remains eligible after thirty distinct recent verses", () => {
	assert.ok(DAILY_CROSS_FALLBACK_CANDIDATES.length > 30);
	const recent = DAILY_CROSS_FALLBACK_CANDIDATES.slice(0, 30).map((candidate) => ({
		...candidate,
		sentAt: NOW,
	}));
	const fallback = selectDailyCrossFallback({ seed: "day-31", recentSelections: recent, now: NOW });
	const blocked = new Set(recent.map(dailyCrossReferenceKey));
	assert.equal(blocked.has(dailyCrossReferenceKey(fallback)), false);
});

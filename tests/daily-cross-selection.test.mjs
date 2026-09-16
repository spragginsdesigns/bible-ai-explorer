import assert from "node:assert/strict";
import test from "node:test";

import {
	DAILY_CROSS_DIRECTIONS,
	DAILY_CROSS_FALLBACK_CANDIDATES,
	FRESH_THEME_WINDOW_DAYS,
	NoDailyCrossFallbackAvailableError,
	RECENT_THEME_WINDOW_DAYS,
	isDailyCrossDirection,
	recentThemeKeysWithin,
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

test("with no direction the theme gate is exactly the old three-day rule", () => {
	assert.equal(RECENT_THEME_WINDOW_DAYS, 3);
	const threeDaysAgo = [{
		book: "Philippians", chapter: 4, verse: 13,
		sentAt: new Date("2026-08-26T12:00:00.000Z"),
		primaryThemeKey: "hope",
	}];
	const blocked = validateDailyCrossSelection(selection(), threeDaysAgo, NOW);
	assert.deepEqual(blocked.errors, ["Theme hope was selected within the last 3 days."]);

	// Ten days back is outside the default window and must stay allowed, whether
	// the caller passes the array form or the options form with no direction.
	const tenDaysAgo = [{
		book: "Psalms", chapter: 46, verse: 1,
		sentAt: new Date("2026-08-17T12:00:00.000Z"),
		primaryThemeKey: "hope",
	}];
	assert.equal(validateDailyCrossSelection(selection(), tenDaysAgo, NOW).ok, true);
	assert.equal(validateDailyCrossSelection(selection(), { recentSelections: tenDaysAgo, now: NOW }).ok, true);
});

test("stay keeps the kept theme inside three days, and only that key", () => {
	assert.deepEqual([...DAILY_CROSS_DIRECTIONS], ["stay", "fresh"]);
	assert.equal(isDailyCrossDirection("stay"), true);
	assert.equal(isDailyCrossDirection("elsewhere"), false);

	const recent = [{
		book: "Philippians", chapter: 4, verse: 13,
		sentAt: new Date("2026-08-26T12:00:00.000Z"),
		primaryThemeKey: "hope",
	}];
	const kept = validateDailyCrossSelection(selection(), { recentSelections: recent, now: NOW, keepThemeKey: "hope" });
	assert.equal(kept.ok, true);
	assert.equal(kept.blockedByTheme, false);

	const wandered = validateDailyCrossSelection(
		selection({ primaryThemeKey: "peace", primaryTheme: "Peace with God", book: "John", chapter: 14, verse: 27 }),
		{ recentSelections: recent, now: NOW, keepThemeKey: "hope" }
	);
	assert.equal(wandered.ok, false);
	assert.ok(wandered.errors.includes("Selection must stay with theme hope."));
});

test("stay still cannot hand back the verse it is replacing", () => {
	const recent = [{
		book: "Romans", chapter: 8, verse: 28,
		sentAt: new Date("2026-08-26T12:00:00.000Z"),
		primaryThemeKey: "hope",
	}];
	const result = validateDailyCrossSelection(selection(), { recentSelections: recent, now: NOW, keepThemeKey: "hope" });
	assert.equal(result.ok, false);
	assert.equal(result.blockedByVerse, true);
	assert.match(result.errors[0], /30 days/);
});

test("fresh widens the theme window to fourteen days", () => {
	assert.equal(FRESH_THEME_WINDOW_DAYS, 14);
	const tenDaysAgo = [{
		book: "Psalms", chapter: 46, verse: 1,
		sentAt: new Date("2026-08-17T12:00:00.000Z"),
		primaryThemeKey: "hope",
	}];
	const fresh = validateDailyCrossSelection(selection(), {
		recentSelections: tenDaysAgo,
		now: NOW,
		themeWindowDays: FRESH_THEME_WINDOW_DAYS,
	});
	assert.equal(fresh.ok, false);
	assert.equal(fresh.blockedByTheme, true);
	assert.deepEqual(fresh.errors, ["Theme hope was selected within the last 14 days."]);

	// A typed focus waives only the everyday 3-day window; a fresh request is
	// still a request to leave the recent themes behind.
	const focused = validateDailyCrossSelection({ ...selection(), mode: "focus" }, {
		recentSelections: tenDaysAgo,
		now: NOW,
		themeWindowDays: FRESH_THEME_WINDOW_DAYS,
	});
	assert.equal(focused.blockedByTheme, true, "focus does not waive the widened window");
	const yesterday = [{ ...tenDaysAgo[0], sentAt: new Date("2026-08-26T12:00:00.000Z") }];
	const everyday = validateDailyCrossSelection({ ...selection(), mode: "focus" }, {
		recentSelections: yesterday,
		now: NOW,
	});
	assert.equal(everyday.blockedByTheme, false, "the everyday focus waiver is unchanged");
});

test("the themes a fresh selection must avoid are listed from the window", () => {
	const recent = [
		{ book: "Psalms", chapter: 46, verse: 1, sentAt: new Date("2026-08-26T12:00:00.000Z"), primaryThemeKey: "Hope" },
		{ book: "John", chapter: 15, verse: 5, sentAt: new Date("2026-08-17T12:00:00.000Z"), primaryThemeKey: "faith" },
		{ book: "Micah", chapter: 6, verse: 8, sentAt: new Date("2026-07-01T12:00:00.000Z"), primaryThemeKey: "obedience" },
		{ book: "Jude", chapter: 1, verse: 24, sentAt: new Date("2026-08-26T12:00:00.000Z"), primaryThemeKey: null },
	];
	assert.deepEqual(recentThemeKeysWithin(recent, 3, NOW), ["hope"]);
	assert.deepEqual(recentThemeKeysWithin(recent, FRESH_THEME_WINDOW_DAYS, NOW).sort(), ["faith", "hope"]);
});

test("the curated fallback honours a stay, and refuses a theme it cannot serve", () => {
	const recent = [{
		book: "Romans", chapter: 8, verse: 28,
		sentAt: NOW,
		primaryThemeKey: "hope",
	}];
	const stayed = selectDailyCrossFallback({ seed: "stay-seed", recentSelections: recent, now: NOW, keepThemeKey: "hope" });
	assert.equal(stayed.primaryThemeKey, "hope");
	assert.notEqual(dailyCrossReferenceKey(stayed), "romans 8:28");
	assert.equal(
		validateDailyCrossSelection(stayed, { recentSelections: recent, now: NOW, keepThemeKey: "hope" }).ok,
		true
	);

	// No curated candidate carries this as a primary theme, so the steered pool is
	// empty and the caller decides what to do about it.
	assert.throws(
		() => selectDailyCrossFallback({ seed: "stay-seed", recentSelections: [], now: NOW, keepThemeKey: "stewardship" }),
		NoDailyCrossFallbackAvailableError
	);
});

test("the curated fallback honours a fresh fourteen-day window", () => {
	const recent = [{
		book: "Psalms", chapter: 46, verse: 1,
		sentAt: new Date("2026-08-17T12:00:00.000Z"),
		primaryThemeKey: "trust",
	}];
	const options = { seed: "fresh-seed", recentSelections: recent, now: NOW, themeWindowDays: FRESH_THEME_WINDOW_DAYS };
	const fresh = selectDailyCrossFallback(options);
	assert.notEqual(fresh.primaryThemeKey, "trust");
	assert.equal(validateDailyCrossSelection(fresh, options).ok, true);
	assert.match(fresh.noveltyReason, /rolling 14-day window/);

	// An unsteered fallback still reports the three-day window verbatim.
	const plain = selectDailyCrossFallback({ seed: "fresh-seed", recentSelections: recent, now: NOW });
	assert.match(plain.noveltyReason, /rolling 3-day window\.$/);
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

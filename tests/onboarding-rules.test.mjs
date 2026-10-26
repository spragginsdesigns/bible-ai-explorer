/**
 * "Walk with me" (docs/onboarding/PLAN.md). The server owns the step order
 * and the scripted copy, the copy is narrated once and shared, and the
 * clients mirror the vocabulary by hand. These pin the parts that would fail
 * quietly: a scripted question the model could rewrite (new audio for every
 * account), a dash in spoken copy, a ceiling that reads 0 from a typo.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
	APP_TARGET_KEYS,
	DEFAULT_ONBOARDING_TURN_CEILING,
	FAITH_OPTIONS,
	GETTING_STARTED_ITEMS,
	ONBOARDING_STEPS,
	SCRIPTED_LINES,
	STEP_CARDS,
	TOUR_STOPS,
	WELCOME_TEXT,
	isAppTarget,
	isOnboardingStep,
	readCeiling,
	resolveChoiceCard,
	spokenText,
} from "../src/lib/onboarding-rules.ts";

const read = (relativePath) =>
	readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

test("a scripted step always draws the script, whatever the model sent", () => {
	const card = resolveChoiceCard({ step: "faith", question: "Are you saved?", options: ["Yes", "No"], allowOther: false });
	assert.equal(card.question, STEP_CARDS.faith.question);
	assert.deepEqual(card.options, [...FAITH_OPTIONS]);
	assert.equal(card.allowOther, true);
	assert.equal(card.skipLabel, "Skip for now");
});

test("the name step keeps up to two of the model's prefilled names", () => {
	const card = resolveChoiceCard({ step: "name", options: [" Kim ", "Kimberly", "Kim", "K"] });
	assert.deepEqual(card.options, ["Kim", "Kimberly"]);
	assert.equal(card.question, STEP_CARDS.name.question);
});

test("an other card keeps the model's words within bounds", () => {
	const card = resolveChoiceCard({
		step: "other",
		question: "x".repeat(400),
		options: ["a", "b", "c", "d", "e", "f", "g", "y".repeat(100)],
		allowOther: null,
	});
	assert.equal(card.question.length, 300);
	assert.equal(card.options.length, 6);
	assert.equal(card.allowOther, true);
});

test("every step has a skip, and every scripted line is shared narration", () => {
	for (const [step, card] of Object.entries(STEP_CARDS)) {
		assert.ok(card.skipLabel.trim(), step);
		assert.ok(SCRIPTED_LINES.includes(card.question), step);
	}
	assert.ok(SCRIPTED_LINES.includes(WELCOME_TEXT));
	assert.equal(new Set(SCRIPTED_LINES).size, SCRIPTED_LINES.length);
});

test("spoken copy has no dashes and no markdown", () => {
	const copy = [
		...SCRIPTED_LINES,
		...TOUR_STOPS.map((stop) => stop.caption),
		...Object.values(STEP_CARDS).flatMap((card) => [...(card.options ?? []), card.skipLabel]),
		...GETTING_STARTED_ITEMS.flatMap((item) => [item.label, item.ask]),
	];
	for (const line of copy) {
		assert.ok(!/[--]/.test(line), line);
		assert.equal(spokenText(line), line, line);
	}
});

test("tour stops and Getting started rows name real targets", () => {
	for (const stop of TOUR_STOPS) assert.ok(isAppTarget(stop.target), stop.target);
	for (const item of GETTING_STARTED_ITEMS) assert.ok(isAppTarget(item.target), item.target);
	assert.ok(APP_TARGET_KEYS.includes("tour"));
	assert.equal(isAppTarget("constructor"), false);
	assert.equal(isOnboardingStep("textScale"), true);
	assert.equal(isOnboardingStep("toString"), false);
	assert.equal(ONBOARDING_STEPS[0], "textScale");
});

test("ceilings fall back on junk and accept an explicit zero", () => {
	assert.equal(readCeiling(undefined, DEFAULT_ONBOARDING_TURN_CEILING), 60);
	assert.equal(readCeiling("abc", 60), 60);
	assert.equal(readCeiling("-5", 60), 60);
	assert.equal(readCeiling("0", 60), 0);
	assert.equal(readCeiling("120", 60), 120);
});

test("spokenText strips follow-ups, links and emphasis", () => {
	const text = "**Welcome**, Kim. Read [John 3:16](https://x.test).\n\n- one\n[FOLLOWUP] What next?";
	assert.equal(spokenText(text), "Welcome, Kim. Read John 3:16.\n\none");
});

test("onboarding turns and reads are metered off the free daily cap", () => {
	const usage = read("../src/lib/billing/usage.ts");
	assert.match(usage, /UNCOUNTED_SURFACES = \["background-utility", ONBOARDING_SURFACE\]/);
	// Every count that decides the free cap must exclude the onboarding surface.
	const counted = usage.match(/surface: \{ notIn: UNCOUNTED_SURFACES \}/g) ?? [];
	assert.ok(counted.length >= 3, `expected the daily, attempts and monthly counts, got ${counted.length}`);
	assert.ok(!/surface: \{ not: "background-utility" \}/.test(usage), "a count still only excludes background work");
});

test("the onboarding ceiling counts every reservation, failed ones included", () => {
	const usage = read("../src/lib/billing/usage.ts");
	// A turn that ends on a card settles as "failed" although it was answered.
	assert.match(usage, /count\(\{\s*where: \{ userId, surface: ONBOARDING_SURFACE \},\s*\}\);\s*if \(attempted < ceiling\)/);
	assert.ok(!/surface: ONBOARDING_SURFACE, status:/.test(usage), "the ceiling still skips failed rows");
});

test("Android carries the same rules, byte for byte", () => {
	assert.equal(
		read("../mobile/src/features/onboarding/onboardingRules.ts").replaceAll("\r", ""),
		read("../src/lib/onboarding-rules.ts").replaceAll("\r", ""),
	);
});

test("Android text sizes match the server's", async () => {
	const mobile = await import("../mobile/src/features/settings/textScale.ts");
	const { TEXT_SCALES } = await import("../src/lib/preferences-contract.ts");
	const { TEXT_SCALE_FACTORS, TEXT_SCALE_VALUES } = await import("../src/lib/onboarding-rules.ts");
	assert.deepEqual([...mobile.TEXT_SCALES], [...TEXT_SCALES]);
	assert.deepEqual(mobile.TEXT_SCALE_FACTORS, TEXT_SCALE_FACTORS);
	for (const [label, scale] of Object.entries(TEXT_SCALE_VALUES)) assert.equal(mobile.textScaleForLabel(label), scale);
});

test("the welcome owes the next card when a turn ends without one", async () => {
	const { expectedStep, owedStep, WELCOME_STEP_ORDER } = await import("../src/lib/onboarding-rules.ts");
	// The 2026-10-25 stall: the name was saved, the reply ended, no faith card.
	assert.equal(
		owedStep({ lastStep: "name", reply: "Call me Walker", calledTools: ["saveMemory"], answerText: "Now let's take the next step together." }),
		"faith",
	);
	assert.equal(owedStep({ lastStep: "name", reply: "Call me Walker", calledTools: ["saveMemory", "presentChoices"], answerText: "Good to meet you." }), null);
	assert.equal(owedStep({ lastStep: "aboutMe", reply: "Yes, save it", calledTools: [], answerText: "Saved." }), null);
	assert.equal(owedStep({ lastStep: "tour", reply: "Later", calledTools: ["finishOnboarding"], answerText: "Done." }), null);
	assert.equal(owedStep({ lastStep: "prayer", reply: "Not today", calledTools: [], answerText: "Would you like a verse for that?" }), null);
	// Still seeking gets the Gospel first, never a hurried church card.
	assert.equal(expectedStep("faith", "Still seeking, or not sure where I stand with God"), null);
	// A question in place of an answer gets the same card again.
	assert.equal(expectedStep("church", "Why do you need my church?"), "church");
	assert.equal(expectedStep("other", "Yes"), null);
	assert.equal(expectedStep(null, "hello"), null);
	for (let i = 0; i < WELCOME_STEP_ORDER.length - 1; i++) assert.equal(expectedStep(WELCOME_STEP_ORDER[i], "ok"), WELCOME_STEP_ORDER[i + 1]);
});

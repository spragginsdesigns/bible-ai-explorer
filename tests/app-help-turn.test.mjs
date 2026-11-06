/* A "?" help tap is an app question. Its fixed sentence is the identifier,
 * and it must put the app facts in front of the answering model, and through
 * the prepared system context, in front of the Scripture reviewer too.
 * Before 2026-11-05 "Help me with the Today screen." matched none of the app
 * keywords, so both models worked blind and help answers were withheld.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { appHelpGuidance, helpScreenGuidance, withAppHelpGuidance } from "../src/lib/app-help-guidance.ts";
import { HELP_SCREENS, helpScreenForText } from "../src/lib/onboarding-rules.ts";
import { appKnowledge, taskGuidance } from "../src/utils/systemPrompt.ts";

test("every help sentence is recognised as its own screen", () => {
	for (const [screen, sentence] of Object.entries(HELP_SCREENS)) {
		assert.equal(helpScreenForText(sentence), screen);
		assert.equal(helpScreenForText(`  ${sentence}\n`), screen);
	}
});

test("ordinary questions are never help taps", () => {
	for (const text of ["", "Help me with Romans 8.", "help me with the today screen.", "Help me with Chat. What is grace?"]) {
		assert.equal(helpScreenForText(text), null);
	}
});

test("a help tap carries the app facts and that screen's guidance", () => {
	for (const screen of Object.keys(HELP_SCREENS)) {
		const blocks = withAppHelpGuidance(taskGuidance({ userText: HELP_SCREENS[screen] }), helpScreenForText(HELP_SCREENS[screen]), appKnowledge);
		assert.equal(blocks.filter((block) => block === appKnowledge).length, 1, screen);
		assert.ok(blocks.includes(appHelpGuidance(screen)), screen);
		assert.ok(appHelpGuidance(screen).includes(helpScreenGuidance[screen]));
	}
});

test("the help sentences alone used to miss the app facts", () => {
	// Pins why the identifier is needed: without it, the keyword match fails.
	assert.ok(!taskGuidance({ userText: HELP_SCREENS.today }).includes(appKnowledge));
});

test("ordinary turns keep exactly their task blocks", () => {
	const blocks = taskGuidance({ userText: "How do I change settings in SureWord?" });
	assert.deepEqual(withAppHelpGuidance(blocks, null, appKnowledge), blocks);
	// A help tap whose keywords also matched still carries appKnowledge once.
	const both = withAppHelpGuidance(blocks, "chat", appKnowledge);
	assert.equal(both.filter((block) => block === appKnowledge).length, 1);
});

test("help guidance has no dashes", () => {
	for (const screen of Object.keys(HELP_SCREENS)) assert.ok(![0x2013, 0x2014].some((code) => appHelpGuidance(screen).includes(String.fromCharCode(code))), screen);
});

test("the help guidance never touches the owner's pinned systemPrompt.ts", () => {
	// scripts/generate-history-manifest.mjs fails the production build when this
	// file's hash moves; 2db33baa edited it and every deploy failed (2026-11-05).
	const script = readFileSync(new URL("../scripts/generate-history-manifest.mjs", import.meta.url), "utf8");
	const pinned = script.match(/foundation!=='([0-9a-f]{64})'/)?.[1];
	const actual = createHash("sha256").update(readFileSync(new URL("../src/utils/systemPrompt.ts", import.meta.url))).digest("hex");
	assert.equal(actual, pinned);
});

test("every help sheet has a title and three to five plain lines, on every client", async () => {
	const { HELP_SHEETS } = await import("../src/lib/onboarding-rules.ts");
	const swift = readFileSync(new URL("../macos/Shared/Onboarding/OnboardingRules.swift", import.meta.url), "utf8");
	for (const screen of Object.keys(HELP_SCREENS)) {
		const sheet = HELP_SHEETS[screen];
		assert.ok(sheet.title);
		assert.ok(sheet.points.length >= 3 && sheet.points.length <= 5, screen);
		// The Apple copy is generated from this file; it must not drift.
		assert.ok(swift.includes(`case .${screen}: "${sheet.title}"`), screen);
		for (const point of sheet.points) assert.ok(swift.includes(JSON.stringify(point)), point);
	}
});

/* A "?" help tap is an app question. Its fixed sentence is the identifier,
 * and it must put the app facts in front of the answering model, and through
 * the prepared system context, in front of the Scripture reviewer too.
 * Before 2026-11-05 "Help me with the Today screen." matched none of the app
 * keywords, so both models worked blind and help answers were withheld.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { HELP_SCREENS, helpScreenForText } from "../src/lib/onboarding-rules.ts";
import { appHelpGuidance, appKnowledge, helpScreenGuidance, taskGuidance } from "../src/utils/systemPrompt.ts";

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
		const blocks = taskGuidance({ helpScreen: screen, userText: HELP_SCREENS[screen] });
		assert.ok(blocks.includes(appKnowledge), screen);
		assert.ok(blocks.includes(appHelpGuidance(screen)), screen);
		assert.ok(appHelpGuidance(screen).includes(helpScreenGuidance[screen]));
	}
});

test("the help sentences alone used to miss the app facts", () => {
	// Pins why the identifier is needed: without it, the keyword match fails.
	assert.ok(!taskGuidance({ userText: HELP_SCREENS.today }).includes(appKnowledge));
});

test("help guidance has no dashes and the retired keys are gone", () => {
	for (const screen of Object.keys(HELP_SCREENS)) assert.ok(![0x2013, 0x2014].some((code) => appHelpGuidance(screen).includes(String.fromCharCode(code))), screen);
	assert.doesNotMatch(appKnowledge, /OpenRouter key|Anthropic, Moonshot/);
});

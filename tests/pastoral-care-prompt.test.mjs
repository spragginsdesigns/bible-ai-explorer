/* F5: pastoral care in the persona.
 *
 * Memory extraction collects prayer requests and life circumstances, so the
 * assistant will hear disclosures of danger. These assertions pin that both
 * prompts that talk to a user carry the guidance, that it names real help
 * rather than a verse alone, and that adding it did not move the note panel's
 * cached prefix (note-ai splits on `${systemPrompt}\n\n${appKnowledge}`).
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
	appKnowledge,
	chatSystemPrompt,
	noteAISystemPrompt,
	pastoralCareGuidance,
	systemPrompt,
} from "../src/utils/systemPrompt.ts";
import { DOCTRINE_REVIEW_DIMENSIONS } from "../src/lib/ai/answer-eval.ts";
import { splitStableSystemPrefix } from "../src/lib/ai/prompt-cache.ts";

test("pastoral guidance names emergency help, not only Scripture", () => {
	assert.match(pastoralCareGuidance, /988/);
	assert.match(pastoralCareGuidance, /emergency number/);
	assert.match(pastoralCareGuidance, /never in place of it/);
	assert.match(pastoralCareGuidance, /pastor/);
});

test("chat and note prompts both carry the pastoral guidance in every translation", () => {
	for (const translation of ["KJV", "NKJV"]) {
		assert.ok(chatSystemPrompt(translation).includes(pastoralCareGuidance), translation);
	}
	assert.ok(noteAISystemPrompt("Title", "Body", null).includes(pastoralCareGuidance));
});

test("note panel keeps its cached stable prefix after the guidance was added", () => {
	const full = noteAISystemPrompt("Title", "Body", null);
	const { stableSystem } = splitStableSystemPrefix(full, `${systemPrompt}\n\n${appKnowledge}`);
	assert.equal(stableSystem, `${systemPrompt}\n\n${appKnowledge}`);
});

test("doctrine review includes a pastoral-safety dimension", () => {
	assert.ok(DOCTRINE_REVIEW_DIMENSIONS.includes("pastoral-safety"));
});

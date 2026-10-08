import assert from "node:assert/strict";
import test from "node:test";

import { decideAccess, houseEffortFor } from "../src/lib/ai/access.ts";
import {
	HOUSE_CHAT_MODEL_IDS,
	HOUSE_EFFORT,
	HOUSE_MODEL_ID,
	getModel,
	DEFAULT_MODEL_ID,
	houseChatModelId,
} from "../src/lib/ai/models.ts";

test("an account with no key of its own runs on the house model", () => {
	assert.equal(decideAccess({ allowlisted: false, ownKeyCount: 0 }), "house");
});

test("one stored key is enough to leave the house", () => {
	assert.equal(decideAccess({ allowlisted: false, ownKeyCount: 1 }), "keys");
	assert.equal(decideAccess({ allowlisted: false, ownKeyCount: 4 }), "keys");
});

test("an allowlisted account keeps the picker even with no stored key", () => {
	// SERVER_CREDENTIAL_USER_IDS exists to let Austin spend the server's keys on
	// any provider. Dropping him into the single-model house would be a
	// regression, not a simplification.
	assert.equal(decideAccess({ allowlisted: true, ownKeyCount: 0 }), "keys");
	assert.equal(decideAccess({ allowlisted: true, ownKeyCount: 2 }), "keys");
});

test("the house model is a real registry entry that takes the house effort", () => {
	// resolveModel builds the house call straight off this entry, so a typo here
	// is a 404 from OpenAI on every keyless user's first question.
	const house = getModel(HOUSE_MODEL_ID);
	assert.ok(house, `${HOUSE_MODEL_ID} must be a curated model`);
	assert.equal(house.provider, "openai");
	assert.equal(house.providerModelId, "gpt-5.6-luna");
	assert.ok(
		house.efforts.includes(HOUSE_EFFORT),
		`the house model must accept ${HOUSE_EFFORT} effort`,
	);
	// Chat carries attachments; a house user has no other model to fall back to.
	assert.equal(house.supportsAttachments, true);
});

test("the registry default is the house model, so both worlds open on the same head", () => {
	assert.equal(DEFAULT_MODEL_ID, HOUSE_MODEL_ID);
});

test("included chat runs on GPT-6.1 Sol for Pro and GLM 5.3 Flash for Free", () => {
	const keys = { openrouter: true };
	assert.equal(houseChatModelId("pro", keys), "openai/gpt-6.1-sol");
	assert.equal(houseChatModelId("free", keys), "openrouter/z-ai/glm-5.3-flash");
	// A deploy with no OpenRouter key keeps answering free accounts on Luna.
	assert.equal(houseChatModelId("free", { openrouter: false }), HOUSE_MODEL_ID);
	assert.equal(houseChatModelId("pro", { openrouter: false }), HOUSE_CHAT_MODEL_IDS.pro);

	const sol = getModel(HOUSE_CHAT_MODEL_IDS.pro);
	assert.ok(sol, "the Pro house model must be curated");
	// Pro answers at medium; the API rejects `none` on this head.
	assert.ok(sol.efforts.includes(HOUSE_EFFORT));
	assert.ok(!sol.efforts.includes("none"));
	assert.equal(sol.supportsAttachments, true);

	const glm = getModel(HOUSE_CHAT_MODEL_IDS.free);
	assert.ok(glm, "the Free house model must be curated");
	assert.equal(glm.supportsAttachments, true);
	assert.ok(glm.pricing, "metering needs the Free model's price");
});

test("house effort is a medium ceiling: low passes through, nothing above medium is honoured", () => {
	assert.equal(houseEffortFor("low"), "low");
	assert.equal(houseEffortFor("medium"), "medium");
	assert.equal(houseEffortFor("high"), "medium");
	assert.equal(houseEffortFor(null), "medium");
	assert.equal(houseEffortFor(undefined), "medium");
	assert.equal(houseEffortFor("max"), "medium");
});

test("included quality is independent of subscription and callers cannot request a higher bill", () => {
	assert.equal(houseEffortFor(null), "medium");
	assert.equal(houseEffortFor("max"), "medium");
	assert.equal(houseEffortFor("low"), "low");
});

test("adding or deleting a key does not silently change the selected payer", () => {
	assert.equal(decideAccess({ allowlisted: false, ownKeyCount: 1, includedPreference: null }), "house");
	assert.equal(decideAccess({ allowlisted: false, ownKeyCount: 1, includedPreference: true }), "house");
	assert.equal(decideAccess({ allowlisted: false, ownKeyCount: 0, includedPreference: false }), "keys");
	assert.equal(decideAccess({ allowlisted: true, ownKeyCount: 0, includedPreference: true }), "keys");
});

import assert from "node:assert/strict";
import test from "node:test";

import { decideAccess, houseEffortFor, houseEffortsFor } from "../src/lib/ai/access.ts";
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

test("included chat runs on GPT-5.6 Luna at medium for both plans", () => {
	for (const plan of ["pro", "free"]) {
		for (const openrouter of [true, false]) {
			assert.equal(houseChatModelId(plan, { openrouter }), "openai/gpt-5.6-luna");
		}
		const model = getModel(HOUSE_CHAT_MODEL_IDS[plan]);
		assert.ok(model, `the ${plan} house model must be curated`);
		assert.ok(model.efforts.includes(HOUSE_EFFORT));
		assert.equal(model.supportsAttachments, true);
		assert.ok(model.pricing, "metering needs the house model's price");
	}
});

test("house effort is a medium ceiling: low passes through, nothing above medium is honoured", () => {
	assert.equal(houseEffortFor("low"), "low");
	assert.equal(houseEffortFor("medium"), "medium");
	assert.equal(houseEffortFor("high"), "medium");
	assert.equal(houseEffortFor(null), "medium");
	assert.equal(houseEffortFor(undefined), "medium");
	assert.equal(houseEffortFor("max"), "medium");
});

test("Pro picks low, medium or high on included chat; Free has no choice", () => {
	assert.deepEqual([...houseEffortsFor("pro")], ["low", "medium", "high"]);
	assert.deepEqual([...houseEffortsFor("free")], []);
	assert.equal(houseEffortFor("high", "pro"), "high");
	assert.equal(houseEffortFor("low", "pro"), "low");
	assert.equal(houseEffortFor(null, "pro"), "medium");
	// Past high is clamped, so a hand-crafted request cannot buy a long answer.
	assert.equal(houseEffortFor("xhigh", "pro"), "medium");
	assert.equal(houseEffortFor("max", "pro"), "medium");
	// Free stays capped at medium whatever it sends.
	assert.equal(houseEffortFor("high", "free"), "medium");
	assert.equal(houseEffortFor("max"), "medium");
	assert.equal(houseEffortFor("low"), "low");
	// Every Pro choice is one the included model actually takes.
	const luna = getModel(HOUSE_CHAT_MODEL_IDS.pro);
	for (const effort of houseEffortsFor("pro")) assert.ok(luna.efforts.includes(effort));
});

test("adding or deleting a key does not silently change the selected payer", () => {
	assert.equal(decideAccess({ allowlisted: false, ownKeyCount: 1, includedPreference: null }), "house");
	assert.equal(decideAccess({ allowlisted: false, ownKeyCount: 1, includedPreference: true }), "house");
	assert.equal(decideAccess({ allowlisted: false, ownKeyCount: 0, includedPreference: false }), "keys");
	assert.equal(decideAccess({ allowlisted: true, ownKeyCount: 0, includedPreference: true }), "keys");
});

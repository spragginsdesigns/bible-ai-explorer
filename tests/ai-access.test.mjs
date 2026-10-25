import assert from "node:assert/strict";
import test from "node:test";

import { decideAccess, houseEffortFor, houseEffortsFor } from "../src/lib/ai/access.ts";
import {
	HOUSE_CHAT_MODEL_ID,
	HOUSE_CHAT_MODEL_IDS,
	HOUSE_EFFORT,
	HOUSE_MODEL_ID,
	SUREWORD_AI_LABEL,
	SUREWORD_PLAN_MODEL_IDS,
	getModel,
	resolveDefinition,
	sureWordPlanDefinition,
	sureWordPlanForModelId,
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

test("included chat runs on GPT-6 Luna for both plans", () => {
	assert.equal(HOUSE_CHAT_MODEL_ID, "openai/gpt-6-luna");
	// Not the background house id, so houseChatModel bills the owner's
	// OPENAI_API_KEY rather than the dedicated free-tier credential.
	assert.notEqual(HOUSE_CHAT_MODEL_ID, HOUSE_MODEL_ID);
	for (const plan of ["pro", "free"]) {
		for (const openrouter of [true, false]) {
			assert.equal(houseChatModelId(plan, { openrouter }), HOUSE_CHAT_MODEL_ID);
		}
		const model = getModel(HOUSE_CHAT_MODEL_IDS[plan]);
		assert.ok(model, `the ${plan} house model must be curated`);
		assert.equal(model.providerModelId, "gpt-6-luna");
		assert.equal(model.supportsAttachments, true);
		assert.deepEqual(model.pricing, { input: 0.1, output: 0.5 }, "metering needs the house model's price");
		// Every effort the plan rule can produce is one the head takes.
		for (const effort of ["low", "high"]) assert.ok(model.efforts.includes(effort));
	}
});

test("the owner's two SureWord AIs run the included head and offer no run options", () => {
	assert.equal(SUREWORD_AI_LABEL, "SureWord AI");
	for (const plan of ["free", "pro"]) {
		const row = sureWordPlanDefinition(plan);
		assert.equal(row.id, SUREWORD_PLAN_MODEL_IDS[plan]);
		assert.equal(row.label, "SureWord AI");
		assert.equal(row.provider, "openai");
		assert.equal(row.providerModelId, "gpt-6-luna");
		assert.deepEqual([...row.efforts], []);
		assert.deepEqual([...row.speeds], ["standard"]);
		assert.deepEqual([...row.verbosities], []);
		assert.deepEqual([...row.modes], ["standard"]);
		assert.equal(row.supportsAttachments, true);
		assert.equal(sureWordPlanForModelId(row.id), plan);
		// Outside every provider namespace, so no BYOK path can resolve one.
		assert.equal(resolveDefinition(row.id), undefined);
	}
	assert.equal(sureWordPlanForModelId("openai/gpt-6-luna"), null);
	assert.equal(sureWordPlanForModelId(null), null);
});

test("Free answers on low whatever it asks for", () => {
	for (const requested of ["low", "medium", "high", "xhigh", "max", null, undefined]) {
		assert.equal(houseEffortFor(requested, "free"), "low");
		assert.equal(houseEffortFor(requested), "low");
	}
});

test("Pro answers on high, and a call site's low pin is kept", () => {
	assert.equal(houseEffortFor(null, "pro"), "high");
	assert.equal(houseEffortFor(undefined, "pro"), "high");
	assert.equal(houseEffortFor("medium", "pro"), "high");
	assert.equal(houseEffortFor("high", "pro"), "high");
	// Past high is clamped, so a hand-crafted request cannot buy a long answer.
	assert.equal(houseEffortFor("xhigh", "pro"), "high");
	assert.equal(houseEffortFor("max", "pro"), "high");
	// Tap-a-verse, word study and connections pin low for latency.
	assert.equal(houseEffortFor("low", "pro"), "low");
});

test("neither plan gets Reasoning chips on included AI", () => {
	assert.deepEqual([...houseEffortsFor("pro")], []);
	assert.deepEqual([...houseEffortsFor("free")], []);
});

test("adding or deleting a key does not silently change the selected payer", () => {
	assert.equal(decideAccess({ allowlisted: false, ownKeyCount: 1, includedPreference: null }), "house");
	assert.equal(decideAccess({ allowlisted: false, ownKeyCount: 1, includedPreference: true }), "house");
	assert.equal(decideAccess({ allowlisted: false, ownKeyCount: 0, includedPreference: false }), "keys");
	assert.equal(decideAccess({ allowlisted: true, ownKeyCount: 0, includedPreference: true }), "keys");
});

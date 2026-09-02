import assert from "node:assert/strict";
import test from "node:test";

import { decideAccess, houseEffortFor } from "../src/lib/ai/access.ts";
import { HOUSE_EFFORT, HOUSE_MODEL_ID, getModel, DEFAULT_MODEL_ID } from "../src/lib/ai/models.ts";

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

test("house effort is a medium ceiling: low passes through, nothing above medium is honoured", () => {
	assert.equal(houseEffortFor("low"), "low");
	assert.equal(houseEffortFor("medium"), "medium");
	assert.equal(houseEffortFor("high"), "medium");
	assert.equal(houseEffortFor(null), "medium");
	assert.equal(houseEffortFor(undefined), "medium");
	assert.equal(houseEffortFor("max"), "medium");
});

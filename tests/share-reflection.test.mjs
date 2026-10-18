import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { reflectionSafetyProblem, reflectionReviewPassed } from "../src/lib/share-cards/reflection-rules.ts";
import { reflectionPresentation, validReflectionPresentation, MAX_REFLECTION_LENGTH } from "../src/lib/share-cards/reflection-contract.ts";
import { personalTextProblem } from "../src/lib/share-cards/personal-rules.ts";

test("privacy review fails closed for every missing or rejected decision", () => {
	const approved = { privacySafe: true, grounded: true, verseFaithful: true, noEmbarrassingDisclosure: true, noInventedTestimony: true };
	assert.equal(reflectionReviewPassed(approved), true);
	for (const key of Object.keys(approved)) {
		assert.equal(reflectionReviewPassed({ ...approved, [key]: false }), false);
		assert.equal(reflectionReviewPassed({ ...approved, [key]: "true" }), false);
		const missing = { ...approved }; delete missing[key];
		assert.equal(reflectionReviewPassed(missing), false);
	}
	for (const value of [null, undefined, {}, true]) assert.equal(reflectionReviewPassed(value), false);
});

test("generated reflections reject identifying payloads and invisible text", () => {
	assert.equal(reflectionSafetyProblem("As I study this passage, I'm considering what it means to trust the Lord with the next step."), null);
	for (const value of ["", "I am at 123 Main Street.", "Email me at a@example.com.", "I shared https://example.com.", "My\u202ereflection", "An encouragement for you.", "I".repeat(201)]) {
		assert.ok(reflectionSafetyProblem(value), value);
	}
	assert.equal(MAX_REFLECTION_LENGTH, 200);
});

test("ordinary Scripture language remains available to the blind reflection writer", () => {
	const text = "I'm learning to bring every request to God with thanksgiving, trusting Him with my next step.";
	assert.equal(reflectionSafetyProblem(text), null);
	assert.equal(personalTextProblem(text), null);
	for (const unsafe of ["I share more at prizes.com", "I write as SureWord", "My address is me@example.com"]) assert.ok(personalTextProblem(unsafe));
});

test("only the bounded font and placement options can reach a saved card", () => {
	for (const font of ["italic", "book", "simple"]) for (const placement of ["above", "below"]) {
		assert.equal(validReflectionPresentation({ font, placement }), true);
		assert.deepEqual(reflectionPresentation({ font, placement }), { font, placement });
	}
	for (const value of [null, {}, { font: "<script>", placement: "above" }, { font: "book", placement: "outside" }]) assert.equal(validReflectionPresentation(value), false);
	assert.deepEqual(reflectionPresentation({ font: "unknown", placement: "unknown" }), { font: "italic", placement: "below" });
});

test("web and Android carry the exact same reflection choices", () => {
	const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
	assert.equal(read("../src/lib/share-cards/reflection-contract.ts"), read("../mobile/src/features/shareCards/reflection-contract.ts"));
});

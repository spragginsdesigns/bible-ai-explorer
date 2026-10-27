/**
 * The web's "Walk with me" cards (src/lib/guide-cards.ts). These pin what
 * would fail quietly: a stored card read back with a bad shape, an old card
 * that still takes taps after SureWord moved on, voice mode reading the
 * whole history back, and a spotlight target with nowhere to go.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
	APP_TARGET_KEYS,
	TOUR_STOPS,
	isAppTarget,
	isGlossaryTerm,
	isOnboardingStep,
	resolveChoiceCard,
} from "../src/lib/onboarding-rules.ts";
import {
	GUIDE_TARGET_ROUTES,
	alreadyHeardOnStart,
	cardStates,
	isWelcomeToolCallId,
	parseChoiceCard,
	parseShowInApp,
	routeForTarget,
	voiceItemsFor,
} from "../src/lib/guide-cards.ts";

test("a resolved server card reads back unchanged", () => {
	const card = resolveChoiceCard({ step: "dailyTime" });
	assert.deepEqual(parseChoiceCard(card, isOnboardingStep), card);
});

test("a card with an unknown step or no question is dropped, and junk options are filtered", () => {
	assert.equal(parseChoiceCard({ step: "bogus", question: "?", options: [] }, isOnboardingStep), null);
	assert.equal(parseChoiceCard({ step: "faith", options: [] }, isOnboardingStep), null);
	assert.equal(parseChoiceCard(null, isOnboardingStep), null);
	const card = parseChoiceCard({ step: "other", question: "Q", options: ["A", 3, "", "B"], allowOther: "yes" }, isOnboardingStep);
	assert.deepEqual(card, { step: "other", question: "Q", options: ["A", "B"], allowOther: false, skipLabel: "Skip for now", terms: [] });
});

test("only known glossary words survive parsing, and older stored cards have none", () => {
	const faith = { step: "faith", question: "Have you been saved?", options: [], terms: ["saved", "bogus", 4] };
	assert.deepEqual(parseChoiceCard(faith, isOnboardingStep, isGlossaryTerm).terms, ["saved"]);
	assert.deepEqual(parseChoiceCard({ step: "faith", question: "Q", options: [] }, isOnboardingStep, isGlossaryTerm).terms, []);
	// A caller that cannot draw tappable words gets none.
	assert.deepEqual(parseChoiceCard(faith, isOnboardingStep).terms, []);
});

test("a Show me card keeps only real targets, and a tour keeps its valid stops", () => {
	assert.equal(parseShowInApp({ target: "tab.nowhere", caption: "x" }, isAppTarget), null);
	assert.equal(parseShowInApp({ target: "constructor", caption: "x" }, isAppTarget), null);
	assert.deepEqual(parseShowInApp({ target: "today.cross", caption: "Here" }, isAppTarget), { target: "today.cross", caption: "Here" });
	const tour = parseShowInApp(
		{ target: "tour", caption: "Look", stops: [...TOUR_STOPS, { target: "nope", caption: "x" }, { target: "tab.bible" }] },
		isAppTarget
	);
	assert.deepEqual(tour?.stops, TOUR_STOPS.map((stop) => ({ ...stop })));
});

test("only the seeded welcome card's tool call id marks the welcome", () => {
	assert.equal(isWelcomeToolCallId("welcome-1b2c"), true);
	assert.equal(isWelcomeToolCallId("call_abc"), false);
	assert.equal(isWelcomeToolCallId(undefined), false);
});

const card = (step) => resolveChoiceCard({ step });

test("only the newest card is live, and only while nothing is being written", () => {
	const messages = [
		{ id: "a1", role: "assistant", content: "Welcome", choiceCard: card("textScale") },
		{ id: "u1", role: "user", content: " Large " },
		{ id: "a2", role: "assistant", content: "Name?", choiceCard: card("name") },
	];
	assert.deepEqual(cardStates(messages, false), {
		a1: { active: false, answer: "Large" },
		a2: { active: true, answer: null },
	});
	assert.equal(cardStates(messages, true).a2.active, false);
	// Once they answer, the newest card is no longer the last message.
	const answered = [...messages, { id: "u2", role: "user", content: "Call me Kim" }];
	assert.deepEqual(cardStates(answered, false).a2, { active: false, answer: "Call me Kim" });
});

test("every target the web can travel to is a real target, and tabs never need a trip", () => {
	for (const target of Object.keys(GUIDE_TARGET_ROUTES)) assert.ok(APP_TARGET_KEYS.includes(target), target);
	for (const target of APP_TARGET_KEYS.filter((key) => key.startsWith("tab."))) assert.equal(routeForTarget(target), null);
	assert.equal(routeForTarget("tour"), null);
	// The tour ends on a verse, so the reader route must open one.
	assert.match(routeForTarget("reader.verse"), /^\/bible\/chapter\?.*verse=\d+/);
});

test("voice reads the message, then the card's scripted question, never an unscripted one", () => {
	assert.deepEqual(voiceItemsFor({ id: "m1" }), [{ messageId: "m1" }]);
	assert.deepEqual(voiceItemsFor({ id: "m1", choiceCard: card("faith") }), [{ messageId: "m1" }, { step: "faith" }]);
	assert.deepEqual(voiceItemsFor({ id: "m1", choiceCard: resolveChoiceCard({ step: "other", question: "Q", options: ["A", "B"] }) }), [{ messageId: "m1" }]);
});

test("turning voice on reads only the newest message", () => {
	const messages = [
		{ id: "a1", role: "assistant" },
		{ id: "u1", role: "user" },
		{ id: "a2", role: "assistant" },
	];
	assert.deepEqual(alreadyHeardOnStart(messages), ["a1"]);
	// A reply still being written is the newest one; everything settled is heard.
	assert.deepEqual(alreadyHeardOnStart([...messages, { id: "a3", role: "assistant", isStreaming: true }]), ["a1", "a2"]);
	assert.deepEqual(alreadyHeardOnStart([]), []);
});

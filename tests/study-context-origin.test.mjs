import assert from "node:assert/strict";
import test from "node:test";

import { formatStudyQuestions } from "../src/lib/study-context-format.ts";
import {
	isDailyCrossMessageOrigin,
	sanitizeDailyCrossMessageOrigin,
} from "../src/lib/chat-attachment-types.ts";

const origin = {
	surface: "daily-cross",
	verseOfDayId: "vod_123",
	reference: "James 3:17",
	action: "go-deeper",
};

test("Daily Cross origin accepts only the bounded attribution contract", () => {
	assert.equal(isDailyCrossMessageOrigin(origin), true);
	assert.equal(isDailyCrossMessageOrigin({ ...origin, action: "auto-send" }), false);
	assert.equal(isDailyCrossMessageOrigin({ ...origin, verseOfDayId: "" }), false);
	assert.equal(isDailyCrossMessageOrigin({ ...origin, text: "must not matter" }), true);
	assert.deepEqual(sanitizeDailyCrossMessageOrigin({ ...origin, text: "must not persist" }), origin);
});

test("study context labels a Daily Cross follow-up and leaves organic questions organic", () => {
	const formatted = formatStudyQuestions([
		{ content: "How does this shape family speech?", metadata: { origin } },
		{ content: "What happened to Cain after Eden?", metadata: {} },
	]);
	assert.match(formatted, /Daily Cross study continuation on James 3:17/);
	assert.match(formatted, /not an independent fresh interest/);
	assert.match(formatted, /What happened to Cain after Eden\?/);
	assert.doesNotMatch(formatted, /Daily Cross study continuation on What happened/);
});

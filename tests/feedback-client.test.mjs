/**
 * Answer feedback, browser half: the request body the rating route actually
 * receives, and the text the Copy action puts on the clipboard.
 *
 * `copyableAnswerText` is asserted here rather than in
 * tests/assistant-markdown.test.mjs because it lives in feedback-client.ts:
 * src/utils/assistantMarkdown.ts is held byte-identical to the Android copy
 * below its header, so a web-only export there would fail that mirror check.
 * mobile/src/lib/answerFeedback.test.ts pins the Android twin to the same
 * behaviour.
 *
 * The module is loaded the way tests/answer-feedback.test.mjs loads its own:
 * node's type stripping will not resolve an extensionless `.ts` specifier, so
 * the imports are cut out and their real values injected instead.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";

import { stripFollowUpMarkers } from "../src/utils/assistantMarkdown.ts";

const read = (relativePath) =>
	readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

function loadModule(relativePath, exportNames, injected = {}) {
	const source = read(relativePath)
		.replace(/^import\s[^;]*?;\s*$/gm, "")
		.replace(/^export /gm, "");
	const names = Object.keys(injected);
	const factory = new Function(
		...names,
		`${stripTypeScriptTypes(source)}\nreturn { ${exportNames.join(", ")} };`
	);
	return factory(...names.map((name) => injected[name]));
}

const { FEEDBACK_TAGS } = loadModule("../src/lib/chat/answer-feedback.ts", ["FEEDBACK_TAGS"]);
const { copyableAnswerText, setAnswerFeedback } = loadModule(
	"../src/lib/chat/feedback-client.ts",
	["copyableAnswerText", "setAnswerFeedback"],
	{ FEEDBACK_TAGS, stripFollowUpMarkers }
);

/** Swap in a fetch that records its call and answers with `body`. */
async function withFetch(body, run) {
	const calls = [];
	const original = globalThis.fetch;
	globalThis.fetch = async (url, init) => {
		calls.push({ url, init });
		return { ok: true, status: 200, json: async () => body };
	};
	try {
		await run(calls);
	} finally {
		globalThis.fetch = original;
	}
}

const sentBody = (calls) => JSON.parse(calls[0].init.body);

test("copyableAnswerText drops the follow-up markers and trims what is left", () => {
	const answer = [
		"Romans 8:1 speaks to this.",
		"",
		"[FOLLOWUP] What is condemnation?",
		"[FOLLOWUP] Who walks after the Spirit?",
		"",
	].join("\n");
	assert.equal(copyableAnswerText(answer), "Romans 8:1 speaks to this.");
});

test("copyableAnswerText keeps the markdown and trims the leading blank lines", () => {
	assert.equal(
		copyableAnswerText("\n\n## Heading\n\n- **one**\n- two\n\n"),
		"## Heading\n\n- **one**\n- two"
	);
});

test("a thumbs down sends its chips and its reason", async () => {
	await withFetch(
		{
			id: "m1",
			feedback: "down",
			feedbackReason: "Misquoted the verse.",
			feedbackTags: ["not-kjv", "wrong-verse"],
			feedbackAt: "2026-09-17T00:00:00.000Z",
		},
		async (calls) => {
			const saved = await setAnswerFeedback("c1", "m1", "down", {
				reason: "  Misquoted the verse.  ",
				tags: ["not-kjv", "wrong-verse"],
			});
			assert.equal(calls[0].url, "/api/conversations/c1/messages/m1");
			assert.deepEqual(sentBody(calls), {
				feedback: "down",
				feedbackReason: "Misquoted the verse.",
				feedbackTags: ["not-kjv", "wrong-verse"],
			});
			assert.deepEqual(saved.feedbackTags, ["not-kjv", "wrong-verse"]);
		}
	);
});

test("an empty chip list and an empty reason are omitted, not sent", async () => {
	await withFetch(
		{ id: "m1", feedback: "down", feedbackReason: null, feedbackTags: [] },
		async (calls) => {
			await setAnswerFeedback("c1", "m1", "down", { reason: "   ", tags: [] });
			assert.deepEqual(sentBody(calls), { feedback: "down" });
		}
	);
});

test("chips and a reason never travel with a thumbs up", async () => {
	await withFetch(
		{ id: "m1", feedback: "up", feedbackReason: null, feedbackTags: [] },
		async (calls) => {
			await setAnswerFeedback("c1", "m1", "up", { reason: "loved it", tags: ["too-long"] });
			assert.deepEqual(sentBody(calls), { feedback: "up" });
		}
	);
});

test("a tag this build does not know about is dropped, not thrown", async () => {
	await withFetch(
		{ id: "m1", feedback: "down", feedbackReason: null, feedbackTags: ["not-kjv", "invented", 7] },
		async () => {
			const saved = await setAnswerFeedback("c1", "m1", "down", { tags: ["not-kjv"] });
			assert.deepEqual(saved.feedbackTags, ["not-kjv"]);
		}
	);
});

test("a route that answers 200 without a body still reports what was asked for", async () => {
	await withFetch(null, async () => {
		const saved = await setAnswerFeedback("c1", "m1", "down", {
			reason: "Too long",
			tags: ["too-long"],
		});
		assert.deepEqual(saved, {
			feedback: "down",
			feedbackReason: "Too long",
			feedbackTags: ["too-long"],
			feedbackAt: null,
		});
	});
});

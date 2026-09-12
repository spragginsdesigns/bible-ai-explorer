/* A2: short question, short answer.
 *
 * turn-shape.ts reaches its reference parsers through the "@/" alias, so it is
 * instantiated from the shipped source with those parsers injected - the real
 * parsers, loaded the same way verse-parser.test.mjs loads them.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";

import { questionReference } from "../src/utils/questionPresentation.ts";

const read = (relativePath) =>
	readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

function loadModule(relativePath, exportNames, injected = {}) {
	const source = read(relativePath)
		.replace(/^import\s[^;]*?;\s*$/gm, "")
		.replace(/^export /gm, "");
	const names = Object.keys(injected);
	const factory = new Function(
		...names,
		`${stripTypeScriptTypes(source)}\nreturn { ${exportNames.join(", ")} };`,
	);
	return factory(...names.map((name) => injected[name]));
}

const { resolveReference } = loadModule("../src/lib/bible/books.ts", ["resolveReference"], {
	booksJson: JSON.parse(read("../src/data/books.json")),
});
const { parseVerseReferences } = loadModule("../src/utils/verseParser.ts", ["parseVerseReferences"], {
	resolveReference,
});
const { turnShapeHint, SHORT_FOLLOW_UP_HINT, SHORT_FOLLOW_UP_MAX_CHARS } = loadModule(
	"../src/lib/turn-shape.ts",
	["turnShapeHint", "SHORT_FOLLOW_UP_HINT", "SHORT_FOLLOW_UP_MAX_CHARS"],
	{ questionReference, parseVerseReferences },
);

const user = (text, extra = {}) => ({ role: "user", parts: [{ type: "text", text }], ...extra });
const assistant = (text) => ({ role: "assistant", parts: [{ type: "text", text }] });
const thread = (followUp) => [
	user("What does the Bible teach about grace?"),
	assistant("## Grace\n\nGrace is the unmerited favour of God..."),
	followUp,
];

test("an opening question never gets the hint, however short", () => {
	assert.equal(turnShapeHint([user("Why?")]), null);
	assert.equal(turnShapeHint([user("Is Christ eternally begotten?")]), null);
});

test("a short follow-up in an answered conversation gets the hint", () => {
	assert.equal(turnShapeHint(thread(user("Why?"))), SHORT_FOLLOW_UP_HINT);
	assert.equal(turnShapeHint(thread(user("How does that apply to me?"))), SHORT_FOLLOW_UP_HINT);
});

test("a short follow-up that names a passage is a new study, not a follow-up", () => {
	assert.equal(turnShapeHint(thread(user("What about Romans 8:28?"))), null);
	assert.equal(turnShapeHint(thread(user("And Romans 9?"))), null);
	assert.equal(turnShapeHint(thread(user("what does rom 8:28 add?"))), null);
	assert.equal(turnShapeHint(thread(user("Ps. 23:1 too?"))), null);
});

test("a long follow-up keeps the ordinary shape", () => {
	const long = `Can you walk me through ${"how grace and works relate ".repeat(6)}`;
	assert.ok(long.length >= SHORT_FOLLOW_UP_MAX_CHARS);
	assert.equal(turnShapeHint(thread(user(long))), null);
});

test("an explicit verbosity choice always wins", () => {
	for (const verbosity of ["low", "medium", "high"]) {
		assert.equal(turnShapeHint(thread(user("Why?")), { verbosity }), null, verbosity);
	}
	assert.equal(turnShapeHint(thread(user("Why?")), { verbosity: null }), SHORT_FOLLOW_UP_HINT);
});

test("a retry with no answered turn yet is not a follow-up", () => {
	assert.equal(
		turnShapeHint([user("What is grace?"), { role: "assistant", parts: [{ type: "text", text: "  " }] }, user("Why?")]),
		null,
	);
	assert.equal(turnShapeHint([user("What is grace?"), user("Why?")]), null);
});

test("attachments, Daily Cross hand-offs and slash commands are never shortened", () => {
	assert.equal(turnShapeHint(thread(user("What's this?", { metadata: { attachmentIds: ["att_1"] } }))), null);
	assert.equal(
		turnShapeHint(thread({ role: "user", parts: [{ type: "file", mediaType: "image/png", url: "x" }, { type: "text", text: "This?" }] })),
		null,
	);
	assert.equal(
		turnShapeHint(thread(user("Go deeper", { metadata: { origin: { surface: "daily-cross" } } }))),
		null,
	);
	assert.equal(turnShapeHint(thread(user("/cross"))), null);
});

test("the hint is judged on the last user turn, even with a partial assistant turn after it", () => {
	const messages = [...thread(user("Why?")), assistant("partial")];
	assert.equal(turnShapeHint(messages), SHORT_FOLLOW_UP_HINT);
});

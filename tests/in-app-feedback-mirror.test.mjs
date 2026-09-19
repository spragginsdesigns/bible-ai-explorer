/**
 * The feedback chips are a closed set the server validates (400 on an unknown
 * id), so a client showing a chip the server has never heard of turns a
 * person's message into an error they cannot act on. The mirror is pinned
 * here, the same way tests/answer-feedback.test.mjs pins the thumbs-down chips.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (relativePath) =>
	readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

/** Pull `{ id: "x", label: "y" }` entries out of a FEEDBACK_CATEGORIES literal. */
function categories(source) {
	const block = source.match(/FEEDBACK_CATEGORIES\s*=\s*\[([\s\S]*?)\]\s*as const/);
	assert.ok(block, "FEEDBACK_CATEGORIES not found");
	return [...block[1].matchAll(/\{\s*id:\s*"([^"]+)",\s*label:\s*"([^"]+)"\s*\}/g)].map(
		([, id, label]) => ({ id, label })
	);
}

function numberConstant(source, name) {
	const match = source.match(new RegExp(`${name}\\s*=\\s*(\\d+)`));
	assert.ok(match, `${name} not found`);
	return Number(match[1]);
}

const server = read("../src/lib/feedback/in-app-feedback.ts");
const mobile = read("../mobile/src/lib/inAppFeedback.ts");

test("Android shows exactly the categories the server accepts, in the same order", () => {
	const serverCategories = categories(server);
	assert.ok(serverCategories.length >= 3, "expected a real category list");
	assert.deepEqual(categories(mobile), serverCategories);
});

test("the length limits match, so a client never lets someone write past a 400", () => {
	for (const name of ["MAX_FEEDBACK_MESSAGE_LENGTH", "MAX_REPLY_EMAIL_LENGTH"]) {
		assert.equal(
			numberConstant(mobile, name),
			numberConstant(server, name),
			`${name} differs between the server and Android`
		);
	}
});

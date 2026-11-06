import assert from "node:assert/strict";
import test from "node:test";
import { GUEST_STATUS_MARK, splitGuestStream } from "../src/lib/guest-client.ts";

test("guest step lines are shown as status and never as answer text", () => {
	const raw = `\n${GUEST_STATUS_MARK}Checking Scripture quotations and citations\n\n${GUEST_STATUS_MARK}Found a mistake in the first answer, correcting it now\n`;
	assert.deepEqual(splitGuestStream(raw), { status: "Found a mistake in the first answer, correcting it now", answer: "\n\n" });
	const done = splitGuestStream(`${raw}Psalm 103:12 says...`);
	assert.equal(done.answer.trim(), "Psalm 103:12 says...");
	assert.equal(done.answer.includes(GUEST_STATUS_MARK), false);
});

test("a stream without step lines is unchanged", () => {
	assert.deepEqual(splitGuestStream("\n\nAnswer text"), { status: null, answer: "\n\nAnswer text" });
});

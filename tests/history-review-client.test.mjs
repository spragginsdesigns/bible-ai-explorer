import assert from "node:assert/strict";
import test from "node:test";
import { checkedSavedAnswer, savedAnswerReview, savedAnswerQuery } from "../src/lib/chat/history-review.ts";

const value = { surface: "chat", parentId: "owned-parent", messageId: "answer-1", state: "withheld", code: "review_required", sourceDigest: "a".repeat(64) };
test("saved-answer controls retain only the exact owned locator and digest", () => {
	assert.deepEqual(savedAnswerReview({ ...value, injected: "discarded" }, "answer-1"), value);
	assert.equal(savedAnswerQuery(value), "surface=chat&parentId=owned-parent&messageId=answer-1");
	assert.equal(savedAnswerReview(value, "a-different-answer").code, "invalid_history_review");
});
test("malformed or already-verified metadata cannot create recheck controls", () => {
	for (const input of [null, [], "withheld", {}, ...[
		{ surface: "foreign" }, { parentId: "../other" }, { messageId: "../answer" }, { state: "verified" },
		{ state: "notice" }, { code: "Provider details: secret" }, { sourceDigest: "a".repeat(63) }, { sourceDigest: "G".repeat(64) },
	].map(change => ({ ...value, ...change }))]) assert.equal(savedAnswerReview(input, "answer-1").code, "invalid_history_review");
	assert.equal(savedAnswerReview(undefined, "answer-1"), undefined);
});

test("only exact checked state reaches the normal renderer", () => {
 const row={id:value.messageId,role:"assistant",content:"Checked",metadata:{parts:[{type:"text",text:"Checked"}]}};
 const state={state:"verified",sourceDigest:value.sourceDigest,row};
 assert.deepEqual(checkedSavedAnswer(state,value),row);
 for(const change of [{state:["verified"]},{state:"pending"},{sourceDigest:"b".repeat(64)},{row:{...row,id:"other"}},{row:{...row,metadata:{...row.metadata,historyVerification:null}}},{row:{...row,metadata:{parts:[null]}}}])assert.equal(checkedSavedAnswer({...state,...change},value),null);
});

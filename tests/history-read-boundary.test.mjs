import assert from "node:assert/strict";
import test from "node:test";
import { reviewedHistoryRow } from "../src/lib/ai/history/read-boundary.ts";

const locator = { surface: "chat", parentId: "parent", messageId: "answer" };
const raw = { id: "answer", role: "assistant", content: "UNCHECKED_PROSE", metadata: { parts: [{ type: "text", text: "UNCHECKED_PROSE" }], secretLegacyField: "UNCHECKED_METADATA" }, attachments: ["UNCHECKED_ATTACHMENT"], createdAt: "2026-10-30T00:00:00Z" };
test("blocked saved answers retain exact locator controls but no raw display fields", async () => {
	const row = { id: raw.id, role: "assistant", content: "Fixed notice.", metadata: { parts: [{ type: "text", text: "Fixed notice." }], historyVerification: { state: "withheld", code: "review_required" } } };
	const result = await reviewedHistoryRow({ get: async (owner, target) => { assert.equal(owner, "owner"); assert.deepEqual(target, locator); return { status: 200, body: { state: "withheld", sourceDigest: "a".repeat(64), row } }; } }, "owner", locator, raw);
	assert.deepEqual(result.metadata.historyVerification, { ...locator, state: "withheld", code: "review_required", sourceDigest: "a".repeat(64) });
	assert.equal(JSON.stringify(result).includes("UNCHECKED_"), false);
});
test("verified projection is authoritative, user rows remain verbatim, failures stay hidden", async () => {
	const safe = { id: raw.id, role: "assistant", content: "Checked.", metadata: { parts: [{ type: "text", text: "Checked." }] } };
	assert.deepEqual(await reviewedHistoryRow({ get: async () => ({ status: 200, body: { state: "verified", sourceDigest: "a".repeat(64), row: safe } }) }, "owner", locator, raw), { ...safe, createdAt: raw.createdAt, attachments: [] });
	const user = { ...raw, role: "user" };
	assert.equal(await reviewedHistoryRow({ get: async () => { throw new Error("User rows must not invoke verification"); } }, "owner", locator, user), user);
	for (const get of [async () => { throw new Error("Private provider details"); }, async () => ({ status: 503, body: raw }), async () => ({ status: 200, body: { state: "verified", row: { ...safe, id: "other" } } })]) {
		const result = await reviewedHistoryRow({ get }, "owner", locator, raw);
		assert.equal(JSON.stringify(result).includes("UNCHECKED_"), false);
		assert.equal(JSON.stringify(result).includes("Private provider"), false);
	}
});

test("malformed service envelopes fail closed and cannot leak blocked row fields", async () => {
 const row = { ...raw, metadata: { ...raw.metadata, historyVerification: { code: "review_required" } } };
 for (const body of [
  { state: ["verified"], sourceDigest: "a".repeat(64), row },
  { state: "verified", row },
  { state: "withheld", sourceDigest: "a".repeat(64), row },
  { state: "pending", sourceDigest: "a".repeat(64), row },
 ]) {
  const result = await reviewedHistoryRow({get: async () => ({status:200, body})}, "owner", locator, raw);
  assert.equal(JSON.stringify(result).includes("UNCHECKED_"), false);
 }
});

test("user thumbs survive withheld notices without becoming AI display authority", async () => {
 for(const feedback of ["up","down",null]) {
  const result=await reviewedHistoryRow({get:async()=>({status:503,body:null})},"owner",locator,{...raw,feedback});
  assert.equal(result.feedback,feedback);assert.equal(JSON.stringify(result).includes("UNCHECKED_"),false);
 }
});

test("a verified or notice envelope cannot erase a contradictory marker to expose prose", async () => {
	for (const state of ["verified", "notice"]) for (const historyVerification of [undefined, null, { state: "withheld" }]) {
		const row = { ...raw, metadata: { ...raw.metadata, historyVerification } };
		const result = await reviewedHistoryRow({ get: async () => ({ status: 200, body: { state, sourceDigest: "a".repeat(64), row } }) }, "owner", locator, raw);
		assert.equal(JSON.stringify(result).includes("UNCHECKED_"), false);
	}
	for (const part of [null, [], "text", {}, { type: 7 }]) {
		const row = { ...raw, metadata: { parts: [part] } };
		const result = await reviewedHistoryRow({ get: async () => ({ status: 200, body: { state: "verified", sourceDigest: "a".repeat(64), row } }) }, "owner", locator, raw);
		assert.equal(JSON.stringify(result).includes("UNCHECKED_"), false);
	}
});

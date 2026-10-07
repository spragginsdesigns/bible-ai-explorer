/**
 * Settings -> Delete account, browser half: the request the route receives
 * and the status handling shared with the Apple and Android clients.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
	DELETE_CONFIRM_MESSAGE,
	FAILED_NETWORK,
	FAILED_NOTHING_REMOVED,
	FAILED_RETRYABLE,
	FAILED_SESSION,
	initialDeletionState,
	isConfirmationTyped,
	reduceDeletion,
	requestAccountDeletion,
} from "../src/lib/account-deletion-client.ts";

const failedWith = (state) => (state.phase.kind === "failed" ? state.phase.message : null);

test("200 is done", () => {
	assert.equal(reduceDeletion(initialDeletionState, { kind: "ok" }).phase.kind, "deleted");
});

test("500 and other statuses say nothing was removed", () => {
	for (const status of [500, 400, 503]) {
		const next = reduceDeletion(initialDeletionState, { kind: "status", status });
		assert.equal(failedWith(next), FAILED_NOTHING_REMOVED);
		assert.equal(next.mayHaveDeleted, false);
	}
});

test("502 is retryable, and a 401 on the retry counts as done", () => {
	const partial = reduceDeletion(initialDeletionState, { kind: "status", status: 502 });
	assert.equal(failedWith(partial), FAILED_RETRYABLE);
	assert.equal(reduceDeletion(partial, { kind: "status", status: 401 }).phase.kind, "deleted");
});

test("a first-attempt 401 is an expired session", () => {
	assert.equal(failedWith(reduceDeletion(initialDeletionState, { kind: "status", status: 401 })), FAILED_SESSION);
});

test("offline and lost responses both arm the 401 rule", () => {
	const offline = reduceDeletion(initialDeletionState, { kind: "offline" });
	assert.equal(failedWith(offline), FAILED_NETWORK);
	assert.equal(reduceDeletion(offline, { kind: "status", status: 401 }).phase.kind, "deleted");
	const lost = reduceDeletion(initialDeletionState, { kind: "lost" });
	assert.equal(failedWith(lost), FAILED_RETRYABLE);
	assert.equal(lost.mayHaveDeleted, true);
});

test("confirmation needs exactly DELETE", () => {
	assert.equal(isConfirmationTyped(" DELETE "), true);
	assert.equal(isConfirmationTyped("delete"), false);
	assert.equal(isConfirmationTyped(""), false);
});

test("copy matches the Apple dialog word for word", () => {
	const apple = readFileSync(new URL("../macos/Shared/Settings/AccountDeletion.swift", import.meta.url), "utf8");
	assert.match(apple, /This permanently deletes your conversations, notes, highlights, memories, "\s*\+ "testimony, voice messages and your account\. This can't be undone\./);
	assert.equal(
		DELETE_CONFIRM_MESSAGE,
		"This permanently deletes your conversations, notes, highlights, memories, testimony, voice messages and your account. This can't be undone."
	);
	for (const message of [FAILED_NOTHING_REMOVED, FAILED_RETRYABLE, FAILED_NETWORK]) {
		assert.ok(apple.includes(`"${message}"`), message);
	}
});

test("sends DELETE /api/account with exactly the confirm body", async () => {
	const calls = [];
	const outcome = await requestAccountDeletion(async (url, init) => {
		calls.push([url, init]);
		return { ok: true, status: 200 };
	});
	assert.deepEqual(outcome, { kind: "ok" });
	assert.equal(calls[0][0], "/api/account");
	assert.equal(calls[0][1].method, "DELETE");
	assert.equal(calls[0][1].body, '{"confirm":"DELETE"}');
});

test("maps statuses and rejected fetches", async () => {
	assert.deepEqual(await requestAccountDeletion(async () => ({ ok: false, status: 502 })), { kind: "status", status: 502 });
	const reject = async () => {
		throw new TypeError("Failed to fetch");
	};
	assert.deepEqual(await requestAccountDeletion(reject, () => false), { kind: "offline" });
	assert.deepEqual(await requestAccountDeletion(reject, () => true), { kind: "lost" });
});

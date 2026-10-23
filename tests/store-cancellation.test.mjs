/**
 * Store subscriptions on account deletion: stop Play renewal through a mocked
 * Android Publisher client.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { stopPlayRenewal } from "../src/lib/billing/store-cancellation.ts";

function playClient(state, { cancelFails = false, readFails = false } = {}) {
	const calls = [];
	return {
		calls,
		client: {
			readState: async (token) => {
				calls.push(["read", token]);
				if (readFails) throw new Error("Google Play subscription read failed (HTTP 503).");
				return state;
			},
			cancel: async (token) => {
				calls.push(["cancel", token]);
				if (cancelFails) throw new Error("Google Play cancellation failed (HTTP 500).");
			},
		},
	};
}

test("states that can still bill are cancelled, including ON_HOLD and unknown ones", async () => {
	for (const state of [
		"SUBSCRIPTION_STATE_ACTIVE",
		"SUBSCRIPTION_STATE_IN_GRACE_PERIOD",
		"SUBSCRIPTION_STATE_ON_HOLD",
		"SUBSCRIPTION_STATE_PAUSED",
		"SUBSCRIPTION_STATE_PENDING",
		"SUBSCRIPTION_STATE_UNSPECIFIED",
		"SUBSCRIPTION_STATE_SOMETHING_NEW",
	]) {
		const { client, calls } = playClient(state);
		assert.equal(await stopPlayRenewal("tok", client), "cancelled", state);
		assert.deepEqual(calls, [["read", "tok"], ["cancel", "tok"]], state);
	}
});

test("states that never bill again, and a token Google forgot, need no cancel", async () => {
	for (const state of [
		"SUBSCRIPTION_STATE_CANCELED",
		"SUBSCRIPTION_STATE_EXPIRED",
		"SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED",
		null,
	]) {
		const { client, calls } = playClient(state);
		assert.equal(await stopPlayRenewal("tok", client), "not_billing", String(state));
		assert.deepEqual(calls, [["read", "tok"]]);
	}
});

test("a failed read or cancel throws so the account is kept", async () => {
	const read = playClient("SUBSCRIPTION_STATE_ACTIVE", { readFails: true });
	await assert.rejects(stopPlayRenewal("tok", read.client));
	assert.deepEqual(read.calls, [["read", "tok"]]);
	const cancel = playClient("SUBSCRIPTION_STATE_ACTIVE", { cancelFails: true });
	await assert.rejects(stopPlayRenewal("tok", cancel.client));
});

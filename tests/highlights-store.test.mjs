/**
 * The web reader's highlights store (src/components/bible/highlightsStore.ts),
 * a port of Android's highlightsStore: account-keyed localStorage cache,
 * per-verse serialized writes, rollback to the last server-accepted color.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
	chapterPrefix,
	chapterView,
	createHighlightsStore,
	highlightsStorageKey,
} from "../src/components/bible/highlightsStore.ts";
import { normalizeHighlightHex } from "../src/lib/highlights.ts";

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function memoryStorage(initial = {}) {
	const data = new Map(Object.entries(initial));
	return {
		data,
		getItem: (key) => (data.has(key) ? data.get(key) : null),
		setItem: (key, value) => data.set(key, value),
	};
}

function setup({ storage = memoryStorage(), fetchChapter } = {}) {
	const calls = [];
	const pending = [];
	const api = {
		fetchChapter: fetchChapter ?? (async () => []),
		put: (input) => {
			const gate = deferred();
			calls.push({ method: "PUT", input });
			pending.push(gate);
			return gate.promise;
		},
		remove: (input) => {
			const gate = deferred();
			calls.push({ method: "DELETE", input });
			pending.push(gate);
			return gate.promise;
		},
	};
	const store = createHighlightsStore({
		api,
		storage: () => storage,
		normalize: normalizeHighlightHex,
	});
	return { store, storage, calls, pending };
}

const ref = { translation: "KJV", book: 43, chapter: 3, verse: 16 };
const scope = chapterPrefix("KJV", 43, 3);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test("paints the signed-in account's cache instantly and keeps accounts apart", () => {
	const storage = memoryStorage({
		[highlightsStorageKey("user_a")]: JSON.stringify({ "KJV:43:3:16": "#f5d76e", "KJV:43:3:17": "bogus" }),
		[highlightsStorageKey("user_b")]: JSON.stringify({ "KJV:43:3:1": "#27AE60" }),
	});
	const { store } = setup({ storage });
	store.setOwner("user_a");
	assert.deepEqual([...chapterView(store.getSnapshot(), scope)], [[16, "#F5D76E"]]);
	store.setOwner("user_b");
	assert.deepEqual([...chapterView(store.getSnapshot(), scope)], [[1, "#27AE60"]]);
	store.setOwner(null);
	assert.equal(store.getSnapshot().size, 0);
});

test("writes are optimistic, cached under the account, and serialized per verse", async () => {
	const { store, storage, calls, pending } = setup();
	store.setOwner("user_a");
	const first = store.setHighlight({ ...ref, color: "#F5D76E" });
	const second = store.setHighlight({ ...ref, color: "#4A90D9" });
	assert.equal(store.getSnapshot().get("KJV:43:3:16"), "#4A90D9");
	assert.deepEqual(JSON.parse(storage.getItem(highlightsStorageKey("user_a"))), { "KJV:43:3:16": "#4A90D9" });
	await flush();
	// The second PUT waits for the first, so the server sees them in order.
	assert.equal(calls.length, 1);
	pending[0].resolve();
	await first;
	await flush();
	assert.equal(calls.length, 2);
	assert.equal(calls[1].input.color, "#4A90D9");
	pending[1].resolve();
	await second;
	assert.equal(store.getSnapshot().get("KJV:43:3:16"), "#4A90D9");
});

test("a failed newest write rolls back to the last server-accepted color", async () => {
	const { store, pending } = setup();
	store.setOwner("user_a");
	const accepted = store.setHighlight({ ...ref, color: "#F5D76E" });
	await flush();
	pending[0].resolve();
	await accepted;
	const rejected = store.setHighlight({ ...ref, color: "#E84C3D" });
	assert.equal(store.getSnapshot().get("KJV:43:3:16"), "#E84C3D");
	await flush();
	pending[1].reject(new Error("offline"));
	await assert.rejects(rejected);
	assert.equal(store.getSnapshot().get("KJV:43:3:16"), "#F5D76E");
});

test("an older failed write never undoes a newer intent", async () => {
	const { store, pending } = setup();
	store.setOwner("user_a");
	const older = store.setHighlight({ ...ref, color: "#F5D76E" });
	const newer = store.setHighlight({ ...ref, color: "#4A90D9" });
	await flush();
	pending[0].reject(new Error("offline"));
	await assert.rejects(older);
	assert.equal(store.getSnapshot().get("KJV:43:3:16"), "#4A90D9");
	await flush();
	pending[1].resolve();
	await newer;
	assert.equal(store.getSnapshot().get("KJV:43:3:16"), "#4A90D9");
});

test("a chapter refresh replaces stale cache but never clobbers a write in flight", async () => {
	const storage = memoryStorage({
		[highlightsStorageKey("user_a")]: JSON.stringify({ "KJV:43:3:1": "#F5D76E", "KJV:43:3:2": "#F5D76E" }),
	});
	const response = deferred();
	const { store } = setup({ storage, fetchChapter: () => response.promise });
	store.setOwner("user_a");
	store.refreshChapter("KJV", 43, 3);
	void store.setHighlight({ ...ref, verse: 2, color: "#9B59B6" }).catch(() => {});
	response.resolve([{ verse: 3, color: "#27ae60" }]);
	await flush();
	const view = chapterView(store.getSnapshot(), scope);
	assert.equal(view.has(1), false, "server no longer has verse 1");
	assert.equal(view.get(2), "#9B59B6", "the mid-flight write survives");
	assert.equal(view.get(3), "#27AE60");
});

test("a response for a previous account is ignored", async () => {
	const response = deferred();
	const { store } = setup({ fetchChapter: () => response.promise });
	store.setOwner("user_a");
	store.refreshChapter("KJV", 43, 3);
	store.setOwner("user_b");
	response.resolve([{ verse: 16, color: "#F5D76E" }]);
	await flush();
	assert.equal(store.getSnapshot().size, 0);
});

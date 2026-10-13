import assert from "node:assert/strict";
import test from "node:test";
import { EmbeddingCache, withAbortDeadline } from "../src/lib/ai/embedding-cache.ts";

test("identical concurrent queries share one load and callers cannot mutate retained vectors", async () => {
	const cache = new EmbeddingCache(); let calls = 0; let finish;
	const load = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
	const a = cache.get("model:3072", "faith", load); const b = cache.get("model:3072", "faith", load);
	await Promise.resolve(); assert.equal(calls, 1); finish([1, 2]);
	const [first, second] = await Promise.all([a, b]); first[0] = 99;
	assert.deepEqual(second, [1, 2]); assert.deepEqual(await cache.get("model:3072", "faith", load), [1, 2]);
	assert.deepEqual(cache.stats, {hits:1,misses:1,joined:1});
});

test("cancelling one waiter does not cancel another or cache a rejection", async () => {
	const cache = new EmbeddingCache(); const controller = new AbortController(); let finish;
	const load = () => new Promise(resolve => { finish = resolve; });
	const a = cache.get("v1", "hope", load, controller.signal); const b = cache.get("v1", "hope", load);
	controller.abort(); await assert.rejects(a, {name:"AbortError"}); finish([3]);
	assert.deepEqual(await b, [3]); assert.deepEqual(await cache.get("v1", "hope", load), [3]);
	await assert.rejects(cache.get("v1", "failure", async () => {throw Error("offline");}));
	assert.deepEqual(await cache.get("v1", "failure", async () => [4]), [4]);
});

test("expiry, capacity and model namespaces prevent stale or incompatible cache hits", async () => {
	let now = 0; let calls = 0; const cache = new EmbeddingCache(2, 10, () => now);
	const load = async () => [++calls];
	await cache.get("v1", "a", load); await cache.get("v1", "b", load); await cache.get("v1", "a", load);
	await cache.get("v1", "c", load); await cache.get("v1", "b", load); assert.equal(calls, 4);
	await cache.get("v2", "b", load); assert.equal(calls, 5);
	now = 11; await cache.get("v2", "b", load); assert.equal(calls, 6);
});

test("invalid vectors are never cached and a full pending queue degrades promptly", async () => {
	const cache = new EmbeddingCache(2, 10, Date.now, 1); let finish;
	const pending = cache.get("v1", "busy", () => new Promise(resolve => {finish = resolve;}));
	await assert.rejects(cache.get("v1", "other", async () => [1]), /queue is full/);
	await Promise.resolve(); finish([1]); await pending;
	await assert.rejects(cache.get("v1", "nan", async () => [NaN]), /Invalid embedding/);
	assert.deepEqual(await cache.get("v1", "nan", async () => [2]), [2]);
});

test("a provider ignoring abort releases its cache slot and a late success is never retained", async () => {
	const cache = new EmbeddingCache(2, 1000, Date.now, 1); let late; let signal;
	const hanging = cache.get("v1", "hang", () => withAbortDeadline(s => { signal=s; return new Promise(resolve => {late=resolve;}); }, 15));
	await assert.rejects(hanging, {name:"TimeoutError"}); assert.equal(signal.aborted,true);
	assert.deepEqual(await cache.get("v1", "other", async()=>[2]),[2]); late([99]); await Promise.resolve();
	assert.deepEqual(await cache.get("v1", "hang", async()=>[3]),[3]);
});

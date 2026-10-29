import assert from "node:assert/strict";
import { test } from "node:test";
import { VoiceDepartureGuardRegistry } from "../src/lib/voice/web-departure.ts";

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test("voice departure waits for the editor's actual flush acknowledgement", async () => {
	const guards = new VoiceDepartureGuardRegistry();
	const flush = deferred();
	const unregister = guards.register(() => flush.promise);
	let finished = false;
	const departure = guards.check().then(ok => { finished = true; return ok; });
	await Promise.resolve();
	assert.equal(finished, false);
	flush.resolve(true);
	assert.equal(await departure, true);
	unregister();
	assert.equal(await guards.check(), true);
});

test("false and thrown saves block voice navigation, after all pending guards finish", async () => {
	const guards = new VoiceDepartureGuardRegistry();
	const pending = deferred();
	guards.register(() => false);
	guards.register(() => { throw new Error("Save failed"); });
	guards.register(() => pending.promise);
	let finished = false;
	const departure = guards.check().then(ok => { finished = true; return ok; });
	await Promise.resolve();
	assert.equal(finished, false);
	pending.resolve(true);
	assert.equal(await departure, false);
});

test("changing the mounted editor while its save runs invalidates that departure", async () => {
	const guards = new VoiceDepartureGuardRegistry();
	const pending = deferred();
	const unregister = guards.register(() => pending.promise);
	const departure = guards.check();
	unregister();
	guards.register(() => true);
	pending.resolve(true);
	assert.equal(await departure, false);
	assert.equal(await guards.check(), true);
});

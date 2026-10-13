import assert from "node:assert/strict";
import test from "node:test";
import { createMessageViewCache, latestMessageIds } from "../src/lib/chat/message-view-cache.ts";

test("stream updates convert the active row while preserving settled rows and timestamps", () => {
	const cache=createMessageViewCache();const settled={id:"old"};let active={id:"active"};let calls=0;
	const project=(m,context)=>cache.get(m,context,timestamp=>({timestamp,serial:++calls}));
	const old=project(settled,"settled");const first=project(active,"streaming");
	for(let i=0;i<10;i++){active={id:"active"};assert.equal(project(settled,"settled"),old);assert.equal(project(active,"streaming").timestamp,first.timestamp);}
	assert.equal(calls,12);assert.notEqual(project(active,"finished"),project(active,"streaming"));
});

test("feedback/context changes and edited history invalidate rows; removed history is evicted", () => {
	const cache=createMessageViewCache();const a={id:"a"};const convert=timestamp=>({timestamp});
	const first=cache.get(a,"thread:one",convert);
	assert.notEqual(cache.get(a,"thread:two",convert),first);
	assert.notEqual(cache.get({...a},"thread:two",convert),first);
	cache.retain(new Set());assert.notEqual(cache.get(a,"thread:one",convert),first);
});

test("latest roles are found without mutating message order", () => {
	const messages=Object.freeze([{id:"u1",role:"user"},{id:"a1",role:"assistant"},{id:"u2",role:"user"},{id:"a2",role:"assistant"}]);
	assert.deepEqual(latestMessageIds(messages),{assistant:"a2",user:"u2"});assert.deepEqual(latestMessageIds([]),{});
});

test("long retained histories preserve all settled identities and timestamps", () => {
	const cache = createMessageViewCache();
	const history = Array.from({ length: 1001 }, (_, i) => ({ id: String(i) }));
	let conversions = 0;
	const project = rows => rows.map(row => cache.get(row, "settled", timestamp => ({ timestamp, serial: ++conversions })));
	const first = project(history);
	cache.retain(new Set(history.map(row => row.id)));
	const second = project(history);
	assert.equal(conversions, 1001);
	second.forEach((view, i) => assert.equal(view, first[i]));
	cache.retain(new Set([history[0].id]));
	assert.equal(project([history[0]])[0], first[0]);
	assert.notEqual(project([history[1]])[0], first[1]);
});

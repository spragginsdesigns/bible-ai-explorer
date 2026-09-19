import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const read = (relativePath) =>
	readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

function loadModule(relativePath, exportNames, injected = {}) {
	const source = read(relativePath)
		.replace(/^import\s[^;]*?;\s*$/gm, "")
		.replace(/^export /gm, "");
	const names = Object.keys(injected);
	const factory = new Function(
		...names,
		`${stripTypeScriptTypes(source)}\nreturn { ${exportNames.join(", ")} };`
	);
	return factory(...names.map((name) => injected[name]));
}

/** What getAuthUser throws for a request with no Clerk session. */
const unauthorized = () => {
	throw new Response(JSON.stringify({ error: "Unauthorized", code: "unauthorized" }), {
		status: 401,
		headers: { "Content-Type": "application/json" },
	});
};

const NextResponse = {
	json: (body, init) => ({ status: init?.status ?? 200, body }),
};

/** Every call the handlers could make to the queue, all of them forbidden. */
function forbiddenLearn(reached) {
	return new Proxy(
		{},
		{
			get: (_target, name) => async () => {
				reached.push(String(name));
				throw new Error(`${String(name)} ran without a session`);
			},
		}
	);
}

const ROUTES = [
	{
		name: "GET /api/learn/today",
		path: "../src/app/api/learn/today/route.ts",
		handler: "GET",
		call: (handlers) => handlers.GET(),
	},
	{
		name: "POST /api/learn",
		path: "../src/app/api/learn/route.ts",
		handler: "POST",
		call: (handlers) =>
			handlers.POST({
				json: async () => ({
					book: 43,
					chapter: 3,
					verse: 16,
					translation: "KJV",
					source: "sheet",
				}),
			}),
	},
	{
		name: "POST /api/learn/[id]/review",
		path: "../src/app/api/learn/[id]/review/route.ts",
		handler: "POST",
		call: (handlers) =>
			handlers.POST({ json: async () => ({ result: "good" }) }, {
				params: Promise.resolve({ id: "card-1" }),
			}),
	},
	{
		name: "DELETE /api/learn/[id]",
		path: "../src/app/api/learn/[id]/route.ts",
		handler: "DELETE",
		call: (handlers) =>
			handlers.DELETE({}, { params: Promise.resolve({ id: "card-1" }) }),
	},
];

for (const route of ROUTES) {
	test(`${route.name} answers 401 and touches nothing without a session`, async () => {
		const reached = [];
		const learn = forbiddenLearn(reached);
		const handlers = loadModule(route.path, [route.handler], {
			NextResponse,
			z,
			getAuthUser: async () => unauthorized(),
			todayCards: learn.todayCards,
			addCard: learn.addCard,
			learnVerseText: learn.learnVerseText,
			reviewCardById: learn.reviewCardById,
			removeCard: learn.removeCard,
		});

		const response = await route.call(handlers);
		// The 401 Response getAuthUser throws is re-returned as-is, not swallowed
		// by the catch and reported as a 500.
		assert.ok(response instanceof Response, `${route.name} returned ${typeof response}`);
		assert.equal(response.status, 401);
		assert.deepEqual(await response.json(), { error: "Unauthorized", code: "unauthorized" });
		assert.deepEqual(reached, []);
	});
}

test("every learn route calls getAuthUser before anything else", () => {
	for (const route of ROUTES) {
		const source = read(route.path);
		const body = source.slice(source.indexOf(`export async function ${route.handler}`));
		const firstAwait = body.indexOf("await ");
		assert.ok(
			body.slice(firstAwait, firstAwait + 40).includes("getAuthUser()"),
			`${route.name} awaits something before getAuthUser()`
		);
	}
});

const validReview = {
 result: "good", operationId: "fca6bc76-c0f4-402d-bda9-765a4f2295eb", expectedRevision: 0,
 reviewedAt: "2025-09-12T18:00:00.000Z", timezone: "America/Los_Angeles",
};
class ReviewConflict extends Error {
 constructor(code, currentCard = null) { super(code); this.code = code; this.currentCard = currentCard; }
}
function reviewRoute(overrides = {}) {
 const calls = [];
 const analytics = [];
 const handlers = loadModule("../src/app/api/learn/[id]/review/route.ts", ["POST"], {
  NextResponse, z, getAuthUser: async () => "alice", LearnReviewConflict: ReviewConflict,
  reviewCardById: async (...args) => { calls.push(args); return {id: "card", revision: 1}; },
  reviewCardOperation: async (...args) => { calls.push(args); return {operationId: args[2].operationId, appliedRevision:1, replayed:false, currentCard:{id:"card",revision:1}}; },
  captureServerEvent: (event) => analytics.push(event),
  flushAnalytics: async () => {},
  ANALYTICS_EVENTS: { learnReviewed: "learn_reviewed" },
  platformFromHeaders: (headers) => headers.get("x-sureword-client") ?? "unknown",
  ...overrides,
 });
 return {calls, analytics, send: (body) => handlers.POST(
  {json:async()=>body, headers:new Headers({"x-sureword-client":"android"})},
  {params:Promise.resolve({id:"card"})},
 )};
}
test("review route retains legacy response and uses modern acknowledgement",async()=>{
 const route=reviewRoute();
 assert.deepEqual((await route.send({result:"good"})).body,{id:"card",revision:1});
 const modern=await route.send(validReview);assert.equal(modern.body.appliedRevision,1);
 assert.deepEqual(route.calls[1],["alice","card",validReview]);
 // Both shapes are one review each, and neither carries the verse.
 assert.deepEqual(route.analytics,[
  {userId:"alice",event:"learn_reviewed",platform:"android",properties:{result:"good"}},
  {userId:"alice",event:"learn_reviewed",platform:"android",properties:{result:"good"}},
 ]);
});
test("partial, impossible, future and invalid-zone modern reviews never reach database",async()=>{
 const route=reviewRoute();
 const invalid=[
  {result:"good",operationId:validReview.operationId},
  {...validReview,operationId:"not-uuid"}, {...validReview,expectedRevision:-1},
  {...validReview,reviewedAt:"2025-02-30T12:00:00.000Z"},
  {...validReview,reviewedAt:"9999-01-01T12:00:00.000Z"},
  {...validReview,reviewedAt:"0001-01-01T12:00:00.000Z"},
  {...validReview,timezone:"+02:00"}, {...validReview,timezone:"Not/AZone"}, {...validReview,timezone:""},
 ];
 for(const body of invalid) assert.equal((await route.send(body)).status,400,JSON.stringify(body));
 assert.equal(route.calls.length,0);
});
test("conflicts and deleted receipt acknowledgement preserve exact public shapes",async()=>{
 const currentCard={id:"card",revision:3};
 const conflict=reviewRoute({reviewCardOperation:async()=>{throw new ReviewConflict("revision_conflict",currentCard)}});
 assert.deepEqual(await conflict.send(validReview),{status:409,body:{error:"revision_conflict",code:"revision_conflict",currentCard}});
 const replay=reviewRoute({reviewCardOperation:async()=>({operationId:validReview.operationId,appliedRevision:1,replayed:true,currentCard:null})});
 assert.equal((await replay.send(validReview)).body.currentCard,null);
 // A replayed operation is the same review twice, so it must not be counted twice.
 assert.deepEqual(replay.analytics,[]);
 assert.deepEqual(conflict.analytics,[]);
});
test("add distinguishes invalid coordinates from unavailable requested translation",async()=>{
 let writes=0;
 const {POST}=loadModule("../src/app/api/learn/route.ts",["POST"],{
  NextResponse,z,getAuthUser:async()=>"alice",
  learnVerseText:async(translation,_book,_chapter,verse)=>translation==="KJV"&&verse===16?"KJV text":undefined,
  addCard:async()=>{writes++;throw new Error("should not write")},
 });
 const body={book:43,chapter:3,verse:16,translation:"NKJV",source:"sheet"};
 assert.equal((await POST({json:async()=>body})).status,503);
 assert.equal((await POST({json:async()=>({...body,verse:199})})).status,400);
 assert.equal(writes,0);
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { applePushSessionId, authorizeApplePushJobs } from "../src/lib/apple-push-session.ts";
import { apnsRecipientsOf } from "../src/lib/apns.ts";
import * as audience from "../src/lib/push-audience.ts";
import * as routing from "../src/lib/push-routing.ts";

const HEX = "ab".repeat(32);
const TOKEN = `apns:production:${HEX}`;
const binding = () => ({ id: "row_a", token: TOKEN, userId: "user_a", clerkSessionId: "sess_a" });
const session = () => ({ id: "sess_a", userId: "user_a", clientId: "client_a", status: "active" });
const client = () => ({ id: "client_a", sessionIds: ["sess_a"], lastActiveSessionId: "sess_a" });
const job = () => ({
	userId: "user_a", message: { title: "QA", body: "PRIVATE_ANSWER", data: { screen: "chat" } },
	recipients: [{ tokenId: "row_a", environment: "production", deviceToken: HEX }],
});

function fixture() {
	const state = { rows: [binding()], session: session(), client: client() };
	const calls = { bindings: 0, sessions: 0, clients: 0 };
	const dependencies = {
		loadBindings: async () => { calls.bindings += 1; return state.rows.map((row) => ({ ...row })); },
		getSession: async () => { calls.sessions += 1; return { ...state.session }; },
		getClient: async () => { calls.clients += 1; return { ...state.client }; },
	};
	return { state, calls, dependencies };
}

test("registration binds only a valid session from the matching trusted authentication", () => {
	assert.equal(applePushSessionId({ userId: "user_a", sessionId: "sess_a" }, "user_a"), "sess_a");
	for (const sid of [null, undefined, "", " ", "other_a", "sess_", "sess_a/other"]) {
		assert.equal(applePushSessionId({ userId: "user_a", sessionId: sid }, "user_a"), null);
	}
	assert.equal(applePushSessionId({ userId: "user_b", sessionId: "sess_a" }, "user_a"), null);
});

test("a current active session, current client and selected owner authorize Apple delivery", async () => {
	const f = fixture();
	const result = await authorizeApplePushJobs([job()], f.dependencies);
	assert.equal(result.jobs[0].recipients.length, 1);
	assert.deepEqual(result.bindings, [binding()]);
	assert.equal(result.skipped, 0);
	assert.deepEqual(f.calls, { bindings: 2, sessions: 1, clients: 1 });
});

for (const status of ["ended", "revoked", "removed", "abandoned"]) {
	test(`a ${status} Clerk session cannot receive an Apple push`, async () => {
		const f = fixture(); f.state.session.status = status;
		const result = await authorizeApplePushJobs([job()], f.dependencies);
		assert.deepEqual(result.jobs, []);
		assert.equal(result.skipped, 1);
		assert.equal(f.calls.clients, 0);
	});
}

test("account switching blocks the old session even when Clerk still reports it active", async () => {
	const f = fixture();
	f.state.client.sessionIds.push("sess_b");
	f.state.client.lastActiveSessionId = "sess_b";
	assert.equal((await authorizeApplePushJobs([job()], f.dependencies)).skipped, 1);
});

for (const [name, change] of [
	["session owner mismatch", (f) => { f.state.session.userId = "user_b"; }],
	["session ID mismatch", (f) => { f.state.session.id = "sess_b"; }],
	["client ID mismatch", (f) => { f.state.client.id = "client_b"; }],
	["session absent from client", (f) => { f.state.client.sessionIds = []; }],
	["missing session binding", (f) => { f.state.rows[0].clerkSessionId = null; }],
	["missing row", (f) => { f.state.rows = []; }],
	["changed token", (f) => { f.state.rows[0].token = `apns:development:${HEX}`; }],
	["row moved to another owner", (f) => { f.state.rows[0].userId = "user_b"; }],
]) {
	test(`${name} fails closed without deleting a binding`, async () => {
		const f = fixture(); change(f);
		const before = structuredClone(f.state.rows);
		const result = await authorizeApplePushJobs([job()], f.dependencies);
		assert.deepEqual(result.jobs, []);
		assert.equal(result.skipped, 1);
		assert.deepEqual(f.state.rows, before);
	});
}

for (const lookup of ["loadBindings", "getSession", "getClient"]) {
	test(`${lookup} failure skips Apple delivery without throwing`, async () => {
		const f = fixture(); f.dependencies[lookup] = async () => { throw new Error("lookup unavailable"); };
		assert.equal((await authorizeApplePushJobs([job()], f.dependencies)).skipped, 1);
	});
}

test("rebinding while Clerk is being read cannot send the old owner's queued answer", async () => {
	for (const sameOwner of [false, true]) {
		const f = fixture();
		f.dependencies.getClient = async () => {
			f.state.rows[0] = { ...binding(), userId: sameOwner ? "user_a" : "user_b", clerkSessionId: "sess_b" };
			return client();
		};
		const result = await authorizeApplePushJobs([job()], f.dependencies);
		assert.deepEqual(result.jobs, []);
		assert.equal(result.skipped, 1);
	}
});

test("lookup results are memoized within one batch and refreshed for the next batch", async () => {
	const f = fixture();
	const first = await authorizeApplePushJobs([job(), job()], f.dependencies);
	assert.equal(first.jobs.length, 2);
	assert.equal(f.calls.sessions, 1);
	assert.equal(f.calls.clients, 1);
	f.state.session.status = "revoked";
	assert.equal((await authorizeApplePushJobs([job()], f.dependencies)).skipped, 1);
	assert.equal(f.calls.sessions, 2);
});

test("two messages cannot infer their audience owner from the same current token row", async () => {
	const f = fixture();
	const result = await authorizeApplePushJobs([job(), { ...job(), userId: "user_b" }], f.dependencies);
	assert.equal(result.jobs.length, 1);
	assert.equal(result.skipped, 1);
});

/** Execute the production dispatcher with transport/auth/database boundaries injected. */
function dispatcher(f, onSend = () => {}) {
	const calls = { apns: [], expo: [], deletes: [], logs: [] };
	const prisma = { pushToken: {
		findMany: async () => f.state.rows.map((row) => ({ ...row })),
		deleteMany: async ({ where }) => {
			calls.deletes.push(where);
			const before = f.state.rows.length;
			f.state.rows = f.state.rows.filter((row) => !Object.entries(where).every(([key, value]) => row[key] === value));
			return { count: before - f.state.rows.length };
		},
	} };
	const modules = {
		"web-push": { WebPushError: class extends Error {}, sendNotification: async () => {} },
		"@clerk/nextjs/server": { clerkClient: async () => ({
			sessions: { getSession: f.dependencies.getSession }, clients: { getClient: f.dependencies.getClient },
		}) },
		"@/lib/apns": { apnsRecipientsOf, sendApnsJobs: async (jobs) => {
			calls.apns.push(jobs);
			return onSend(jobs) ?? { sent: jobs.flatMap((job) => job.recipients).length, failed: 0, retiredTokenIds: [], skipped: false };
		} },
		"@/lib/apple-push-session": { authorizeApplePushJobs },
		"@/lib/prisma": { prisma }, "@/lib/push-audience": audience, "@/lib/push-routing": routing,
	};
	const code = ts.transpileModule(readFileSync(new URL("../src/lib/push.ts", import.meta.url), "utf8"), {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
	}).outputText;
	const module = { exports: {} };
	new Function("require", "module", "exports", "fetch", "console", code)((id) => {
		assert.ok(id in modules, `Unexpected dispatcher import ${id}`);
		return modules[id];
	}, module, module.exports, async (_url, request) => {
		calls.expo.push(JSON.parse(request.body));
		return { ok: true, json: async () => ({ data: [{ status: "ok" }] }) };
	}, { info: (...args) => { calls.logs.push(args.join(" ")); }, error: () => {} });
	return { send: module.exports.sendPushMessages, calls };
}

const pending = (recipients) => ({ userId: "user_a", recipients, title: "QA", body: "PRIVATE_ANSWER", data: {}, channelId: "chat-replies" });

test("the production dispatcher sends an authorized raw token and logs counts only", async () => {
	const f = fixture(); const d = dispatcher(f);
	await d.send([pending([{ tokenId: "row_a", to: TOKEN }])], "chat-reply-push");
	assert.equal(d.calls.apns[0][0].recipients.length, 1);
	const logs = d.calls.logs.join("\n");
	for (const secret of [HEX, "user_a", "sess_a", "client_a", "PRIVATE_ANSWER", "row_a"]) assert.equal(logs.includes(secret), false);
	assert.match(logs, /"sent":1/);
});

test("unbound raw rows are skipped while legacy Expo recipients still send normally", async () => {
	const f = fixture(); f.state.rows[0].clerkSessionId = null;
	const d = dispatcher(f);
	await d.send([pending([{ tokenId: "row_a", to: TOKEN }, { tokenId: "expo_a", to: "ExponentPushToken[legacy]" }])], "chat-reply-push");
	assert.deepEqual(d.calls.apns[0], []);
	assert.equal(d.calls.expo[0][0].to, "ExponentPushToken[legacy]");
	assert.equal(f.calls.sessions, 0);
	assert.match(d.calls.logs.join("\n"), /"skipped":1/);
});

test("dead-token cleanup cannot delete a row rebound after dispatch", async () => {
	const f = fixture();
	const d = dispatcher(f, () => {
		f.state.rows[0] = { ...binding(), userId: "user_b", clerkSessionId: "sess_b" };
		return { sent: 0, failed: 0, retiredTokenIds: ["row_a"], skipped: false };
	});
	const retired = await d.send([pending([{ tokenId: "row_a", to: TOKEN }])], "chat-reply-push");
	assert.deepEqual(d.calls.deletes, [binding()]);
	assert.equal(f.state.rows[0].userId, "user_b");
	assert.equal(retired, 0);
});

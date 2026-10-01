import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { z } from "zod";
import { narrationSettings } from "../src/lib/daily-cross-audio-options.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function loadRoute(injected) {
	const source = read("src/app/api/verse-of-day/audio/route.ts").replace(/^import\s[^;]*?;\s*$/gm, "").replace(/^export /gm, "");
	return new Function(...Object.keys(injected), `${stripTypeScriptTypes(source)}; return { GET, POST };`)(...Object.values(injected));
}
function fixture(auth = async () => "reader") {
	const calls = [];
	const audio = { status: "none", plan: "pro" };
	const route = loadRoute({
		z, NextResponse: { json: (body, init = {}) => Response.json(body, init) },
		getAuthUser: auth, readDailyCrossAudio: async () => { calls.push("read"); return audio; },
		getOrCreateDailyCrossAudio: async (userId, options) => { calls.push({ userId, options }); return { ...audio, status: "ready" }; },
		captureServerEvent: () => {}, flushAnalytics: async () => {}, ANALYTICS_EVENTS: { listenRequested: "listen" }, platformFromHeaders: () => "web",
	});
	return { route, calls };
}

test("opening audio reads state and cannot request generation", async () => {
	const { route, calls } = fixture();
	const response = await route.GET(new Request("https://sureword.app/api/verse-of-day/audio"));
	assert.equal((await response.json()).status, "none");
	assert.deepEqual(calls, ["read"]);
});

test("explicit generation forwards the chosen voice and delivery", async () => {
	const { route, calls } = fixture();
	const response = await route.POST(new Request("https://sureword.app/api/verse-of-day/audio", { method: "POST", body: JSON.stringify({ voiceId: "voice_123", style: "calm" }) }));
	assert.equal(response.status, 200);
	assert.deepEqual(calls, [{ userId: "reader", options: { voiceId: "voice_123", style: "calm" } }]);
});

test("invalid options and malformed JSON never reach a billable service", async () => {
	for (const body of ['{', '{"style":"wild"}', '{"voiceId":""}', '{"userId":"other"}', 'null', '[]']) {
		const { route, calls } = fixture();
		const response = await route.POST(new Request("https://sureword.app/api/verse-of-day/audio", { method: "POST", body }));
		assert.equal(response.status, 400, body);
		assert.deepEqual(calls, []);
	}
});

test("older clients can explicitly request the default voice with an empty POST", async () => {
	const { route, calls } = fixture();
	assert.equal((await route.POST(new Request("https://sureword.app/api/verse-of-day/audio", { method: "POST" }))).status, 200);
	assert.deepEqual(calls, [{ userId: "reader", options: {} }]);
});

test("both audio handlers reject a missing session before reading or generating", async () => {
	const { route, calls } = fixture(async () => { throw new Response("Unauthorized", { status: 401 }); });
	for (const handler of [route.GET, route.POST]) assert.equal((await handler(new Request("https://sureword.app/api/verse-of-day/audio"))).status, 401);
	assert.deepEqual(calls, []);
});

test("all automatic Daily Cross entry points stay free of narration triggers", () => {
	for (const path of ["src/lib/daily-cross.ts", "src/lib/ai-tools.ts", "src/app/api/verse-of-day/today/route.ts", "src/app/api/cron/verse-of-day/route.ts"]) assert.doesNotMatch(read(path), /scheduleDailyCrossAudio|getOrCreateDailyCrossAudio/, path);
});

test("web and Android agree on delivery choices and request settings", () => {
	assert.equal(read("src/lib/daily-cross-audio-options.ts").replaceAll("\r", ""), read("mobile/src/features/cross/narrationOptions.ts").replaceAll("\r", ""));
	assert.ok(narrationSettings("calm").stability > narrationSettings("natural").stability);
	assert.ok(narrationSettings("expressive").style > narrationSettings("natural").style);
});

test("the voice picker excludes account clones, reuses metadata, and never synthesizes previews", async () => {
	const calls = [];
	const source = read("src/lib/daily-cross-voices.ts").replace(/^import\s[^;]*?;\s*$/gm, "").replace(/^export /gm, "");
	const catalog = [
		{ voice_id: "private", name: "A private clone", category: "cloned", preview_url: "https://private.example/audio.mp3" },
		{ voice_id: "public", name: "Public narrator", category: "premade", preview_url: "https://public.example/audio.mp3" },
	];
	const fetch = async (url, init) => {
		calls.push({ url, method: init.method ?? "GET" });
		return Response.json(url.includes("/v2/voices") ? { voices: catalog } : { voice_id: "UgBBYS2sOqTuMpoF3BR0", name: "Mark", category: "professional" });
	};
	const { readNarrationVoices } = new Function("process", "fetch", `${stripTypeScriptTypes(source)}; return { readNarrationVoices };`)({ env: { ELEVENLABS_API_KEY: "fixture" } }, fetch);
	const first = await readNarrationVoices();
	const second = await readNarrationVoices();
	assert.deepEqual(first.voices.map((voice) => voice.id), ["UgBBYS2sOqTuMpoF3BR0", "public"]);
	assert.deepEqual(second, first);
	assert.equal(calls.length, 2);
	assert.ok(calls.every((call) => call.method === "GET" && !call.url.includes("text-to-speech")));
});

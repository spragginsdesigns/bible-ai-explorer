import assert from "node:assert/strict";
import { performance as realPerformance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import React from "react";
import TestRenderer from "react-test-renderer";
import ts from "typescript";

const { act } = TestRenderer;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const forbiddenFetch = () => { throw new Error("External network is forbidden in mounted voice tests"); };
const originalFetch = globalThis.fetch;
globalThis.fetch = forbiddenFetch;
process.once("exit", () => { globalThis.fetch = originalFetch; });

function deferred() {
	let resolve, reject;
	const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}
function load(path, dependencies = {}, globals = {}) {
	const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
	const compiled = ts.transpileModule(source, { compilerOptions: {
		module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
		jsx: ts.JsxEmit.React, esModuleInterop: true,
	} }).outputText;
	const module = { exports: {} };
	new Function("require", "module", "exports", ...Object.keys(globals), compiled)(name => {
		assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
		return dependencies[name];
	}, module, module.exports, ...Object.values(globals));
	return module.exports;
}
const actions = load("src/lib/voice/web-actions.ts");
const commands = load("src/lib/voice/voice-commands.ts");
const cards = load("src/lib/guide-cards.ts");
const chatSource = readFileSync(new URL("../src/components/BibleAIExplorer.tsx", import.meta.url), "utf8");
const bindingAnchor = chatSource.indexOf("const bindingKey = voiceConversationKey;");
const bindingStart = Math.max(chatSource.lastIndexOf("useEffect(() => {", bindingAnchor), chatSource.lastIndexOf("useLayoutEffect(() => {", bindingAnchor));
const bindingEnd = chatSource.indexOf("}, [voiceControls, voiceConversationKey, voiceBusy, voiceReplyReady, cancelEditing]);", bindingAnchor);
assert.ok(bindingAnchor > 0 && bindingStart >= 0 && bindingEnd > bindingAnchor);
const actualChatBinding = new Function("useEffect", "useLayoutEffect", "voiceControls", "voiceConversationKey", "voiceBusy", "voiceReplyReady", "cancelEditing", "voiceSendRef", ts.transpileModule(chatSource.slice(bindingStart, bindingEnd + "}, [voiceControls, voiceConversationKey, voiceBusy, voiceReplyReady, cancelEditing]);".length), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText);

async function settle() { for (let i = 0; i < 12; i += 1) await Promise.resolve(); }

function harness({ eligibility, welcome = false, welcomeRequest, scope = true, chat = false, concurrent = false } = {}) {
	let identity = { userId: "owner", sessionId: "session-one", isLoaded: true };
	let view, controls, controlExports, active, layoutAction;
	let choices = 0, mounts = 0, unmounts = 0, commits = 0, layoutUnmounts = 0, passiveCommits = 0;
	let commitSignal = null;
	const committed = () => { if (!commitSignal) return; const signal = commitSignal; commitSignal = null; signal(); if (concurrent) { const end = realPerformance.now() + 12; while (realPerformance.now() < end) {} } };
	let pathname = "/", welcomeActive = welcome, welcomeConversation = "welcome-conversation", scopeMounted = true, chatMounted = true, chatLayoutUnmounts = 0, scopeLayoutUnmounts = 0;
	const captures = [], engines = [], spoken = [], outputs = [], requests = [], audio = [], deviceSpeech = [], sends = [], routes = [];
	const timers = new Map();
	let nextTimer = 0, holdOutput = () => false;
	const events = new Map();
	const add = (name, fn) => { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(fn); };
	const remove = (name, fn) => events.get(name)?.delete(fn);
	const window = { location: { pathname: "/", search: "", hash: "" }, addEventListener: add, removeEventListener: remove,
		speechSynthesis: { speak: utterance => { deviceSpeech.push(utterance); }, cancel() {} } };
	const document = { visibilityState: "visible", addEventListener: add, removeEventListener: remove };
	const clock = { setTimeout: fn => { const id = ++nextTimer; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id) };
	class Audio {
		constructor(url) { this.url = url; audio.push(this); }
		play() { this.played = true; return Promise.resolve(); }
		pause() { this.paused = true; }
		removeAttribute(name) { if (name === "src") this.removed = true; }
		load() {}
	}
	const globals = { window, document, ...clock, AbortController, Audio, SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } } };
	const narration = load("src/lib/voice/web-narration.ts", { "./voice-commands": commands }, globals);
	const realSpeech = load("src/lib/voice/web-speech.ts", {}, globals);
	const speech = {
		browserRecognitionFactory: () => () => {
			const recognition = { start() { this.started = true; }, abort() { this.aborted = true; } };
			captures.push(recognition); return recognition;
		},
		SpeechCommandSession: class extends realSpeech.SpeechCommandSession {
			constructor(config) { super(config); engines.push({ engine: this, config }); }
		},
	};
	const clerk = { useAuth: () => identity };
	const fetch = async (path, options) => {
		assert.equal(path, "/api/voice/live");
		const request = { identity: { ...identity }, options };
		requests.push(request);
		return eligibility ? eligibility(request, requests.length - 1) : Response.json({ pro: true });
	};
	const voiceNarration = { ...narration, speakVoiceStatus: text => {
		spoken.push(text);
		const held = deferred();
		const output = { text, ...held, cancelled: false, cancel() { this.cancelled = true; } };
		outputs.push(output);
		// Deliberately ignore cancellation on held output, just like a late
		// browser callback. Session guards must reject its eventual completion.
		if (!holdOutput(text)) held.resolve();
		return { done: held.promise, cancel: () => output.cancel() };
	} };
	const provider = load("src/components/voice/VoiceControlProvider.tsx", {
		react: React, "@clerk/nextjs": clerk,
		"next/navigation": { usePathname: () => pathname, useRouter: () => ({ push: path => routes.push(path) }) },
		"@/lib/voice/web-departure": { confirmVoiceDeparture: async () => true },
		"@/lib/voice/voice-commands": commands, "@/lib/voice/web-actions": actions,
		"@/lib/voice/web-speech": speech, "@/lib/voice/web-narration": voiceNarration,
	}, { ...globals, fetch });
	const welcomeCalls = [];
	const hook = load("src/components/walk/useWelcomeVoice.ts", {
		react: React, "@clerk/nextjs": clerk, "@/lib/guide-cards": cards,
		"@/lib/voice/web-narration": narration, "../voice/VoiceControlProvider": provider,
		"@/lib/walk-client": { requestWelcomeVoice: async (item, signal) => {
			const request = { item, signal, identity: { ...identity } }; welcomeCalls.push(request);
			return welcomeRequest ? welcomeRequest(request, welcomeCalls.length - 1) : { status: "device", text: "Current welcome answer" };
		} },
	}, globals);
	let messages = [{ id: "saved-welcome", role: "assistant" }];
	function ChoiceScope() { React.useLayoutEffect(() => () => { scopeLayoutUnmounts += 1; }, []); provider.useVoiceActionScope({ key: "choice", question: "Choose your role", actions: [{ label: "Pastor", run: () => { choices += 1; } }] }); return null; }
 function ActualChatBinding() {
  const controls = provider.useVoiceControls();
  const ref = React.useRef({ key: "conversation", send: async text => { sends.push(text); } });
  actualChatBinding(React.useEffect, React.useLayoutEffect, controls, "conversation", false, true, () => {}, ref);
  React.useLayoutEffect(() => () => { chatLayoutUnmounts += 1; }, []);
  return null;
 }
	function Probe() {
		controls = provider.useVoiceControls();
		active = provider.useVoiceControlsActive();

		hook.useWelcomeVoice(welcomeActive, welcomeConversation, messages);
		React.useLayoutEffect(() => { commits += 1; committed(); });
		React.useEffect(() => { passiveCommits = commits; });
		React.useLayoutEffect(() => () => { layoutUnmounts += 1; committed(); }, []);
		React.useEffect(() => { mounts += 1; return () => { unmounts += 1; }; }, []);
		React.useLayoutEffect(() => { layoutAction?.(); });
		controlExports = controls;
		return React.createElement(React.Fragment, null, scope && scopeMounted ? React.createElement(ChoiceScope) : null, chat && chatMounted ? React.createElement(ActualChatBinding) : null);
	}
	const element = () => React.createElement(provider.default, { children: React.createElement(Probe) });
	const button = label => view.root.findAllByType("button").find(node => node.children.includes(label));
	return {
		captures, engines, spoken, outputs, requests, audio, deviceSpeech, sends, routes, welcomeCalls, narration,
		get choices() { return choices; }, get mounts() { return mounts; }, get unmounts() { return unmounts; },
        async commitUpdate(next) {
            const before = commits; const commit = new Promise(resolve => { commitSignal = resolve; });
            pathname = next.pathname ?? pathname; window.location.pathname = pathname; scopeMounted = next.scopeMounted ?? scopeMounted; chatMounted = next.chatMounted ?? chatMounted;
            welcomeActive = next.welcome ?? welcomeActive; welcomeConversation = next.conversation ?? welcomeConversation; messages = next.messages ?? messages;
            view.update(element()); await commit; assert.ok(commits > before, "The updated tree must actually commit");
            return { committed: true, mounts, unmounts, chatLayoutUnmounts, scopeLayoutUnmounts, passivePending: passiveCommits < commits };
        },
        async commitUnmount() {
            const commit = new Promise(resolve => { commitSignal = resolve; }); view.unmount(); await commit; assert.equal(layoutUnmounts, 1); assert.throws(() => view.root, /unmounted/);
            assert.equal(unmounts, 0, "The witness passive cleanup must still be pending");
            return { committed: true, layoutUnmounts, passiveUnmounts: unmounts };
        },
		get active() { return active; }, get controls() { return controlExports; },
		get startButton() { return button("Start voice controls"); },
		async mount() { await act(async () => { view = TestRenderer.create(element(), concurrent ? { unstable_isConcurrent: true } : undefined); await settle(); }); },
		async render(next, beforePassiveEffects) { identity = { ...identity, ...next }; layoutAction = beforePassiveEffects;
			await act(async () => { view.update(element()); await settle(); }); layoutAction = undefined; },
		async flush() { await act(settle); },
		async start() { await act(async () => { const start = button("Start voice controls"); assert.ok(start && !start.props.disabled); start.props.onClick(); await settle(); }); },
		async stop() { await act(async () => { controls.stop(); await settle(); }); },
		holdSpeech(predicate) { holdOutput = predicate; },
		async finishOutput(text, failure = false) { const output = outputs.find(item => item.text === text); assert.ok(output, `Missing held output ${text}`);
			await act(async () => { if (failure) output.reject(new Error("Late cancelled speech")); else output.resolve(); await settle(); }); },
		commandBeforePassive(text) { const current = engines.at(-1).config; return current.onFinal(text, current.revision()); },
		async command(text) { let operation; await act(async () => { const current = engines.at(-1).config;
			operation = current.onFinal(text, current.revision()); await settle(); }); return { done: operation }; },
		async tick() { await act(async () => { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); await settle(); }); },
		async unmount() { await act(async () => { view.unmount(); outputs.forEach(output => output.resolve()); await settle(); }); },
	};
}

for (const invalidation of [{ sessionId: "session-two" }, { userId: "other", sessionId: "other-session" }, { sessionId: null }, { isLoaded: false }]) {
	test(`held choice cannot execute after Clerk identity changes: ${JSON.stringify(invalidation)}`, async () => {
		const h = harness();
		try {
			await h.mount(); await h.start(); assert.equal(h.captures.length, 1);
			h.holdSpeech(text => text === "Choosing Pastor.");
			await h.command("option one"); await h.flush();
			assert.ok(h.outputs.some(output => output.text === "Choosing Pastor."));
			await h.render(invalidation);
			await h.finishOutput("Choosing Pastor."); await h.tick();
			assert.equal(h.choices, 0); assert.equal(h.active, false);
			assert.equal(h.captures.length, 1); assert.equal(h.captures[0].aborted, true);
			assert.equal(h.mounts, 1); assert.equal(h.unmounts, 0, "Session change must preserve the child app and drafts");
		} finally { await h.unmount(); }
	});
}

test("same-session choice still uses the current visible action once", async () => {
	const h = harness();
	try { await h.mount(); await h.start(); await h.command("option one"); assert.equal(h.choices, 1); }
	finally { await h.unmount(); }
});

test("session replacement fences old recognition before passive cleanup", async () => {
	const h = harness();
	try {
		await h.mount(); await h.start();
		const oldFinal = h.captures[0].onresult;
		let fired = false;
		await h.render({ sessionId: "session-two" }, () => { if (fired) return; fired = true;
			// Layout registration cleanup may already abort the old engine.
            // A previously queued callback must still be harmless before passive cleanup.
			oldFinal({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "option one" } }] });
		});
		assert.equal(fired, true); assert.equal(h.choices, 0); assert.equal(h.active, false);
	} finally { await h.unmount(); }
});

test("held start cannot arm a replacement engine, which requires a new explicit Start", async () => {
	const h = harness();
	try {
		await h.mount(); h.holdSpeech(text => text.startsWith("Voice controls ready."));
		await h.start(); assert.equal(h.captures.length, 0);
		const oldStart = h.outputs.at(-1).text;
		await h.render({ sessionId: "session-two" });
		await h.finishOutput(oldStart); await h.tick();
		assert.equal(h.captures.length, 0); assert.equal(h.active, false);
		h.holdSpeech(() => false); await h.start(); assert.equal(h.captures.length, 1);
	} finally { await h.unmount(); }
});

test("Stop during held start cannot rearm when the old output drains", async () => {
	const h = harness();
	try {
		await h.mount(); h.holdSpeech(text => text.startsWith("Voice controls ready."));
		await h.start(); const oldStart = h.outputs.at(-1).text;
		await h.stop(); await h.finishOutput(oldStart); await h.tick();
		assert.equal(h.captures.length, 0); assert.equal(h.active, false);
	} finally { await h.unmount(); }
});

test("late eligibility JSON for the old session cannot authorize controls", async () => {
	const body = deferred();
	const h = harness({ eligibility: (_request, index) => index === 0 ? { ok: true, json: () => body.promise } : Response.json({ pro: false }) });
	try {
		await h.mount(); assert.equal(h.startButton, undefined);
		await h.render({ sessionId: "session-two" });
		await act(async () => { body.resolve({ pro: true }); await settle(); });
		assert.equal(h.requests.length, 2); assert.equal(h.requests[0].options.signal.aborted, true);
		assert.equal(h.startButton, undefined); assert.equal(h.captures.length, 0);
	} finally { await h.unmount(); }
});

test("replacement eligibility must succeed independently and never automatically restarts capture", async () => {
	const reply = deferred();
	const h = harness({ eligibility: (_request, index) => index === 0 ? Response.json({ pro: true }) : reply.promise });
	try {
		await h.mount(); await h.start(); await h.render({ sessionId: "session-two" });
		assert.equal(h.startButton, undefined); assert.equal(h.captures.length, 1);
		await act(async () => { reply.resolve(Response.json({ pro: true })); await settle(); });
		assert.ok(h.startButton && !h.startButton.props.disabled); assert.equal(h.active, false); assert.equal(h.captures.length, 1);
		await h.start(); assert.equal(h.captures.length, 2);
	} finally { await h.unmount(); }
});

test("stale exported controls cannot speak, register a choice, stop, or retarget the replacement chat", async () => {
	const h = harness({ scope: false, chat: true });
	try {
		await h.mount(); const old = h.controls; await h.start();
		await h.render({ sessionId: "session-two" }); await h.start();
		const spoken = h.spoken.length;
		await act(async () => { await old.speak("Stale old-session narration"); old.register({ key: "stale", question: "Old", actions: [{ label: "Wrong", run: () => assert.fail("Old choice executed") }] });
			old.setChat({ key: "wrong", busy: false, send: () => assert.fail("Old chat sent") }); old.stop(); await settle(); });
		assert.equal(h.spoken.length, spoken); assert.equal(h.active, true);
		await h.command("What is grace?"); assert.deepEqual(h.sends, ["What is grace?"]);
	} finally { await h.unmount(); }
});

test("a late cancelled-output failure cannot stop the newly started replacement session", async () => {
	const h = harness();
	try {
		await h.mount(); await h.start(); h.holdSpeech(text => text === "Choosing Pastor.");
		await h.command("option one"); await h.flush(); await h.render({ sessionId: "session-two" });
		h.holdSpeech(() => false); await h.start();
		await h.finishOutput("Choosing Pastor.", true); await h.tick();
		assert.equal(h.choices, 0); assert.equal(h.active, true); assert.equal(h.captures.length, 2);
	} finally { await h.unmount(); }
});

for (const status of ["device", "ready"]) {
	test(`welcome ${status} output rejects a held old-session request and keeps the new owned queue`, async () => {
		const old = deferred(), current = deferred();
		const h = harness({ welcome: true, welcomeRequest: (_request, index) => index === 0 ? old.promise : current.promise });
		try {
			await h.mount(); assert.equal(h.welcomeCalls.length, 1);
			await h.render({ sessionId: "session-two" });
			await act(async () => { old.resolve(status === "device" ? { status, text: "Old session text" } : { status, streamUrl: "/old-session-audio" }); await settle(); });
			assert.equal(h.deviceSpeech.length, 0); assert.equal(h.audio.length, 0);
			assert.equal(h.welcomeCalls.length, 2); assert.equal(h.welcomeCalls[0].signal.aborted, true);
			await act(async () => { current.resolve(status === "device" ? { status, text: "New session text" } : { status, streamUrl: "/new-session-audio" }); await settle(); });
			if (status === "device") assert.equal(h.deviceSpeech[0].text, "New session text");
			else { assert.equal(h.audio[0].url, "/new-session-audio"); assert.equal(h.audio[0].played, true); }
			assert.equal(h.mounts, 1); assert.equal(h.unmounts, 0);
		} finally { await h.unmount(); }
	});
}

test("welcome pending output aborts on sign-out and unmount without borrowing the next session", async () => {
	for (const change of ["signout", "unmount"]) {
		const held = deferred();
		const h = harness({ welcome: true, welcomeRequest: () => held.promise });
		await h.mount();
		try {
			if (change === "signout") await h.render({ userId: null, sessionId: null }); else await h.unmount();
			assert.equal(h.welcomeCalls[0].signal.aborted, true);
			await act(async () => { held.resolve({ status: "device", text: "Do not play" }); await settle(); });
			assert.equal(h.deviceSpeech.length, 0); assert.equal(h.audio.length, 0);
		} finally { if (change === "signout") await h.unmount(); }
	}
});


test("held welcome narration cannot let an old Start arm after session replacement", async () => {
	const h = harness();
	let release;
	try {
		await h.mount(); release = h.narration.beginNarration("welcome");
		await h.start(); assert.equal(h.captures.length, 0); assert.equal(h.spoken.length, 0);
		await h.render({ sessionId: "session-two" });
		await act(async () => { release(); await settle(); }); await h.tick();
		assert.equal(h.captures.length, 0); assert.equal(h.spoken.length, 0); assert.equal(h.active, false);
		await h.start(); assert.equal(h.captures.length, 1);
	} finally { release?.(); await h.unmount(); }
});

test("unmount fences a held choice and its late recognition callbacks", async () => {
	const h = harness();
	await h.mount(); await h.start(); h.holdSpeech(text => text === "Choosing Pastor.");
	await h.command("option one"); const oldFinal = h.engines[0].config.onFinal;
	await h.unmount();
	await oldFinal("option one", h.engines[0].config.revision());
	assert.equal(h.choices, 0); assert.equal(h.captures.length, 1); assert.equal(h.captures[0].aborted, true);
});

for (const transition of ["unmount", "pathname"]) {
 test(`committed ${transition} revokes a provider held choice before passive cleanup and preserves valid navigation`, async () => {
  const h = harness({ concurrent: true });
  try {
   await h.mount(); await h.start(); h.holdSpeech(text => text === "Choosing Pastor."); await h.command("option one");
   const held = h.outputs.find(value => value.text === "Choosing Pastor."); assert.ok(held);
   const witness = transition === "unmount" ? await h.commitUnmount() : await h.commitUpdate({ pathname: "/bible" });
   held.resolve(); await settle();
   assert.equal(h.choices, 0); console.log("WEB_LIFECYCLE_COMMIT", JSON.stringify({ surface: "provider", transition, ...witness, staleChoices: h.choices }));
   if (transition === "pathname") {
    await h.flush(); assert.equal(h.active, true); assert.equal(h.mounts, 1); assert.equal(h.unmounts, 0);
    h.holdSpeech(() => false); await h.command("option one"); assert.equal(h.choices, 1, "A still-mounted valid card remains usable on the current route");
   }
  } finally { await h.unmount(); }
 });
}
for (const transition of ["unmount", "disable", "conversation"]) {
 test(`committed welcome ${transition} rejects a held prior request before passive cleanup`, async () => {
  const old = deferred(); const h = harness({ concurrent: true, welcome: true, welcomeRequest: (_request, index) => index === 0 ? old.promise : { status: "device", text: "Fresh current welcome" } });
  try {
   await h.mount(); assert.equal(h.welcomeCalls.length, 1);
   const witness = transition === "unmount" ? await h.commitUnmount() : transition === "disable" ? await h.commitUpdate({ welcome: false }) : await h.commitUpdate({ conversation: "fresh-conversation", messages: [{ id: "fresh-welcome", role: "assistant" }] });
   old.resolve({ status: "device", text: "STALE PRIOR WELCOME" }); await settle();
   assert.equal(h.deviceSpeech.some(value => value.text === "STALE PRIOR WELCOME"), false);
   console.log("WEB_LIFECYCLE_COMMIT", JSON.stringify({ surface: "welcome", transition, ...witness, staleSpeech: h.deviceSpeech.some(value => value.text === "STALE PRIOR WELCOME") }));
   if (transition === "conversation") { await h.flush(); assert.ok(h.deviceSpeech.some(value => value.text === "Fresh current welcome")); assert.equal(h.mounts, 1); assert.equal(h.unmounts, 0); }
  } finally { await h.unmount(); }
 });
}

test("committed choice-scope unmount retires its held callback and a new registration remains usable", async () => {
 const h = harness({ concurrent: true });
 try { await h.mount(); await h.start(); h.holdSpeech(text => text === "Choosing Pastor."); await h.command("option one");
  const held = h.outputs.find(value => value.text === "Choosing Pastor."); assert.ok(held); const witness = await h.commitUpdate({ scopeMounted: false });
  held.resolve(); await settle(); assert.equal(h.choices, 0); console.log("WEB_LIFECYCLE_COMMIT", JSON.stringify({ surface: "registration", ...witness, staleChoices: h.choices }));
  await h.flush(); await h.commitUpdate({ scopeMounted: true }); await h.flush(); h.holdSpeech(() => false); await h.command("option one"); assert.equal(h.choices, 1); assert.equal(h.mounts, 1); assert.equal(h.unmounts, 0);
 } finally { await h.unmount(); }
});

test("actual committed Chat caller unregisters before a new current-engine question and re-registers on return", async () => {
 const h = harness({ concurrent: true, scope: false, chat: true });
 try { await h.mount(); await h.start(); const witness = await h.commitUpdate({ chatMounted: false, pathname: "/bible" }); assert.equal(witness.chatLayoutUnmounts, 1);
  const action = h.commandBeforePassive("What is grace?"); await settle(); await action; assert.deepEqual(h.sends, []);
  console.log("WEB_LIFECYCLE_COMMIT", JSON.stringify({ surface: "actual-chat-registration", ...witness, staleSends: h.sends.length }));
  await h.flush(); await h.commitUpdate({ chatMounted: true, pathname: "/" }); await h.flush(); await h.command("What is grace?"); assert.deepEqual(h.sends, ["What is grace?"]); assert.equal(h.mounts, 1); assert.equal(h.unmounts, 0);
 } finally { await h.unmount(); }
});

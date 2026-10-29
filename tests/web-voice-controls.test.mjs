import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

function load(name, globals = {}) {
	const source = ts.transpileModule(readFileSync(new URL(`../src/lib/voice/${name}.ts`, import.meta.url), "utf8"), {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
	}).outputText;
	const sandbox = { exports: {}, setTimeout, clearTimeout, ...globals };
	vm.runInNewContext(source, sandbox);
	return sandbox.exports;
}
const { VoiceActionRegistry } = load("web-actions");

test("only the active semantic scope can be chosen; stale and duplicate selections cannot replay side effects", async () => {
	let answerCount = 0;
	let finish;
	const registry = new VoiceActionRegistry();
	const oldCleanup = registry.register({ key: "old", question: "Old card", actions: [{ label: "Old", run: () => assert.fail("stale card executed") }] });
	oldCleanup();
	registry.register({ key: "current", question: "Your walk?", priority: 10, actions: [{ label: "Saved and growing", run: async () => { answerCount += 1; await new Promise(resolve => { finish = resolve; }); } }] });
	const revision = registry.revision;
	assert.match(registry.readOptions(), /Option 1\. Saved and growing/);
	assert.equal(await registry.choose(0, revision - 1), false);
	assert.equal(await registry.choose(10, revision), false);
	const selected = registry.choose(0, revision);
	assert.equal(answerCount, 1);
	assert.equal(await registry.choose(0, revision), false);
	finish();
	assert.equal(await selected, true);
	assert.equal(answerCount, 1);
});

test("church results override the base card and cleanup does not erase a newer card", async () => {
	const registry = new VoiceActionRegistry();
	let chosen = "";
	const cleanup = registry.register({ key: "church", question: "Your church?", actions: [{ label: "Skip", run: () => { chosen = "skip"; } }] });
	registry.register({ key: "church-results", priority: 20, question: "Choose your church", actions: [{ label: "Grace Church, Fresno", run: () => { chosen = "grace"; } }] });
	cleanup();
	assert.equal(registry.options[0], "Grace Church, Fresno");
	await registry.choose(0, registry.revision);
	assert.equal(chosen, "grace");
});

function sessionHarness() {
	const recognitions = [];
	const timers = new Map();
	let timerId = 0;
	let revision = 1;
	let finishAction;
	const final = [];
	const statuses = [];
	const errors = [];
	const { SpeechCommandSession } = load("web-speech", {
		setTimeout: callback => { const id = ++timerId; timers.set(id, callback); return id; },
		clearTimeout: id => timers.delete(id),
	});
	const session = new SpeechCommandSession({
		create: () => {
			const recognition = { start() { this.starts = (this.starts ?? 0) + 1; }, abort() { this.aborted = true; } };
			recognitions.push(recognition); return recognition;
		},
		revision: () => revision,
		onFinal: async (text, capturedRevision) => { final.push({ text, revision: capturedRevision }); await new Promise(resolve => { finishAction = resolve; }); },
		onStatus: value => statuses.push(value), onError: value => errors.push(value),
	});
	return { session, recognitions, final, statuses, errors,
		changeCard() { revision += 1; session.invalidate(); },
		async finish() { finishAction(); await new Promise(resolve => setImmediate(resolve)); },
		tick() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(callback => callback()); },
	};
}
function result(text, isFinal = true) { return { resultIndex: 0, results: [{ isFinal, 0: { transcript: text } }] }; }

test("recognition consumes real final-result events once, waits for action and narration drain, and releases callbacks", async () => {
	const h = sessionHarness();
	h.session.start(); h.session.start();
	assert.equal(h.recognitions.length, 1);
	const recognition = h.recognitions[0];
	assert.equal(recognition.continuous, false);
	assert.equal(recognition.interimResults, false);
	const lateResult = recognition.onresult;
	lateResult(result("saved", false));
	assert.equal(h.final.length, 0);
	lateResult(result("saved and growing"));
	lateResult(result("saved and growing"));
	assert.equal(h.final.length, 1);
	assert.equal(recognition.aborted, true);
	assert.equal(recognition.onresult, null);
	h.tick();
	assert.equal(h.recognitions.length, 1, "must not capture during the action/save");
	h.session.setPaused(true);
	await h.finish(); h.tick();
	assert.equal(h.recognitions.length, 1, "must not capture its own narration");
	h.session.setPaused(false);
	assert.equal(h.recognitions.length, 2);
	h.session.stop(); h.tick();
	assert.equal(h.recognitions[1].aborted, true);
	assert.equal(h.recognitions.length, 2);
});

test("a final utterance from the previous route/card is ignored after invalidation", () => {
	const h = sessionHarness();
	h.session.start();
	const stale = h.recognitions[0].onresult;
	h.changeCard();
	stale(result("option two"));
	assert.equal(h.final.length, 0);
	assert.equal(h.recognitions[0].aborted, true);
	assert.equal(h.recognitions.length, 2);
	h.session.stop();
});

test("permission denial announces recovery and cannot silently rearm", () => {
	const h = sessionHarness();
	h.session.start();
	const recognition = h.recognitions[0];
	const ended = recognition.onend;
	recognition.onerror({ error: "not-allowed" });
	ended(); h.tick();
	assert.equal(h.recognitions.length, 1);
	assert.equal(recognition.aborted, true);
	assert.match(h.errors[0], /Microphone access was denied/);
	assert.equal(h.statuses.at(-1), "stopped");
});

test("late capture after an explicit stop is ignored, and browser end rearms only a live session", () => {
	const h = sessionHarness();
	h.session.start();
	h.recognitions[0].onend(); h.tick();
	assert.equal(h.recognitions.length, 2);
	const late = h.recognitions[1].onresult;
	h.session.stop(); late(result("open settings")); h.tick();
	assert.equal(h.final.length, 0);
	assert.equal(h.recognitions.length, 2);
});

test("only an exact persisted assistant row supplies narration, including an intentionally empty tool-only row", () => {
	const { savedVoiceAnswer } = load("web-saved-answer");
	const body = { messages: [{ id: "answer", role: "assistant", content: "For God so loved the world." }, { id: "user", role: "user", content: "Do not read this as an answer" }, { id: "tool", role: "assistant", content: "" }] };
	assert.equal(savedVoiceAnswer(body, "answer"), "For God so loved the world.");
	assert.equal(savedVoiceAnswer(body, "user"), null);
	assert.equal(savedVoiceAnswer(body, "old-id"), null);
	assert.equal(savedVoiceAnswer(body, "tool"), "");
	assert.equal(savedVoiceAnswer({ messages: [null, {}] }, "answer"), null);
});

test("narration pauses capture until all output drains, waits for welcome Audio, and speaks at 1.05x", async () => {
	const utterances = [];
	const states = [];
	const narration = load("web-narration", {
		require: name => { assert.equal(name, "./voice-commands"); return { VOICE_PLAYBACK_RATE: 1.05 }; },
		window: { speechSynthesis: { speak: utterance => utterances.push(utterance), cancel() {} } },
		SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
	});
	const unsubscribe = narration.subscribeNarration(value => states.push(value));
	const welcomeDone = narration.beginNarration("welcome");
	const anotherDone = narration.beginNarration();
	let drained = false;
	const waiting = narration.waitForWelcomeNarration().then(() => { drained = true; });
	await Promise.resolve();
	assert.equal(drained, false);
	welcomeDone(); welcomeDone();
	await waiting;
	assert.equal(narration.narrationBusy(), true, "the other narration still owns capture");
	anotherDone();
	assert.equal(narration.narrationBusy(), false);
	const spoken = narration.speakVoiceStatus("Option one. Saved and growing.");
	assert.equal(utterances[0].rate, 1.05);
	assert.equal(narration.narrationBusy(), true);
	spoken.cancel(); await spoken.done;
	assert.equal(narration.narrationBusy(), false);
	assert.equal(states.at(-1), false);
	unsubscribe();
});

test("a failed speech-recognition constructor reports a recoverable failure without leaving an active session", () => {
	const { SpeechCommandSession } = load("web-speech");
	const errors = [];
	const statuses = [];
	const session = new SpeechCommandSession({ create() { throw new Error("unavailable"); }, revision: () => 0,
		onFinal: async () => assert.fail("no recognition should exist"), onStatus: value => statuses.push(value), onError: value => errors.push(value) });
	session.start();
	assert.equal(statuses.at(-1), "stopped");
	assert.match(errors[0], /could not create speech recognition/);
	session.stop();
});

test("failed speech output releases the narration lock and reports failure to the controller", async () => {
	const utterances = [];
	const narration = load("web-narration", {
		require: () => ({ VOICE_PLAYBACK_RATE: 1.05 }),
		window: { speechSynthesis: { speak: utterance => utterances.push(utterance), cancel() {} } },
		SpeechSynthesisUtterance: class {},
	});
	const spoken = narration.speakVoiceStatus("Read your choices.");
	utterances[0].onerror({ error: "synthesis-failed" });
	await assert.rejects(spoken.done, /Speech playback failed/);
	assert.equal(narration.narrationBusy(), false);
});

test("refreshed handlers cannot retarget a captured label before the registration effect updates", () => {
	const { voiceScopeSignature, currentVoiceAction } = load("web-actions");
	let executed = "";
	const captured = { key: "conversation-a:card", question: "Which option?", actions: [{ label: "Saved and growing", run: () => { executed = "original"; } }, { label: "Newly saved", run: () => {} }] };
	const signature = voiceScopeSignature(captured);
	const refreshed = { ...captured, actions: [{ label: "Saved and growing", run: () => { executed = "refreshed"; } }, captured.actions[1]] };
	currentVoiceAction(refreshed, signature, 0)?.run();
	assert.equal(executed, "refreshed", "fresh callbacks are permitted while the full semantic surface is unchanged");
	executed = "";
	for (const changed of [
		{ ...refreshed, key: "conversation-b:card" },
		{ ...refreshed, question: "A different question?" },
		{ ...refreshed, actions: [{ label: "A different action", run: () => { executed = "WRONG"; } }, refreshed.actions[1]] },
		{ ...refreshed, actions: [refreshed.actions[0], { label: "Different second label", run: () => {} }] },
		null,
	]) assert.equal(currentVoiceAction(changed, signature, 0), null);
	assert.equal(executed, "");
});

function mediaHarness() {
	const narration = load("web-narration", { require: () => ({ VOICE_PLAYBACK_RATE: 1.05 }) });
	const listeners = new Map();
	const element = {
		paused: true,
		ended: false,
		error: null,
		addEventListener(name, listener) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(listener); },
		removeEventListener(name, listener) { listeners.get(name)?.delete(listener); },
		emit(name) { for (const listener of [...(listeners.get(name) ?? [])]) listener(); },
		play() { this.paused = false; this.emit("play"); return Promise.resolve(); },
		pause() { this.paused = true; this.emit("pause"); },
	};
	return { narration, element, listeners };
}

test("chapter and devotional media exclude capture until all audio stops; late final words and explicit Stop cannot rearm", async () => {
	const { narration, element: chapter } = mediaHarness();
	const { element: devotional } = mediaHarness();
	const h = sessionHarness();
	const unsubscribe = narration.subscribeNarration(() => h.session.setPaused(narration.narrationBusy()));
	const chapterOutput = narration.coordinateMediaNarration(chapter);
	const devotionalOutput = narration.coordinateMediaNarration(devotional);
	h.session.start();
	const staleFinal = h.recognitions[0].onresult;
	const play = chapter.play.bind(chapter);
	chapter.play = () => { assert.equal(h.recognitions[0].aborted, true, "capture must stop before media.play()"); return play(); };
	await chapterOutput.play();
	await devotionalOutput.play();
	staleFinal(result("open settings"));
	assert.equal(h.final.length, 0, "audio echo from the aborted capture must not dispatch");
	chapter.pause(); h.tick();
	assert.equal(h.recognitions.length, 1, "the other output still owns capture");
	devotional.paused = true; devotional.emit("ended");
	assert.equal(h.recognitions.length, 2, "a live session can resume after all audio drains");
	await chapterOutput.play();
	h.session.stop();
	chapter.pause(); h.tick();
	assert.equal(h.recognitions.length, 2, "releasing audio after explicit Stop must not restart capture");
	chapterOutput.dispose(); devotionalOutput.dispose(); unsubscribe();
});

test("native media play also gates capture, buffering keeps the lock, and every terminal event releases it", () => {
	for (const terminal of ["pause", "ended", "error", "emptied"]) {
		const { narration, element } = mediaHarness();
		const output = narration.coordinateMediaNarration(element);
		element.play(); // OS media controls do not call the programmatic wrapper.
		assert.equal(narration.narrationBusy(), true);
		element.emit("waiting"); element.emit("stalled");
		assert.equal(narration.narrationBusy(), true, "buffering may resume without another play event");
		element.paused = true;
		if (terminal === "error") element.error = new Error("media failed");
		element.emit(terminal);
		assert.equal(narration.narrationBusy(), false, terminal);
		output.dispose();
	}
});

test("failed or unmounted media releases capture; stale rejected play cannot unlock a newer attempt", async () => {
	for (const synchronous of [false, true]) {
		const { narration, element } = mediaHarness();
		element.play = () => { if (synchronous) throw new Error("blocked"); return Promise.reject(new Error("blocked")); };
		const output = narration.coordinateMediaNarration(element);
		await assert.rejects(output.play(), /blocked/);
		assert.equal(narration.narrationBusy(), false);
		output.dispose();
	}
	const { narration, element, listeners } = mediaHarness();
	const output = narration.coordinateMediaNarration(element);
	let rejectOld;
	element.play = () => new Promise((_, reject) => { rejectOld = reject; });
	const old = output.play();
	element.play = () => { element.paused = false; element.emit("play"); return Promise.resolve(); };
	await output.play();
	rejectOld(new Error("old request aborted")); await assert.rejects(old, /old request aborted/);
	assert.equal(narration.narrationBusy(), true);
	for (const stale of ["pause", "ended", "error", "emptied"]) element.emit(stale);
	assert.equal(narration.narrationBusy(), true, "queued terminal events from an old source cannot unlock current playback");
	element.error = new Error("current playback failed"); element.emit("error");
	assert.equal(narration.narrationBusy(), false);
	element.error = null;
	await output.play();
	output.dispose(); output.dispose();
	assert.equal(element.paused, true);
	assert.equal(narration.narrationBusy(), false);
	assert.ok([...listeners.values()].every(set => set.size === 0));
	await output.play(); element.emit("play");
	assert.equal(narration.narrationBusy(), false, "disposed output cannot reclaim capture");
});

test("media cleanup releases its lock even when browser pause throws", async () => {
	const { narration, element } = mediaHarness();
	const output = narration.coordinateMediaNarration(element);
	await output.play();
	element.pause = () => { throw new Error("media detached"); };
	assert.throws(() => output.dispose(), /media detached/);
	assert.equal(narration.narrationBusy(), false);
});

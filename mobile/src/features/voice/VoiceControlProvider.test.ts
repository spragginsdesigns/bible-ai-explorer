import React from "react";
// Runtime renderer is kept as a test dependency, never bundled in the app.
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { acquireVoiceOutput } from "./voiceActivity";
import { VoiceAudioPlayback } from "./VoiceAudioPlayback";

const mocks = vi.hoisted(() => {
	const events = new Map<string, Set<(event?: unknown) => void>>();
	const emit = (name: string, event?: unknown) => { for (const handler of events.get(name) ?? []) handler(event); };
	return {
		account: "owner", path: "/", events, emit,
		appState: new Set<(state: string) => void>(),
		api: vi.fn(async () => ({ pro: true, available: false })),
		start: vi.fn(), stop: vi.fn(() => emit("end")), abort: vi.fn(() => emit("end")),
		permission: vi.fn(async () => ({ granted: true })), navigate: vi.fn(), back: vi.fn(), speak: vi.fn(),
		holdSpeech: null as string | null, heldSpeech: [] as (() => void)[],
	};
});
vi.mock("react-native", () => ({ View: "View", Pressable: "Pressable", AppState: { currentState: "active", addEventListener: (_: string, fn: (s: string) => void) => { mocks.appState.add(fn); return { remove: () => mocks.appState.delete(fn) }; } } }));
vi.mock("@clerk/expo", () => ({ useAuth: () => ({ userId: mocks.account, isSignedIn: true }) }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 24 }) }));
vi.mock("expo-router", () => ({ usePathname: () => mocks.path, useRouter: () => ({ navigate: mocks.navigate, back: mocks.back, canGoBack: () => true }) }));
vi.mock("expo-speech", () => ({ stop: vi.fn(async () => {}), speak: (text: string, options: { onDone: () => void; rate: number }) => { mocks.speak(text, options.rate); if (mocks.holdSpeech === text) mocks.heldSpeech.push(options.onDone); else queueMicrotask(options.onDone); } }));
vi.mock("expo-audio", () => ({ createAudioPlayer: vi.fn() }));
vi.mock("@/features/onboarding/api", () => ({ requestVoice: vi.fn() }));
vi.mock("@/components/AppText", () => ({ AppText: "AppText" }));
vi.mock("@/features/settings/settingsStore", () => ({ useTheme: () => ({ colors: { surface: "black", text: "white", accent: "gold" } }) }));
vi.mock("@/features/notes/useStableGetToken", () => { const token = async () => "token"; return { useStableGetToken: () => token }; });
vi.mock("@/lib/api", () => ({ apiJson: mocks.api }));
vi.mock("expo-speech-recognition", () => ({ ExpoSpeechRecognitionModule: {
	start: mocks.start, stop: mocks.stop, abort: mocks.abort, isRecognitionAvailable: () => true, requestPermissionsAsync: mocks.permission,
	addListener: (name: string, fn: (event?: unknown) => void) => { if (!mocks.events.has(name)) mocks.events.set(name, new Set()); mocks.events.get(name)!.add(fn); return { remove: () => mocks.events.get(name)?.delete(fn) }; },
} }));
import { VoiceControlProvider, useVoiceControls } from "./VoiceControlProvider";
import { useWelcomeVoice } from "@/features/onboarding/useWelcomeVoice";
import { registerTabDepartureGuard } from "@/lib/tabDeparture";
let controls: NonNullable<ReturnType<typeof useVoiceControls>>;
let renderer: { unmount: () => void; update: (element: React.ReactElement) => void };
let clearDepartureGuard: (() => void) | undefined;
function Probe() { controls = useVoiceControls()!; return null; }
const element = () => React.createElement(VoiceControlProvider, { children: React.createElement(Probe) });
async function flush(milliseconds = 300) { await act(async () => { await Promise.resolve(); await vi.advanceTimersByTimeAsync(milliseconds); }); }
async function mount() { await act(async () => { renderer = create(element()); }); await flush(); }
async function start() {
	await act(async () => { controls.start(); await vi.dynamicImportSettled(); });
	await flush();
}
function final(text: string) { mocks.emit("result", { isFinal: true, results: [{ transcript: text }] }); }
beforeEach(() => {
	vi.useFakeTimers(); vi.clearAllMocks(); mocks.account = "owner"; mocks.path = "/"; mocks.events.clear(); mocks.appState.clear(); mocks.api.mockResolvedValue({ pro: true, available: false });
	mocks.holdSpeech = null; mocks.heldSpeech = [];
	(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => { clearDepartureGuard?.(); clearDepartureGuard = undefined; if (renderer) await act(async () => renderer.unmount()); for (const done of mocks.heldSpeech.splice(0)) done(); await vi.runOnlyPendingTimersAsync(); vi.useRealTimers(); });
async function releaseAcknowledgement() {
	mocks.holdSpeech = null;
	await act(async () => { for (const done of mocks.heldSpeech.splice(0)) done(); });
	await flush();
}

it("fails closed for non-Pro eligibility and never requests microphone permission", async () => {
	mocks.api.mockResolvedValue({ pro: false, available: false });
	await mount(); expect(controls.eligible).toBe(false); await start();
	expect(mocks.permission).not.toHaveBeenCalled(); expect(mocks.start).not.toHaveBeenCalled();
});
it("uses a final utterance once and holds listening until the real choice callback finishes", async () => {
	await mount(); let finish!: () => void;
	const choose = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
	controls.registerCard({ question: "Choose", options: ["Pastor", "Newly saved"], choose });
	await start(); expect(mocks.start).toHaveBeenCalledTimes(1);
	await act(async () => {
		mocks.emit("result", { isFinal: false, results: [{ transcript: "Pastor" }] });
		mocks.emit("end");
	});
	expect(choose).not.toHaveBeenCalled(); await flush(600);
	await act(async () => { final("select the second option"); final("select the second option"); mocks.emit("end"); });
	expect(choose).toHaveBeenCalledTimes(1); expect(choose).toHaveBeenCalledWith("Newly saved");
	const starts = mocks.start.mock.calls.length; await flush(); expect(mocks.start).toHaveBeenCalledTimes(starts);
	await act(async () => { finish(); }); await flush(); expect(mocks.start.mock.calls.length).toBeGreaterThan(starts);
});
it("pauses for queued output, survives navigation, and stops on background", async () => {
	await mount(); await start();
	let output!: ReturnType<typeof acquireVoiceOutput>;
	await act(async () => { output = acquireVoiceOutput(); await output.microphoneStopped; });
	const starts = mocks.start.mock.calls.length; await flush(); expect(mocks.start).toHaveBeenCalledTimes(starts);
	await act(async () => output.release()); await flush(); expect(mocks.start.mock.calls.length).toBeGreaterThan(starts);
	await act(async () => { final("open Bible"); mocks.emit("end"); }); expect(mocks.navigate).toHaveBeenCalledWith("/bible");
	await act(async () => { mocks.path = "/bible"; renderer.update(element()); }); await flush(); expect(controls.enabled).toBe(true);
	await act(async () => { for (const handler of mocks.appState) handler("background"); }); await flush();
	expect(controls.enabled).toBe(false); const after = mocks.start.mock.calls.length; await flush(); expect(mocks.start).toHaveBeenCalledTimes(after);
});
it("never dispatches the old card or old account after scope changes", async () => {
	await mount(); const oldChoice = vi.fn(); const newChoice = vi.fn();
	const unregister = controls.registerCard({ question: "Old", options: ["Pastor"], choose: oldChoice });
	await start(); unregister(); controls.registerCard({ question: "New", options: ["Student"], choose: newChoice });
	await act(async () => { final("one"); mocks.emit("end"); });
	expect(oldChoice).not.toHaveBeenCalled(); expect(newChoice).not.toHaveBeenCalled();
	await act(async () => { mocks.account = "another-account"; renderer.update(element()); }); await flush();
	expect(controls.enabled).toBe(false);
	await act(async () => { final("one"); mocks.emit("end"); }); expect(newChoice).not.toHaveBeenCalled();
});
it("stops on a failed canonical send without retrying the question", async () => {
	await mount(); const send = vi.fn(async () => { throw new Error("The answer is not saved. Check chat before trying again."); });
	controls.registerChat({ busy: false, error: null, send }); await start();
	await act(async () => { final("What is grace?"); mocks.emit("end"); }); await flush();
	expect(send).toHaveBeenCalledTimes(1); expect(send).toHaveBeenCalledWith("What is grace?"); expect(controls.enabled).toBe(false);
	expect(mocks.speak).toHaveBeenCalledWith("I am working on your answer.", 1.05);
	await flush(); expect(send).toHaveBeenCalledTimes(1);
});
it("sends freeform answers only when the current card allows them", async () => {
	await mount(); const choose = vi.fn();
	controls.registerCard({ question: "Your name?", options: ["Skip"], allowOther: true, choose }); await start();
	await act(async () => { final("Call me Alice"); final("Call me Alice"); mocks.emit("end"); }); await flush();
	expect(choose).toHaveBeenCalledExactlyOnceWith("Call me Alice");
	controls.registerCard({ question: "Choose a size", options: ["Large"], allowOther: false, choose }); await flush();
	await act(async () => { final("something else"); mocks.emit("end"); }); await flush();
	expect(choose).toHaveBeenCalledTimes(1);
});
it("speaks a settled canonical answer and numbered choices after its exact saved row is read", async () => {
	mocks.api.mockResolvedValue({ messages: [{ id: "reply", role: "assistant", content: "The answer" }] } as unknown as { pro: boolean; available: boolean });
	function Narrator() {
		useWelcomeVoice({ enabled: true, deviceOnly: true, conversationId: "conversation", sessionKey: "owner:conversation", getToken: async () => "token", messages: [{ id: "reply", role: "assistant", text: "The answer. Option one. Pastor. Option two. Newly saved.", step: "faith" }] });
		return null;
	}
	await act(async () => { renderer = create(React.createElement(Narrator)); }); await flush();
	expect(mocks.api).toHaveBeenCalledWith(expect.any(Function), "/api/conversations/conversation");
	expect(mocks.speak).toHaveBeenCalledExactlyOnceWith("The answer. Option one. Pastor. Option two. Newly saved.", 1.05);
	expect(mocks.api.mock.invocationCallOrder[0]).toBeLessThan(mocks.speak.mock.invocationCallOrder[0]);
});

it.each(["route", "card", "account", "stop and restart"])("revokes a spoken choice when %s changes during its acknowledgement", async (change) => {
	await mount(); const choose = vi.fn();
	const unregister = controls.registerCard({ question: "Choose", options: ["Pastor"], choose }); await start();
	mocks.holdSpeech = "Choosing Pastor.";
	await act(async () => { final("one"); mocks.emit("end"); }); expect(mocks.heldSpeech).toHaveLength(1);
	if (change === "route") await act(async () => { mocks.path = "/bible"; renderer.update(element()); });
	if (change === "card") { unregister(); controls.registerCard({ question: "New", options: ["Student"], choose: vi.fn() }); }
	if (change === "account") await act(async () => { mocks.account = "another-owner"; renderer.update(element()); });
	if (change === "stop and restart") await act(async () => { controls.stop(); controls.start(); await vi.dynamicImportSettled(); });
	await releaseAcknowledgement(); expect(choose).not.toHaveBeenCalled();
});
it.each(["freeform", "question"])("revokes a card %s callback replaced during its acknowledgement", async (kind) => {
	await mount(); const choose = vi.fn(); const ask = vi.fn();
	const unregister = controls.registerCard({ question: "Name?", options: ["Skip"], allowOther: kind === "freeform", choose, ask }); await start();
	mocks.holdSpeech = kind === "freeform" ? "I am sending your answer." : "I am working on your answer.";
	await act(async () => { final(kind === "freeform" ? "Call me Alice" : "What does saved mean?"); mocks.emit("end"); });
	expect(mocks.heldSpeech).toHaveLength(1); unregister();
	await releaseAcknowledgement(); expect(choose).not.toHaveBeenCalled(); expect(ask).not.toHaveBeenCalled();
});
it("never re-targets a question to a replacement chat after acknowledgement", async () => {
	await mount(); const oldSend = vi.fn(); const nextSend = vi.fn();
	controls.registerChat({ busy: false, error: null, send: oldSend }); await start();
	mocks.holdSpeech = "I am working on your answer.";
	await act(async () => { final("What is grace?"); mocks.emit("end"); });
	expect(mocks.heldSpeech).toHaveLength(1);
	controls.registerChat({ busy: false, error: null, send: nextSend });
	await releaseAcknowledgement(); expect(oldSend).not.toHaveBeenCalled(); expect(nextSend).not.toHaveBeenCalled();
});
it.each(["route", "account", "stop", "guard refusal", "valid"])("fences navigation after an editor save: %s", async (change) => {
	await mount(); await start(); let finishSave!: (saved: boolean) => void;
	const guard = vi.fn(() => new Promise<boolean>((resolve) => { finishSave = resolve; }));
	clearDepartureGuard = registerTabDepartureGuard(guard);
	await act(async () => { final("open Bible"); mocks.emit("end"); }); expect(guard).toHaveBeenCalledTimes(1);
	if (change === "route") await act(async () => { mocks.path = "/settings"; renderer.update(element()); });
	if (change === "account") await act(async () => { mocks.account = "another-owner"; renderer.update(element()); });
	if (change === "stop") await act(async () => controls.stop());
	await act(async () => finishSave(change !== "guard refusal")); await flush();
	if (change === "valid") expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith("/bible");
	else expect(mocks.navigate).not.toHaveBeenCalled();
});
it("does not speak a stale callback failure onto a new route", async () => {
	await mount(); let reject!: (error: Error) => void;
	controls.registerChat({ busy: false, error: null, send: () => new Promise<void>((_resolve, fail) => { reject = fail; }) }); await start();
	await act(async () => { final("What is grace?"); mocks.emit("end"); });
	await act(async () => { mocks.path = "/bible"; renderer.update(element()); });
	await act(async () => reject(new Error("Old chat save failed"))); await flush();
	expect(controls.enabled).toBe(true); expect(mocks.speak).not.toHaveBeenCalledWith("Old chat save failed", expect.anything());
});
it("pauses capture for real media playback and never re-arms after an explicit Stop", async () => {
	await mount(); await start();
	let listener!: (status: { playing: boolean; currentTime: number; didJustFinish: boolean }) => void;
	const player = { muted: false, playing: false, currentStatus: { playing: false, playbackState: "ready", currentTime: 0, duration: 100 }, play: vi.fn(() => { player.playing = true; player.currentStatus.playing = true; }), pause: vi.fn(() => { player.playing = false; player.currentStatus.playing = false; }), seekTo: vi.fn(async () => {}), addListener: (_event: string, handler: typeof listener) => { listener = handler; return { remove: vi.fn() }; } };
	const media = new VoiceAudioPlayback(player, vi.fn());
	await act(async () => { await media.play(); listener({ playing: true, currentTime: 0, didJustFinish: false }); });
	expect(mocks.abort).toHaveBeenCalled(); const starts = mocks.start.mock.calls.length;
	await flush(); expect(mocks.start).toHaveBeenCalledTimes(starts);
	await act(async () => controls.stop());
	await act(async () => { player.playing = false; player.currentStatus.playing = false; listener({ playing: false, currentTime: 3, didJustFinish: false }); }); await flush();
	expect(controls.enabled).toBe(false); expect(mocks.start).toHaveBeenCalledTimes(starts);
	media.dispose();
});

it.each(["no-speech", "speech-timeout"])("waits for native end then quietly re-arms after an empty %s window", async (error) => {
	await mount(); const send = vi.fn(); controls.registerChat({ busy: false, error: null, send }); await start();
	const starts = mocks.start.mock.calls.length;
	await act(async () => { mocks.emit("result", { isFinal: false, results: [{ transcript: "a partial question" }] }); mocks.emit("error", { error }); });
	await flush(1000); expect(mocks.start).toHaveBeenCalledTimes(starts); expect(controls.enabled).toBe(true);
	await act(async () => { mocks.emit("end"); mocks.emit("end"); });
	await flush(499); expect(mocks.start).toHaveBeenCalledTimes(starts);
	await flush(1); expect(mocks.start).toHaveBeenCalledTimes(starts + 1); expect(controls.enabled).toBe(true); expect(send).not.toHaveBeenCalled();
	expect(mocks.speak.mock.calls.filter(([text]) => text === "Listening.")).toHaveLength(1);
});
it.each(["stop", "background", "account"])("does not re-arm a quiet window after %s", async (change) => {
	await mount(); await start(); const starts = mocks.start.mock.calls.length;
	await act(async () => { mocks.emit("error", { error: "no-speech" }); mocks.emit("end"); });
	await act(async () => {
		if (change === "stop") controls.stop();
		if (change === "background") for (const handler of mocks.appState) handler("background");
		if (change === "account") { mocks.account = "next-owner"; renderer.update(element()); }
	});
	await flush(1000); expect(mocks.start).toHaveBeenCalledTimes(starts); expect(controls.enabled).toBe(false);
});
it("keeps real recognizer failures fatal and does not dispatch partial results", async () => {
	await mount(); const send = vi.fn(); controls.registerChat({ busy: false, error: null, send }); await start();
	await act(async () => { mocks.emit("result", { isFinal: false, results: [{ transcript: "never send this" }] }); mocks.emit("error", { error: "network" }); mocks.emit("end"); }); await flush(1000);
	expect(controls.enabled).toBe(false); expect(send).not.toHaveBeenCalled();
});

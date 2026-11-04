import React from "react";
import { performance as realPerformance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import ts from "typescript";
// Runtime renderer is kept as a test dependency, never bundled in the app.
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { acquireVoiceOutput } from "./voiceActivity";
import { VoiceAudioPlayback } from "./VoiceAudioPlayback";

const mocks = vi.hoisted(() => {
	const events = new Map<string, Set<(event?: unknown) => void>>();
	const emit = (name: string, event?: unknown) => { for (const handler of events.get(name) ?? []) handler(event); };
	return {
		account: "owner", session: "session-one", path: "/", events, emit,
		appState: new Set<(state: string) => void>(),
		api: vi.fn(async () => ({ pro: true, available: false })),
		start: vi.fn(), stop: vi.fn(() => emit("end")), abort: vi.fn(() => emit("end")),
		permission: vi.fn(async () => ({ granted: true })), navigate: vi.fn(), back: vi.fn(), speak: vi.fn(),
		holdSpeech: null as string | null, heldSpeech: [] as (() => void)[],
		storage: new Map<string, string>(),
	};
});
vi.mock("react-native", () => ({ View: "View", Pressable: "Pressable", AppState: { currentState: "active", addEventListener: (_: string, fn: (s: string) => void) => { mocks.appState.add(fn); return { remove: () => mocks.appState.delete(fn) }; } } }));
vi.mock("@clerk/expo", () => ({ useAuth: () => ({ userId: mocks.account, sessionId: mocks.session, isSignedIn: true }) }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 24 }) }));
vi.mock("expo-router", () => ({ usePathname: () => mocks.path, useRouter: () => ({ navigate: mocks.navigate, back: mocks.back, canGoBack: () => true }) }));
vi.mock("expo-speech", () => ({ stop: vi.fn(async () => {}), speak: (text: string, options: { onDone: () => void; rate: number }) => { mocks.speak(text, options.rate); if (mocks.holdSpeech === text) mocks.heldSpeech.push(options.onDone); else queueMicrotask(options.onDone); } }));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: { getItem: async (key: string) => mocks.storage.get(key) ?? null, setItem: async (key: string, value: string) => { mocks.storage.set(key, value); } } }));
vi.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));
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
import { VOICE_BAR_HIDDEN_KEY, VoiceControlProvider, useVoiceControls } from "./VoiceControlProvider";
import { useWelcomeVoice } from "@/features/onboarding/useWelcomeVoice";
import { requestVoice } from "@/features/onboarding/api";
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
	vi.useFakeTimers(); vi.clearAllMocks(); mocks.account = "owner"; mocks.session = "session-one"; mocks.path = "/"; mocks.events.clear(); mocks.appState.clear(); mocks.api.mockResolvedValue({ pro: true, available: false });
	mocks.holdSpeech = null; mocks.heldSpeech = []; mocks.storage.clear();
	(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => { clearDepartureGuard?.(); clearDepartureGuard = undefined; if (renderer) await act(async () => renderer.unmount()); for (const done of mocks.heldSpeech.splice(0)) done(); await vi.runOnlyPendingTimersAsync(); vi.useRealTimers(); });
async function releaseAcknowledgement() {
	mocks.holdSpeech = null;
	await act(async () => { for (const done of mocks.heldSpeech.splice(0)) done(); });
	await flush();
}

const label = (name: string) => (renderer as unknown as { root: { findAll: (test: (node: { props: { accessibilityLabel?: string } }) => boolean) => { props: { onPress: () => void } }[] } }).root.findAll((node) => node.props.accessibilityLabel === name);
it("hides the bar on dismiss, remembers it on this device, and brings it back", async () => {
	await mount();
	expect(label("Start voice controls")).toHaveLength(1);
	await act(async () => { label("Hide voice controls")[0].props.onPress(); }); await flush();
	expect(controls.barHidden).toBe(true); expect(label("Start voice controls")).toHaveLength(0);
	expect(mocks.storage.get(VOICE_BAR_HIDDEN_KEY)).toBe("1");
	await act(async () => renderer.unmount()); await mount();
	expect(controls.barHidden).toBe(true); expect(label("Start voice controls")).toHaveLength(0);
	await act(async () => { controls.setBarHidden(false); }); await flush();
	expect(label("Start voice controls")).toHaveLength(1); expect(mocks.storage.get(VOICE_BAR_HIDDEN_KEY)).toBe("0");
});
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
	mocks.api.mockResolvedValue({ messages: [{ id: "reply", role: "assistant", content: "The answer.", metadata: { parts: [{ type: "text", text: "The answer." }, { type: "tool-presentChoices", state: "output-available", output: { step: "faith", question: "Choose your path.", options: ["Pastor", "Newly saved"], skipLabel: "Skip for now" } }] } }] } as unknown as { pro: boolean; available: boolean });
	function Narrator() {
		useWelcomeVoice({ enabled: true, deviceOnly: true, conversationId: "conversation", sessionKey: "owner:conversation", getToken: async () => "token", messages: [{ id: "reply", role: "assistant", text: "The answer. Choose your path. Option 1. Pastor. Option 2. Newly saved. Option 3. Skip for now.", step: "faith" }] });
		return null;
	}
	await act(async () => { renderer = create(React.createElement(Narrator)); }); await flush();
	expect(mocks.api).toHaveBeenCalledWith(expect.any(Function), "/api/conversations/conversation");
	expect(mocks.speak).toHaveBeenCalledExactlyOnceWith("The answer. Choose your path. Option 1. Pastor. Option 2. Newly saved. Option 3. Skip for now.", 1.05);
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

it.each(["different content", "different choices", "withheld", "pending"])("device-only hook never speaks local prose when saved readback is %s", async (kind) => {
 const metadata: Record<string, unknown> = { parts: [{ type: "text", text: "The saved answer." }] };
 if (kind === "withheld" || kind === "pending") metadata.historyVerification = { state: kind };
 if (kind === "different choices") metadata.parts = [{ type: "text", text: "LOCAL UNSAFE ANSWER" }, { type: "tool-presentChoices", state: "output-available", output: { step: "faith", question: "A different saved choice?", options: ["Saved option"], skipLabel: "Skip" } }];
 mocks.api.mockResolvedValue({ messages: [{ id: "reply", role: "assistant", content: "The saved answer.", metadata }] } as unknown as { pro: boolean; available: boolean });
 function Narrator() { useWelcomeVoice({ enabled: true, deviceOnly: true, conversationId: "conversation", sessionKey: "owner:conversation", getToken: async () => "token", messages: [{ id: "reply", role: "assistant", text: "LOCAL UNSAFE ANSWER" }] }); return null; }
 await act(async () => { renderer = create(React.createElement(Narrator)); }); await flush();
 expect(mocks.api).toHaveBeenCalledTimes(1); expect(mocks.speak).not.toHaveBeenCalled();
});

it("device-only hook discards held authoritative readback after its session key changes", async () => {
 let finish!: (value: unknown) => void;
 mocks.api.mockImplementationOnce(() => new Promise(resolve => { finish = value => resolve(value as { pro: boolean; available: boolean }); }));
 function Narrator({ sessionKey, enabled }: { sessionKey: string; enabled: boolean }) { useWelcomeVoice({ enabled, deviceOnly: true, conversationId: "conversation", sessionKey, getToken: async () => "token", messages: [{ id: "reply", role: "assistant", text: "The saved answer." }] }); return null; }
 await act(async () => { renderer = create(React.createElement(Narrator, { sessionKey: "owner:session-one", enabled: true })); }); await flush();
 await act(async () => { renderer.update(React.createElement(Narrator, { sessionKey: "owner:session-two", enabled: false })); });
 await act(async () => { finish({ messages: [{ id: "reply", role: "assistant", content: "The saved answer.", metadata: { parts: [{ type: "text", text: "The saved answer." }] } }] }); }); await flush();
 expect(mocks.api).toHaveBeenCalledTimes(1); expect(mocks.speak).not.toHaveBeenCalled();
});

it.each(["chat", "card", "navigation"])("same-user Clerk session replacement revokes a held %s acknowledgment", async (kind) => {
 await mount(); const action = vi.fn(async () => {});
 if (kind === "card") controls.registerCard({ question: "Choose", options: ["Pastor"], choose: action });
 else controls.registerChat({ busy: false, error: null, send: action });
 await start(); const starts = mocks.start.mock.calls.length;
 mocks.holdSpeech = kind === "card" ? "Choosing Pastor." : kind === "navigation" ? "Opening bible." : "I am working on your answer.";
 await act(async () => { final(kind === "card" ? "one" : kind === "navigation" ? "open Bible" : "What is grace?"); mocks.emit("end"); });
 expect(mocks.heldSpeech).toHaveLength(1);
 await act(async () => { mocks.session = "session-two"; renderer.update(element()); });
 await releaseAcknowledgement();
 expect(action).not.toHaveBeenCalled(); expect(mocks.navigate).not.toHaveBeenCalled(); expect(controls.enabled).toBe(false); expect(mocks.start).toHaveBeenCalledTimes(starts);
});
it.each(["eligibility", "permission"])("same-user session replacement revokes held start %s and never enables capture", async (phase) => {
 await mount(); let finish!: () => void;
 if (phase === "eligibility") mocks.api.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ pro: true, available: false }); }));
 else mocks.permission.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ granted: true }); }));
 await act(async () => { controls.start(); await vi.dynamicImportSettled(); });
 expect(finish).toBeTypeOf("function");
 await act(async () => { mocks.session = "session-two"; renderer.update(element()); });
 await act(async () => { finish(); }); await flush();
 expect(controls.enabled).toBe(false); expect(mocks.start).not.toHaveBeenCalled();
 if (phase === "eligibility") expect(mocks.permission).not.toHaveBeenCalled();
});
it("session-only replacement stops a held listening cue before recognizer.start", async () => {
 await mount(); mocks.holdSpeech = "Listening."; await start(); expect(mocks.heldSpeech).toHaveLength(1); expect(mocks.start).not.toHaveBeenCalled();
 await act(async () => { mocks.session = "session-two"; renderer.update(element()); }); await releaseAcknowledgement();
 expect(mocks.start).not.toHaveBeenCalled(); expect(controls.enabled).toBe(false);
});
it("eligibility belongs to the actual session and a missing session never requests permission", async () => {
 await mount(); expect(controls.eligible).toBe(true);
 let finish!: () => void; mocks.api.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ pro: true, available: false }); }));
 await act(async () => { mocks.session = "session-two"; renderer.update(element()); }); expect(controls.eligible).toBe(false);
 await act(async () => controls.start()); expect(mocks.permission).not.toHaveBeenCalled();
 await act(async () => finish()); await flush(); expect(controls.eligible).toBe(true); expect(controls.enabled).toBe(false);
 await act(async () => { mocks.session = ""; renderer.update(element()); }); await flush(); expect(controls.eligible).toBe(false);
 await act(async () => controls.start()); expect(mocks.permission).not.toHaveBeenCalled();
});
it("actual ChatScreen useAuth and narrator call change the real hook identity on a same-user session replacement", async () => {
 const source = readFileSync(new URL("../../../app/(app)/index.tsx", import.meta.url), "utf8"), lines = source.split("\n");
 const auth = lines.find(line => line.includes("= useAuth();") && line.includes("isSignedIn"))!;
 const identity = lines.find(line => line.includes("const voiceIdentity =")) ?? "";
 const call = lines.find(line => line.includes("useWelcomeVoice({ enabled: focused"))!;
 expect(auth).toBeTypeOf("string"); expect(call).toBeTypeOf("string");
 const compiled = ts.transpileModule([auth, identity, call].join("\n"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
 const invoke = new Function("useAuth", "useWelcomeVoice", "focused", "historyLoading", "inWelcome", "voiceMode", "voice", "voiceMessages", "getToken", "chat", compiled);
 let finish!: (value: unknown) => void;
 const body = (text: string) => ({ messages: [{ id: "reply", role: "assistant", content: text, metadata: { parts: [{ type: "text", text }] } }] });
 mocks.api.mockImplementationOnce(() => new Promise(resolve => { finish = value => resolve(value as { pro: boolean; available: boolean }); })).mockResolvedValue(body("Fresh session answer.") as unknown as { pro: boolean; available: boolean });
 const getToken = async () => "token";
 function Narrator({ text }: { text: string }) { invoke(() => ({ isSignedIn: true, userId: mocks.account, sessionId: mocks.session }), useWelcomeVoice, true, false, false, false, { enabled: true }, [{ id: "reply", role: "assistant", text }], getToken, { activeConversationId: "conversation" }); return null; }
 await act(async () => { renderer = create(React.createElement(Narrator, { text: "Prior session answer." })); }); await flush();
 await act(async () => { mocks.session = "session-two"; renderer.update(React.createElement(Narrator, { text: "Fresh session answer." })); });
 await act(async () => { finish(body("Prior session answer.")); }); await flush();
 expect(mocks.speak).toHaveBeenCalledExactlyOnceWith("Fresh session answer.", 1.05); expect(mocks.api).toHaveBeenCalledTimes(2);
});


/** Commit a normal concurrent RN19 unmount, then resolve the held operation
 * after layout cleanup and before deferred passive cleanup. A slow layout
 * deliberately exhausts Scheduler's slice, exposing the real passive gap. */
function unmountWitness() {
 let committed = false, passive = false;
 let signal!: () => void;
 const commit = new Promise<void>(resolve => { signal = resolve; });
 function Witness({ children }: { children: React.ReactNode }) {
  React.useLayoutEffect(() => () => {
   committed = true; signal();
   const end = realPerformance.now() + 12;
   while (realPerformance.now() < end) { /* Yield before passive effects. */ }
  }, []);
  React.useEffect(() => () => { passive = true; }, []);
  return children;
 }
 return { Witness, async commitUnmount() {
  vi.useRealTimers();
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = false;
  renderer.unmount();
  await commit;
  expect(committed).toBe(true);
  expect(() => (renderer as unknown as { root: unknown }).root).toThrow(/unmounted/);
  expect(passive).toBe(false);
 }, async finish() {
  await act(async () => { await Promise.resolve(); });
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
 }, proof() { return { committed, passive }; } };
}

it.each([true, false])("committed unmount rejects held narrator output before passive cleanup, deviceOnly=%s", async (deviceOnly) => {
 const witness = unmountWitness();
 let release!: () => void;
 const text = "The saved answer.";
 if (deviceOnly) mocks.api.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({ messages: [{ id: "reply", role: "assistant", content: text, metadata: { parts: [{ type: "text", text }] } }] } as unknown as { pro: boolean; available: boolean }); }));
 else vi.mocked(requestVoice).mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({ status: "device", text, reason: "device", characters: text.length }); }));
 function Narrator() { useWelcomeVoice({ enabled: true, deviceOnly, conversationId: "conversation", sessionKey: "owner:session-one:conversation", getToken: async () => "token", messages: [{ id: "reply", role: "assistant", text }] }); return null; }
 await act(async () => { renderer = create(React.createElement(witness.Witness, { children: React.createElement(Narrator) })); }); await flush();
 expect(release).toBeTypeOf("function");
 try {
  await witness.commitUnmount();
  release(); for (let i = 0; i < 12; i += 1) await Promise.resolve();
  console.log("ANDROID_UNMOUNT_PROOF", JSON.stringify({ surface: "narrator", deviceOnly, ...witness.proof(), spoke: mocks.speak.mock.calls.length }));
  expect(mocks.speak).not.toHaveBeenCalled();
 } finally { await witness.finish(); }
});

it("committed unmount revokes a held choice acknowledgment before passive cleanup", async () => {
 const witness = unmountWitness();
 await act(async () => { renderer = create(React.createElement(VoiceControlProvider, { children: React.createElement(witness.Witness, { children: React.createElement(Probe) }) })); }); await flush();
 const choose = vi.fn(); controls.registerCard({ question: "Choose", options: ["Pastor"], choose }); await start();
 mocks.holdSpeech = "Choosing Pastor.";
 await act(async () => { final("one"); mocks.emit("end"); }); expect(mocks.heldSpeech).toHaveLength(1);
 try {
  await witness.commitUnmount();
  for (const done of mocks.heldSpeech.splice(0)) done(); for (let i = 0; i < 12; i += 1) await Promise.resolve();
  console.log("ANDROID_UNMOUNT_PROOF", JSON.stringify({ surface: "provider", ...witness.proof(), choices: choose.mock.calls.length }));
  expect(choose).not.toHaveBeenCalled();
 } finally { await witness.finish(); }
});


function updateWitness() {
 let committedRevision = 0, passiveRevision = 0;
 let signal!: () => void;
 const committed = new Promise<void>(resolve => { signal = resolve; });
 function Witness({ revision, children }: { revision: number; children: React.ReactNode }) {
  React.useLayoutEffect(() => {
   committedRevision = revision;
   if (revision > 0) {
    signal(); const end = realPerformance.now() + 12;
    while (realPerformance.now() < end) { /* Yield before passive effects. */ }
   }
  }, [revision]);
  React.useEffect(() => { passiveRevision = revision; }, [revision]);
  return children;
 }
 return { Witness, async commitUpdate(element: React.ReactElement) {
  vi.useRealTimers(); (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = false;
  renderer.update(element); await committed;
  expect(committedRevision).toBe(1); expect(passiveRevision).toBe(0);
 }, async finish() {
  await act(async () => { await Promise.resolve(); });
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; vi.useFakeTimers();
 }, proof() { return { committedRevision, passiveRevision }; } };
}

type NarratorProps = { sessionKey: string; enabled: boolean; conversationId: string; deviceOnly: boolean };
const changes = ["session", "disable", "conversation", "deviceOnly"] as const;
it.each([true, false].flatMap(deviceOnly => changes.map(change => ({ deviceOnly, change }))))("committed narrator lifecycle $change update rejects held output, deviceOnly=$deviceOnly", async ({ deviceOnly, change }) => {
 const witness = updateWitness(); let release!: () => void; const text = "The prior lifecycle answer.";
 const initial: NarratorProps = { sessionKey: "owner:session-one:conversation", enabled: true, conversationId: "conversation", deviceOnly };
 const next: NarratorProps = { ...initial, ...(change === "session" ? { sessionKey: "owner:session-two:conversation" } : change === "disable" ? { enabled: false } : change === "conversation" ? { conversationId: "next-conversation" } : { deviceOnly: !deviceOnly }) };
 const body = { messages: [{ id: "reply", role: "assistant", content: text, metadata: { parts: [{ type: "text", text }] } }] };
 mocks.api.mockResolvedValue(body as unknown as { pro: boolean; available: boolean });
 vi.mocked(requestVoice).mockResolvedValue({ status: "device", text, reason: "device", characters: text.length });
 if (deviceOnly) mocks.api.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(body as unknown as { pro: boolean; available: boolean }); }));
 else vi.mocked(requestVoice).mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({ status: "device", text, reason: "device", characters: text.length }); }));
 function Narrator(props: NarratorProps) { useWelcomeVoice({ ...props, getToken: async () => "token", messages: [{ id: "reply", role: "assistant", text }] }); return null; }
 const render = (revision: number, props: NarratorProps) => React.createElement(witness.Witness, { revision, children: React.createElement(Narrator, props) });
 await act(async () => { renderer = create(render(0, initial)); }); await flush(); expect(release).toBeTypeOf("function");
 try {
  await witness.commitUpdate(render(1, next));
  expect((renderer as unknown as { root: { findByType: (type: unknown) => { props: NarratorProps } } }).root.findByType(Narrator).props).toEqual(next);
  release(); for (let i = 0; i < 12; i += 1) await Promise.resolve();
  console.log("ANDROID_LIFECYCLE_UPDATE_PROOF", JSON.stringify({ change, deviceOnly, ...witness.proof(), spoke: mocks.speak.mock.calls.length }));
  expect(mocks.speak).not.toHaveBeenCalled();
 } finally { await witness.finish(); }
});

it("fresh current narrator output still speaks once after an owned session restart", async () => {
 const text = "Fresh saved answer.";
 const body = { messages: [{ id: "reply", role: "assistant", content: text, metadata: { parts: [{ type: "text", text }] } }] };
 mocks.api.mockResolvedValue(body as unknown as { pro: boolean; available: boolean });
 function Narrator({ sessionKey }: { sessionKey: string }) { useWelcomeVoice({ enabled: true, deviceOnly: true, sessionKey, conversationId: "conversation", getToken: async () => "token", messages: [{ id: "reply", role: "assistant", text }] }); return null; }
 await act(async () => { renderer = create(React.createElement(Narrator, { sessionKey: "owner:session-one:conversation" })); }); await flush();
 expect(mocks.speak).toHaveBeenCalledExactlyOnceWith(text, 1.05);
 await act(async () => { renderer.update(React.createElement(Narrator, { sessionKey: "owner:session-two:conversation" })); }); await flush();
 expect(mocks.speak).toHaveBeenCalledTimes(2); expect(mocks.api).toHaveBeenCalledTimes(2);
});

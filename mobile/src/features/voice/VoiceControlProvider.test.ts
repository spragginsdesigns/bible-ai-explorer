import React from "react";
// Runtime renderer is kept as a test dependency, never bundled in the app.
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { acquireVoiceOutput } from "./voiceActivity";

const mocks = vi.hoisted(() => {
	const events = new Map<string, Set<(event?: unknown) => void>>();
	const emit = (name: string, event?: unknown) => { for (const handler of events.get(name) ?? []) handler(event); };
	return {
		account: "owner", path: "/", events, emit,
		appState: new Set<(state: string) => void>(),
		api: vi.fn(async () => ({ pro: true, available: false })),
		start: vi.fn(), stop: vi.fn(() => emit("end")), abort: vi.fn(() => emit("end")),
		permission: vi.fn(async () => ({ granted: true })), navigate: vi.fn(), back: vi.fn(), speak: vi.fn(),
	};
});
vi.mock("react-native", () => ({ View: "View", Pressable: "Pressable", AppState: { currentState: "active", addEventListener: (_: string, fn: (s: string) => void) => { mocks.appState.add(fn); return { remove: () => mocks.appState.delete(fn) }; } } }));
vi.mock("@clerk/expo", () => ({ useAuth: () => ({ userId: mocks.account, isSignedIn: true }) }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 24 }) }));
vi.mock("expo-router", () => ({ usePathname: () => mocks.path, useRouter: () => ({ navigate: mocks.navigate, back: mocks.back, canGoBack: () => true }) }));
vi.mock("expo-speech", () => ({ stop: vi.fn(async () => {}), speak: (text: string, options: { onDone: () => void; rate: number }) => { mocks.speak(text, options.rate); queueMicrotask(options.onDone); } }));
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
let controls: NonNullable<ReturnType<typeof useVoiceControls>>;
let renderer: { unmount: () => void; update: (element: React.ReactElement) => void };
function Probe() { controls = useVoiceControls()!; return null; }
const element = () => React.createElement(VoiceControlProvider, { children: React.createElement(Probe) });
async function flush() { await act(async () => { await Promise.resolve(); await vi.advanceTimersByTimeAsync(300); }); }
async function mount() { await act(async () => { renderer = create(element()); }); await flush(); }
async function start() {
	await act(async () => { controls.start(); await vi.dynamicImportSettled(); });
	await flush();
}
function final(text: string) { mocks.emit("result", { isFinal: true, results: [{ transcript: text }] }); }
beforeEach(() => {
	vi.useFakeTimers(); vi.clearAllMocks(); mocks.account = "owner"; mocks.path = "/"; mocks.events.clear(); mocks.appState.clear(); mocks.api.mockResolvedValue({ pro: true, available: false });
	(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); await vi.runOnlyPendingTimersAsync(); vi.useRealTimers(); });

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
	expect(choose).not.toHaveBeenCalled(); await flush();
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
	expect(mocks.speak).toHaveBeenCalledWith("I am working on your answer.", 1.15);
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
	expect(mocks.speak).toHaveBeenCalledExactlyOnceWith("The answer. Option one. Pastor. Option two. Newly saved.", 1.15);
	expect(mocks.api.mock.invocationCallOrder[0]).toBeLessThan(mocks.speak.mock.invocationCallOrder[0]);
});

import { expect, it, vi } from "vitest";
import { acquireVoiceOutput, registerMicrophonePause, voiceOutputActive } from "./voiceActivity";

it("marks busy before async work, waits for microphone end and serializes output", async () => {
	let microphoneEnd!: () => void;
	const pause = vi.fn(() => new Promise<void>((resolve) => { microphoneEnd = resolve; }));
	const remove = registerMicrophonePause(pause);
	const first = acquireVoiceOutput();
	expect(voiceOutputActive()).toBe(true);
	let ready = false; void first.microphoneStopped.then(() => { ready = true; });
	await Promise.resolve(); expect(ready).toBe(false);
	microphoneEnd(); await first.microphoneStopped; expect(ready).toBe(true);
	remove();
	const second = acquireVoiceOutput(); let secondReady = false;
	void second.microphoneStopped.then(() => { secondReady = true; });
	await Promise.resolve(); expect(secondReady).toBe(false);
	first.release(); await second.microphoneStopped; expect(secondReady).toBe(true);
	expect(voiceOutputActive()).toBe(true); first.release(); expect(voiceOutputActive()).toBe(true);
	second.release(); expect(voiceOutputActive()).toBe(false);
});

it("does not let canceling a queued output overtake the previous speaker", async () => {
	const first = acquireVoiceOutput(); await first.microphoneStopped;
	const canceled = acquireVoiceOutput(); canceled.release();
	const last = acquireVoiceOutput(); let lastReady = false;
	void last.microphoneStopped.then(() => { lastReady = true; });
	await Promise.resolve(); await Promise.resolve(); expect(lastReady).toBe(false);
	first.release(); await last.microphoneStopped; expect(lastReady).toBe(true);
	last.release(); expect(voiceOutputActive()).toBe(false);
});

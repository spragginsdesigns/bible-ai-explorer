import { describe, expect, it, vi } from "vitest";
import { VoiceAudioPlayback, type VoiceAudioPlayer } from "./VoiceAudioPlayback";
import { registerMicrophonePause, voiceOutputActive } from "./voiceActivity";

type Status = { playing: boolean; currentTime: number; didJustFinish: boolean; error?: unknown };
function fakePlayer() {
	const listeners = new Set<(status: Status) => void>();
	const player = {
		muted: false, playing: false as boolean,
		currentStatus: { playing: false as boolean, playbackState: "ready", currentTime: 0, duration: 100, error: null as unknown },
		play: vi.fn(() => { player.playing = true; player.currentStatus.playing = true; player.currentStatus.playbackState = "ready"; }),
		pause: vi.fn(() => { player.playing = false; player.currentStatus.playing = false; }),
		seekTo: vi.fn(async (time: number) => { player.currentStatus.currentTime = time; }),
		addListener: (_name: string, listener: (status: Status) => void) => { listeners.add(listener); return { remove: () => { listeners.delete(listener); } }; },
		emit: (next: Partial<Status>, queued = false) => {
			const status = { playing: false, currentTime: 0, didJustFinish: false, ...next };
			if (!queued) {
				player.playing = status.playing;
				player.currentStatus = { ...player.currentStatus, playing: status.playing, currentTime: status.currentTime,
					playbackState: status.error ? "idle" : status.didJustFinish ? "ended" : "ready", error: status.error ?? null };
			}
			for (const listener of listeners) listener(status);
		},
	} satisfies VoiceAudioPlayer & { emit: (status: Partial<Status>) => void };
	return player;
}
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; };
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

describe("native audio and microphone exclusion", () => {
	it("mutes a new player and holds capture before manual or autoplay audio starts", async () => {
		const stopped = deferred(); const pauseCapture = registerMicrophonePause(() => stopped.promise);
		const player = fakePlayer(); const guard = new VoiceAudioPlayback(player, vi.fn());
		expect(player.muted).toBe(true);
		const playing = guard.play(); expect(voiceOutputActive()).toBe(true);
		await tick(); expect(player.play).not.toHaveBeenCalled(); expect(player.muted).toBe(true);
		stopped.resolve(); expect(await playing).toBe(true); expect(player.play).toHaveBeenCalledOnce(); expect(player.muted).toBe(false);
		player.emit({ playing: true }); expect(voiceOutputActive()).toBe(true);
		guard.pause(); expect(player.muted).toBe(true); expect(voiceOutputActive()).toBe(false);
		pauseCapture(); guard.dispose();
	});
	it("keeps native lock-screen resume silent until capture stops, restoring the last audible position", async () => {
		const player = fakePlayer(); const guard = new VoiceAudioPlayback(player, vi.fn());
		player.emit({ playing: false, currentTime: 42 });
		const stopped = deferred(); const remove = registerMicrophonePause(() => stopped.promise);
		// Native media service starts playback directly, without calling guard.play.
		player.emit({ playing: true, currentTime: 42.25 });
		expect(player.muted).toBe(true); expect(player.pause).toHaveBeenCalled(); expect(voiceOutputActive()).toBe(true);
		await tick(); expect(player.play).not.toHaveBeenCalled();
		stopped.resolve(); await tick(); await tick();
		expect(player.seekTo).toHaveBeenCalledWith(42); expect(player.play).toHaveBeenCalledOnce(); expect(player.muted).toBe(false);
		player.emit({ playing: true, currentTime: 42 }); player.emit({ playing: false, currentTime: 44 });
		expect(player.muted).toBe(true); expect(voiceOutputActive()).toBe(false);
		remove(); guard.dispose();
	});
	it.each(["pause", "dispose"])("does not auto-start after %s while microphone shutdown is pending", async (action) => {
		const stopped = deferred(); const remove = registerMicrophonePause(() => stopped.promise);
		const player = fakePlayer(); const guard = new VoiceAudioPlayback(player, vi.fn());
		const pending = guard.play(); guard[action as "pause" | "dispose"]();
		expect(voiceOutputActive()).toBe(false); stopped.resolve(); expect(await pending).toBe(false);
		expect(player.play).not.toHaveBeenCalled(); expect(player.muted).toBe(true);
		remove(); guard.dispose();
	});
	it.each(["finish", "error", "native pause"])("releases capture exclusion on %s", async (event) => {
		const player = fakePlayer(); const onError = vi.fn(); const guard = new VoiceAudioPlayback(player, onError);
		await guard.play(); player.emit({ playing: true });
		player.emit(event === "finish" ? { didJustFinish: true } : event === "error" ? { error: new Error("stream failed") } : { playing: false });
		expect(voiceOutputActive()).toBe(false); expect(player.muted).toBe(true);
		if (event === "error") expect(onError).toHaveBeenCalledOnce();
		guard.dispose();
	});
	it("releases the lease on microphone failure and does not play", async () => {
		const remove = registerMicrophonePause(async () => { throw new Error("capture did not stop"); });
		const player = fakePlayer(); const onError = vi.fn(); const guard = new VoiceAudioPlayback(player, onError);
		expect(await guard.play()).toBe(false); expect(player.play).not.toHaveBeenCalled(); expect(voiceOutputActive()).toBe(false); expect(onError).toHaveBeenCalledOnce();
		remove(); guard.dispose();
	});
	it("unmount cleanup releases even when the native object is already gone", async () => {
		const player = fakePlayer(); const guard = new VoiceAudioPlayback(player, vi.fn()); await guard.play();
		player.pause.mockImplementation(() => { throw new Error("released native object"); });
		expect(() => guard.dispose()).not.toThrow(); expect(voiceOutputActive()).toBe(false);
	});
	it("ignores an old queued playing event after explicit pause, while retaining real remote resume", async () => {
		const player = fakePlayer(); const guard = new VoiceAudioPlayback(player, vi.fn());
		await guard.play(); player.emit({ playing: true, currentTime: 12 }); guard.pause(); player.play.mockClear();
		player.emit({ playing: true, currentTime: 12 }, true); await tick();
		expect(player.play).not.toHaveBeenCalled(); expect(player.muted).toBe(true); expect(voiceOutputActive()).toBe(false);
		player.emit({ playing: true, currentTime: 12.25 }); await tick(); await tick();
		expect(player.play).toHaveBeenCalledOnce(); guard.dispose();
	});
	it.each(["finish", "error"])("ignores a queued old %s after a newer play", async (event) => {
		const player = fakePlayer(); const onError = vi.fn(); const guard = new VoiceAudioPlayback(player, onError);
		await guard.play(); player.emit({ playing: true, currentTime: 10 }); guard.pause(); await guard.play();
		player.emit(event === "finish" ? { didJustFinish: true, currentTime: 100 } : { error: "old failure" }, true);
		expect(player.playing).toBe(true); expect(player.muted).toBe(false); expect(voiceOutputActive()).toBe(true); expect(onError).not.toHaveBeenCalled();
		guard.dispose();
	});
});

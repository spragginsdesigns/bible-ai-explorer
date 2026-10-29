/** Shared narration lock: recognition is aborted before any app speech starts. */
import { VOICE_PLAYBACK_RATE } from "./voice-commands";
export const WEB_VOICE_RATE = VOICE_PLAYBACK_RATE;
let locks = 0;
let welcomeLocks = 0;
const listeners = new Set<(speaking: boolean) => void>();
export function narrationBusy(): boolean { return locks > 0; }
export function subscribeNarration(listener: (speaking: boolean) => void): () => void {
	listeners.add(listener);
	return () => { listeners.delete(listener); };
}
export function beginNarration(owner?: "welcome"): () => void {
	locks += 1;
	if (owner === "welcome") welcomeLocks += 1;
	listeners.forEach(listener => listener(true));
	let ended = false;
	return () => {
		if (ended) return;
		ended = true;
		locks = Math.max(0, locks - 1);
		if (owner === "welcome") welcomeLocks = Math.max(0, welcomeLocks - 1);
		listeners.forEach(listener => listener(locks > 0));
	};
}

/** Keep command capture out of existing media players, including OS play controls. */
export function coordinateMediaNarration(element: HTMLMediaElement): { play: () => Promise<void>; dispose: () => void } {
	let release: (() => void) | null = null;
	let disposed = false;
	let generation = 0;
	const hold = () => { if (!disposed && !release) release = beginNarration(); };
	const finish = () => { generation += 1; const done = release; release = null; done?.(); };
	const onPlay = () => { if (!element.paused) hold(); };
	const onPause = () => { if (element.paused) finish(); };
	const onEnded = () => { if (element.ended || element.paused) finish(); };
	const onError = () => { if (element.error) finish(); };
	const events = [
		["play", onPlay], ["pause", onPause], ["ended", onEnded], ["error", onError], ["emptied", onPause],
	] as const;
	for (const [event, listener] of events) element.addEventListener(event, listener);
	if (!element.paused) hold();
	return {
		async play() {
			if (disposed) return;
			const attempt = ++generation;
			// Abort recognition before play() can produce any audible output.
			hold();
			try { await element.play(); }
			catch (error) { if (attempt === generation) finish(); throw error; }
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			for (const [event, listener] of events) element.removeEventListener(event, listener);
			try { element.pause(); } finally { finish(); }
		},
	};
}

/** Status/options wait for the existing welcome Audio queue to drain. */
export function waitForWelcomeNarration(): Promise<void> {
	if (!welcomeLocks) return Promise.resolve();
	return new Promise(resolve => {
		const unsubscribe = subscribeNarration(() => { if (!welcomeLocks) { unsubscribe(); resolve(); } });
	});
}

export function speakVoiceStatus(text: string): { done: Promise<void>; cancel: () => void } {
	let cancel = () => {};
	const done = new Promise<void>((resolve, reject) => {
		if (!("speechSynthesis" in window)) { resolve(); return; }
		const release = beginNarration();
		const utterance = new SpeechSynthesisUtterance(text);
		utterance.rate = WEB_VOICE_RATE;
		utterance.pitch = 1;
		let finished = false;
		const finish = (error?: Error) => { if (finished) return; finished = true; release(); if (error) reject(error); else resolve(); };
		utterance.onend = () => finish();
		utterance.onerror = () => finish(new Error("Speech playback failed."));
		cancel = () => { window.speechSynthesis.cancel(); finish(); };
		try { window.speechSynthesis.speak(utterance); } catch { finish(new Error("Speech playback failed.")); }
	});
	return { done, cancel: () => cancel() };
}

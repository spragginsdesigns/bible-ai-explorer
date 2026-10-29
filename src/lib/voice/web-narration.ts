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

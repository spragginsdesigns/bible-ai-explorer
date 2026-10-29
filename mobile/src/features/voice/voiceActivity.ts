/** Shared microphone/output exclusion, including the existing welcome narrator. */
let outputs = 0;
let tail: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();
const pausers = new Set<() => Promise<void>>();
const failures = new Set<(message: string) => void>();
export const voiceOutputActive = () => outputs > 0;
export function subscribeVoiceOutput(listener: () => void) {
	listeners.add(listener);
	return () => { listeners.delete(listener); };
}
export function registerMicrophonePause(pause: () => Promise<void>) {
	pausers.add(pause);
	return () => { pausers.delete(pause); };
}
export function subscribeVoiceFailure(listener: (message: string) => void) {
	failures.add(listener);
	return () => { failures.delete(listener); };
}
export function reportVoiceFailure(message: string) { for (const listener of failures) listener(message); }
/** Marks output busy synchronously, before any token/network/audio operation. */
export function acquireVoiceOutput() {
	const previous = tail;
	let complete!: () => void;
	const finished = new Promise<void>((resolve) => { complete = resolve; });
	// A canceled queued item must not let later speech overtake its predecessor.
	tail = previous.then(() => finished);
	outputs += 1;
	for (const listener of listeners) listener();
	let released = false;
	return {
		microphoneStopped: Promise.all([previous, ...[...pausers].map((pause) => pause())]),
		release() {
			if (released) return;
			released = true;
			outputs -= 1;
			complete();
			for (const listener of listeners) listener();
		},
	};
}

import { stageAudioContext } from "./stage-kit";

/**
 * Crest Hopper's sound (LC-17851): chiptune, synthesized with Web Audio
 * square and triangle oscillators and a little noise, so the game ships no
 * sound files. A low storm ostinato under the round that quickens toward
 * Jesus, a blip for each hop that climbs as Peter nears him, a splash of noise
 * for a slip, a rising hiss for a gust's warning and a rush when it shoves,
 * and a short jingle on reaching Jesus. The stage creates it on the round's
 * first step, on the shared stage AudioContext that the Start press unlocks.
 */

export interface HopperAudio {
	/** One beat of the ostinato; `beat` counts up from 0, `progress` is 0 at the ship to 1 at Jesus. */
	beat(beat: number, progress: number): void;
	hop(progress: number): void;
	side(): void;
	land(): void;
	steady(): void;
	slip(): void;
	gustWarn(): void;
	gust(): void;
	victory(): void;
	lost(): void;
	setMuted(muted: boolean): void;
	pause(): void;
	resume(): void;
	close(): void;
}

/** Notes by semitone from A4. */
function note(semitones: number): number {
	return 440 * Math.pow(2, semitones / 12);
}

export function createHopperAudio(muted: boolean): HopperAudio | null {
	// The shared stage context, unlocked by the Start press (iOS plays nothing from a context opened later).
	const shared = stageAudioContext();
	if (!shared) return null;
	const context: AudioContext = shared;
	const master = context.createGain();
	master.gain.value = muted ? 0 : 0.5;
	master.connect(context.destination);

	const noise = context.createBuffer(1, Math.floor(context.sampleRate * 1.5), context.sampleRate);
	const data = noise.getChannelData(0);
	for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

	/** One chip voice: a wave from `from` Hz (sliding to `to`), a fast attack and a short fall. */
	function tone(type: OscillatorType, from: number, to: number, start: number, length: number, peak: number) {
		const t = context.currentTime + start;
		const osc = context.createOscillator();
		osc.type = type;
		osc.frequency.setValueAtTime(from, t);
		if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, t + length);
		const gain = context.createGain();
		gain.gain.setValueAtTime(0.0001, t);
		gain.gain.exponentialRampToValueAtTime(peak, t + 0.008);
		gain.gain.setValueAtTime(peak, t + length * 0.55);
		gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
		osc.connect(gain).connect(master);
		osc.start(t);
		osc.stop(t + length + 0.02);
	}

	function hiss(filter: BiquadFilterType, from: number, to: number, start: number, length: number, peak: number) {
		const t = context.currentTime + start;
		const source = context.createBufferSource();
		source.buffer = noise;
		const shape = context.createBiquadFilter();
		shape.type = filter;
		shape.frequency.setValueAtTime(from, t);
		shape.frequency.exponentialRampToValueAtTime(to, t + length);
		shape.Q.value = 1.2;
		const gain = context.createGain();
		gain.gain.setValueAtTime(0.0001, t);
		gain.gain.exponentialRampToValueAtTime(peak, t + Math.min(0.05, length / 3));
		gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
		source.connect(shape).connect(gain).connect(master);
		source.start(t);
		source.stop(t + length + 0.05);
	}

	// The storm's bass line in A minor (A, A, F, G), and a pentatonic run the hops climb toward Jesus.
	const BASS = [-24, -24, -28, -26];
	const SCALE = [3, 5, 7, 10, 12, 15, 17, 19, 22, 24, 27, 29];

	return {
		beat(beat, progress) {
			const root = BASS[Math.floor(beat / 2) % BASS.length];
			tone("triangle", note(root), note(root), 0, 0.22, 0.2);
			if (beat % 2 === 1) hiss("lowpass", 500, 200, 0, 0.12, 0.05);
			// Nearer Jesus, a high answer joins in.
			if (progress > 0.45 && beat % 4 === 2) tone("square", note(root + 31), note(root + 31), 0, 0.09, 0.025);
		},
		hop(progress) {
			const step = SCALE[Math.min(SCALE.length - 1, Math.max(0, Math.round(progress * (SCALE.length - 1))))];
			tone("square", note(step), note(step + 7), 0, 0.07, 0.08);
		},
		side() {
			tone("triangle", note(-2), note(3), 0, 0.06, 0.16);
		},
		land() {
			hiss("highpass", 2400, 4000, 0, 0.06, 0.05);
		},
		steady() {
			tone("triangle", note(3), note(3), 0, 0.1, 0.18);
			tone("triangle", note(10), note(10), 0.08, 0.18, 0.18);
		},
		slip() {
			hiss("bandpass", 1600, 260, 0, 0.45, 0.4);
			tone("square", note(-5), note(-17), 0.02, 0.28, 0.07);
		},
		gustWarn() {
			hiss("highpass", 900, 2600, 0, 1.2, 0.09);
		},
		gust() {
			hiss("bandpass", 2400, 500, 0, 0.35, 0.24);
		},
		victory() {
			// Rising, then a held chord: the wind ceased.
			const melody: [number, number, number][] = [
				[3, 0, 0.12],
				[7, 0.12, 0.12],
				[10, 0.24, 0.12],
				[15, 0.36, 0.3],
				[14, 0.7, 0.12],
				[15, 0.84, 0.7],
			];
			for (const [step, start, length] of melody) tone("square", note(step), note(step), start, length, 0.07);
			for (const [step, start, length] of [
				[-9, 0, 0.36],
				[-5, 0.36, 0.34],
				[-9, 0.84, 1.2],
			] as const) tone("triangle", note(step), note(step), start, length, 0.22);
			tone("triangle", note(-2), note(-2), 0.84, 1.2, 0.12);
		},
		lost() {
			for (const [i, step] of [7, 3, 0, -5].entries()) tone("triangle", note(step), note(step), i * 0.2, 0.3, 0.18);
		},
		setMuted(next) {
			master.gain.setTargetAtTime(next ? 0 : 0.5, context.currentTime, 0.03);
		},
		pause() {
			void context.suspend();
		},
		resume() {
			void context.resume();
		},
		close() {
			// The context is shared by every stage: only this game's sound is cut off.
			master.disconnect();
		},
	};
}

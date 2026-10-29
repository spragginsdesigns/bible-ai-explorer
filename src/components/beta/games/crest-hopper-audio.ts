/**
 * Crest Hopper's sound (LC-17851): chiptune, synthesized with Web Audio
 * square and triangle oscillators and a little noise, so the game ships no
 * sound files. A blip for each hop that climbs with the combo, a splash of
 * noise for a slip, a rush for a gust, and a short jingle on reaching Jesus.
 * Created only from a press (browsers start audio on a gesture).
 */

export interface HopperAudio {
	hop(combo: number): void;
	side(): void;
	slip(): void;
	gustWarn(): void;
	gust(): void;
	rest(): void;
	sinking(): void;
	rescued(): void;
	victory(): void;
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
	const Context = typeof window === "undefined" ? undefined : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
	if (!Context) return null;
	const context = new Context();
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

	// A major pentatonic run the combo climbs: each hop in a row a step higher.
	const SCALE = [3, 5, 7, 10, 12, 15, 17, 19, 22];

	return {
		hop(combo) {
			const step = SCALE[Math.min(SCALE.length - 1, Math.max(0, combo))];
			tone("square", note(step), note(step + 7), 0, 0.07, 0.09);
		},
		side() {
			tone("triangle", note(-2), note(3), 0, 0.06, 0.16);
		},
		slip() {
			hiss("bandpass", 1600, 260, 0, 0.45, 0.4);
			tone("square", note(-5), note(-17), 0.02, 0.28, 0.07);
		},
		gustWarn() {
			hiss("highpass", 900, 2600, 0, 0.9, 0.08);
		},
		gust() {
			hiss("bandpass", 2400, 500, 0, 0.35, 0.22);
		},
		rest() {
			tone("triangle", note(3), note(3), 0, 0.12, 0.2);
			tone("triangle", note(10), note(10), 0.1, 0.22, 0.2);
		},
		sinking() {
			for (const [i, step] of [7, 3, 0, -5].entries()) tone("triangle", note(step), note(step), i * 0.22, 0.3, 0.2);
		},
		rescued() {
			for (const [i, step] of [-9, -5, -2, 3].entries()) tone("triangle", note(step), note(step), i * 0.14, 0.35, 0.2);
		},
		victory() {
			// C major, rising, then a held chord: the wind ceased.
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
			void context.close();
		},
	};
}

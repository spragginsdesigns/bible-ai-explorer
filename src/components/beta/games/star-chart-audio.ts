/**
 * The sound of Star Chart (LC-17851), synthesized with Web Audio so the game
 * ships no sound files: a still desert night under everything, a quill's
 * scratch for each turn of a tile, a parchment rustle when a new chart is
 * unrolled, a small bell when the road joins up, a warm chord at the house,
 * and a low falling tone when the dawn comes. Created only from a press
 * (browsers start audio on a gesture).
 */

export interface ChartAudio {
	quill(): void;
	rustle(): void;
	bell(): void;
	chord(): void;
	hint(): void;
	astray(): void;
	dawn(): void;
	setMuted(muted: boolean): void;
	pause(): void;
	resume(): void;
	close(): void;
}

const LEVEL = 0.8;

export function createChartAudio(muted: boolean): ChartAudio | null {
	const Context = typeof window === "undefined" ? undefined : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
	if (!Context) return null;
	const context = new Context();
	const master = context.createGain();
	master.gain.value = muted ? 0 : LEVEL;
	master.connect(context.destination);

	const noise = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
	const data = noise.getChannelData(0);
	for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

	// The night: a breath of wind over open ground, barely there.
	const air = context.createBufferSource();
	air.buffer = noise;
	air.loop = true;
	const airShape = context.createBiquadFilter();
	airShape.type = "lowpass";
	airShape.frequency.value = 420;
	const airGain = context.createGain();
	airGain.gain.value = 0.018;
	air.connect(airShape).connect(airGain).connect(master);
	air.start();

	function burst(filter: BiquadFilterType, from: number, to: number, peak: number, seconds: number, q = 1, delay = 0) {
		const t = context.currentTime + delay;
		const source = context.createBufferSource();
		source.buffer = noise;
		const shape = context.createBiquadFilter();
		shape.type = filter;
		shape.Q.value = q;
		shape.frequency.setValueAtTime(from, t);
		shape.frequency.exponentialRampToValueAtTime(to, t + seconds);
		const gain = context.createGain();
		gain.gain.setValueAtTime(0.0001, t);
		gain.gain.exponentialRampToValueAtTime(peak, t + Math.min(0.02, seconds / 3));
		gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
		source.connect(shape).connect(gain).connect(master);
		source.start(t, Math.random() * 1.5);
		source.stop(t + seconds + 0.05);
	}

	function tone(frequency: number, peak: number, attack: number, seconds: number, delay = 0, type: OscillatorType = "sine") {
		const t = context.currentTime + delay;
		const osc = context.createOscillator();
		osc.type = type;
		osc.frequency.value = frequency;
		const gain = context.createGain();
		gain.gain.setValueAtTime(0.0001, t);
		gain.gain.exponentialRampToValueAtTime(peak, t + attack);
		gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
		osc.connect(gain).connect(master);
		osc.start(t);
		osc.stop(t + seconds + 0.05);
	}

	return {
		quill() {
			// Two short strokes of a nib across the page.
			burst("bandpass", 5200, 3200, 0.07, 0.07, 3);
			burst("bandpass", 4200, 2600, 0.05, 0.06, 3, 0.06);
		},
		rustle() {
			burst("highpass", 1400, 2600, 0.09, 0.45, 0.6);
			burst("bandpass", 900, 1800, 0.06, 0.35, 0.8, 0.18);
		},
		bell() {
			// A small bell: a bright fundamental and its inharmonic partials.
			for (const [ratio, peak] of [
				[1, 0.07],
				[2.76, 0.025],
				[5.4, 0.012],
			]) {
				tone(1046.5 * ratio, peak, 0.005, 1.8);
			}
		},
		chord() {
			// G major, warm and slow: they rejoiced with exceeding great joy.
			for (const [frequency, delay] of [
				[98, 0],
				[196, 0.15],
				[246.94, 0.35],
				[293.66, 0.55],
				[392, 0.8],
			]) {
				tone(frequency, 0.045, 0.9, 5.5, delay, "triangle");
			}
		},
		hint() {
			tone(784, 0.035, 0.02, 0.9);
			tone(1174.7, 0.025, 0.02, 1.1, 0.12);
		},
		astray() {
			tone(311.13, 0.04, 0.02, 0.7);
		},
		dawn() {
			tone(220, 0.05, 0.3, 2.6);
			tone(164.81, 0.04, 0.3, 3, 0.5);
		},
		setMuted(next) {
			master.gain.setTargetAtTime(next ? 0 : LEVEL, context.currentTime, 0.05);
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

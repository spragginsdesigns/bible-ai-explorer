/**
 * The sound of The Caravan (LC-17851), synthesized with Web Audio so the game
 * ships no sound files: the desert wind (louder in a gust of the sandstorm),
 * footfalls on the sand, a hand drum and a plucked, oud-like line on the
 * Hijaz scale that build as the caravan keeps its stride, a low drone, a
 * chime when the star is caught up with, and a resolving chord at the house.
 * Created only from a press (browsers start audio on a gesture).
 */

export interface CaravanMix {
	/** On the road (the drum plays); false at a halt or an ending. */
	running: boolean;
	/** 0-3: how much of the music plays, from the stride and how close the star is. */
	level: number;
	/** 0-1: how strongly a gust is blowing on the caravan. */
	gust: number;
}

export interface CaravanAudio {
	set(mix: CaravanMix): void;
	footfall(): void;
	jump(): void;
	land(): void;
	stumble(): void;
	fall(): void;
	chime(): void;
	city(): void;
	joy(): void;
	lost(): void;
	setMuted(muted: boolean): void;
	pause(): void;
	resume(): void;
	close(): void;
}

/** D Hijaz: D Eb F# G A Bb C D, from D3. */
const HIJAZ = [146.83, 155.56, 185, 196, 220, 233.08, 261.63, 293.66, 311.13, 369.99, 392, 440, 466.16, 523.25, 587.33];
/** Two bars of eighths each, scale steps from D3 (-1 rests). */
const PHRASES = [
	[7, -1, 8, 9, 10, -1, 9, 8],
	[11, -1, 12, 11, 10, 9, 8, 7],
	[7, 9, 10, 11, 12, 11, 10, -1],
	[10, 9, 8, 9, 7, -1, -1, -1],
];
/** Maqsum on the drum, by eighth: doum, tek, rest, tek, doum, rest, tek, rest. */
const MAQSUM = ["D", "T", "", "T", "D", "", "T", ""];
const EIGHTH = 0.3;

function noiseBuffer(context: AudioContext, seconds: number): AudioBuffer {
	const buffer = context.createBuffer(1, Math.floor(context.sampleRate * seconds), context.sampleRate);
	const data = buffer.getChannelData(0);
	for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
	return buffer;
}

export function createCaravanAudio(muted: boolean): CaravanAudio | null {
	const Context = typeof window === "undefined" ? undefined : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
	if (!Context) return null;
	const context = new Context();
	const master = context.createGain();
	master.gain.value = muted ? 0 : 0.85;
	master.connect(context.destination);
	const noise = noiseBuffer(context, 2);

	// The wind across the dunes, always there, louder in a gust.
	const windSource = context.createBufferSource();
	windSource.buffer = noise;
	windSource.loop = true;
	const windShape = context.createBiquadFilter();
	windShape.type = "bandpass";
	windShape.frequency.value = 520;
	windShape.Q.value = 0.7;
	const wind = context.createGain();
	wind.gain.value = 0;
	windSource.connect(windShape).connect(wind).connect(master);
	windSource.start();

	// A low drone on D and A, under the drum once the caravan is in stride.
	const droneShape = context.createBiquadFilter();
	droneShape.type = "lowpass";
	droneShape.frequency.value = 420;
	const drone = context.createGain();
	drone.gain.value = 0;
	droneShape.connect(drone).connect(master);
	for (const [frequency, type] of [
		[73.42, "sawtooth"],
		[110, "triangle"],
	] as const) {
		const tone = context.createOscillator();
		tone.type = type;
		tone.frequency.value = frequency;
		tone.connect(droneShape);
		tone.start();
	}

	function burst(filter: BiquadFilterType, frequency: number, peak: number, seconds: number, at = context.currentTime, sweepTo?: number) {
		const source = context.createBufferSource();
		source.buffer = noise;
		const shape = context.createBiquadFilter();
		shape.type = filter;
		shape.frequency.setValueAtTime(frequency, at);
		if (sweepTo) shape.frequency.exponentialRampToValueAtTime(sweepTo, at + seconds);
		const gain = context.createGain();
		gain.gain.setValueAtTime(0.0001, at);
		gain.gain.exponentialRampToValueAtTime(peak, at + 0.008);
		gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
		source.connect(shape).connect(gain).connect(master);
		source.start(at, Math.random() * 1.5);
		source.stop(at + seconds + 0.05);
	}

	function tone(type: OscillatorType, from: number, to: number, peak: number, seconds: number, at = context.currentTime, attack = 0.005) {
		const osc = context.createOscillator();
		osc.type = type;
		osc.frequency.setValueAtTime(from, at);
		if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, at + Math.min(seconds, 0.12));
		const gain = context.createGain();
		gain.gain.setValueAtTime(0.0001, at);
		gain.gain.exponentialRampToValueAtTime(peak, at + attack);
		gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
		osc.connect(gain).connect(master);
		osc.start(at);
		osc.stop(at + seconds + 0.05);
	}

	/** A plucked string: a bright saw that darkens fast, a breath sharp at the attack. */
	function pluck(frequency: number, peak: number, at = context.currentTime, seconds = 0.7) {
		const osc = context.createOscillator();
		osc.type = "sawtooth";
		osc.frequency.setValueAtTime(frequency * 1.018, at);
		osc.frequency.exponentialRampToValueAtTime(frequency, at + 0.04);
		const shape = context.createBiquadFilter();
		shape.type = "lowpass";
		shape.Q.value = 3;
		shape.frequency.setValueAtTime(2600, at);
		shape.frequency.exponentialRampToValueAtTime(420, at + 0.3);
		const gain = context.createGain();
		gain.gain.setValueAtTime(0.0001, at);
		gain.gain.exponentialRampToValueAtTime(peak, at + 0.004);
		gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
		osc.connect(shape).connect(gain).connect(master);
		osc.start(at);
		osc.stop(at + seconds + 0.05);
	}

	function doum(at: number, peak: number) {
		tone("sine", 118, 62, peak, 0.32, at);
		burst("lowpass", 300, peak * 0.25, 0.08, at);
	}

	function tek(at: number, peak: number) {
		burst("bandpass", 3200, peak, 0.06, at);
		tone("triangle", 820, 640, peak * 0.25, 0.05, at);
	}

	function bell(frequency: number, peak: number, at = context.currentTime) {
		for (const [ratio, share, seconds] of [
			[1, 1, 2.6],
			[2.01, 0.4, 1.6],
			[3.02, 0.18, 1.1],
		]) tone("sine", frequency * ratio, frequency * ratio, peak * share, seconds, at, 0.006);
	}

	// The drum and the line, scheduled a little ahead of the clock.
	let mix: CaravanMix = { running: false, level: 0, gust: 0 };
	let nextAt = 0;
	let step = 0;
	let bar = 0;
	const scheduler = window.setInterval(() => {
		if (!mix.running) return;
		const now = context.currentTime;
		if (nextAt < now) nextAt = now + 0.05;
		while (nextAt < now + 0.15) {
			const hit = MAQSUM[step];
			const level = mix.level;
			if (hit === "D" && (level >= 1 || step === 0)) doum(nextAt, 0.34);
			if (hit === "T" && level >= 1) tek(nextAt, 0.11);
			if (level >= 2 && (step === 5 || step === 7)) tek(nextAt, 0.05);
			if (level >= 2) {
				const phrase = PHRASES[(level >= 3 ? bar : Math.floor(bar / 2) * 2) % PHRASES.length];
				const note = phrase[step];
				if ((level >= 3 || bar % 2 === 0) && note >= 0) pluck(HIJAZ[note], 0.075, nextAt);
				if (level >= 3 && step === 0) pluck(HIJAZ[note >= 0 ? note - 7 : 0], 0.05, nextAt, 1.1);
			}
			nextAt += EIGHTH;
			step = (step + 1) % MAQSUM.length;
			if (step === 0) bar += 1;
		}
	}, 30);

	return {
		set(next) {
			const t = context.currentTime;
			if (next.running && !mix.running) {
				nextAt = t + 0.05;
				step = 0;
			}
			mix = next;
			wind.gain.setTargetAtTime(0.035 + 0.2 * next.gust, t, 0.2);
			windShape.frequency.setTargetAtTime(480 + 900 * next.gust, t, 0.25);
			drone.gain.setTargetAtTime(next.running ? 0.012 + 0.012 * Math.min(next.level, 3) : 0.008, t, 0.6);
		},
		footfall() {
			burst("lowpass", 240, 0.16, 0.09);
		},
		jump() {
			burst("bandpass", 700, 0.05, 0.2, context.currentTime, 1700);
		},
		land() {
			burst("lowpass", 260, 0.24, 0.1);
			burst("highpass", 3000, 0.03, 0.16);
		},
		stumble() {
			doum(context.currentTime, 0.32);
			burst("bandpass", 1800, 0.12, 0.3);
		},
		fall() {
			tone("sine", 320, 80, 0.12, 1.1);
			burst("lowpass", 180, 0.3, 0.9);
		},
		chime() {
			const t = context.currentTime;
			bell(1174.66, 0.05, t);
			bell(1760, 0.035, t + 0.12);
		},
		city() {
			const t = context.currentTime;
			for (const [frequency, delay] of [
				[146.83, 0],
				[220, 0.3],
				[293.66, 0.6],
			]) tone("sine", frequency, frequency, 0.05, 4.5, t + delay, 1);
		},
		joy() {
			const t = context.currentTime;
			// Out of the Hijaz into D major: exceeding great joy.
			[293.66, 369.99, 440, 587.33, 739.99, 880].forEach((frequency, i) => pluck(frequency, 0.08, t + i * 0.16, 1.4));
			bell(1174.66, 0.06, t + 1);
			for (const frequency of [146.83, 220, 293.66, 369.99]) tone("sine", frequency, frequency, 0.04, 6, t + 0.9, 1.4);
		},
		lost() {
			const t = context.currentTime;
			pluck(HIJAZ[8], 0.06, t, 1);
			pluck(HIJAZ[7], 0.06, t + 0.4, 1.6);
		},
		setMuted(next) {
			master.gain.setTargetAtTime(next ? 0 : 0.85, context.currentTime, 0.05);
		},
		pause() {
			void context.suspend();
		},
		resume() {
			void context.resume();
		},
		close() {
			window.clearInterval(scheduler);
			void context.close();
		},
	};
}

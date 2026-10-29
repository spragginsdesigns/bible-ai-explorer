/**
 * The night for Follow the Star (LC-17851), synthesized with Web Audio so the
 * game ships no sound files: a soft desert wind, a warm drone that brightens
 * while the company keeps to the star, a shimmering chime as the star is seen
 * again, a low scrape on rough ground, and a quiet resolved chord at the
 * house. Created only from a tap (browsers start audio on a gesture).
 */

export interface NightAudio {
	/** Set every frame: the wind's push (radians a second squared), how close to the star (0-1), whether cloud hides it, the night closing in (0-1). */
	set(wind: number, close: number, hidden: boolean, closing: number): void;
	chime(): void;
	rough(): void;
	arrive(): void;
	lost(): void;
	setMuted(muted: boolean): void;
	pause(): void;
	resume(): void;
	close(): void;
}

const LEVEL = 0.8;

export function createNightAudio(muted: boolean): NightAudio | null {
	const Context = typeof window === "undefined" ? undefined : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
	if (!Context) return null;
	const context = new Context();
	const master = context.createGain();
	master.gain.value = muted ? 0 : LEVEL;
	master.connect(context.destination);

	// A long, soft echo for the chimes and the chord.
	const echo = context.createDelay(1);
	echo.delayTime.value = 0.31;
	const feedback = context.createGain();
	feedback.gain.value = 0.42;
	const echoTone = context.createBiquadFilter();
	echoTone.type = "lowpass";
	echoTone.frequency.value = 2600;
	echo.connect(echoTone).connect(feedback).connect(echo);
	const echoOut = context.createGain();
	echoOut.gain.value = 0.5;
	echoTone.connect(echoOut).connect(master);

	// The wind: filtered noise, its colour wandering.
	const buffer = context.createBuffer(1, context.sampleRate * 3, context.sampleRate);
	const data = buffer.getChannelData(0);
	for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
	const noise = context.createBufferSource();
	noise.buffer = buffer;
	noise.loop = true;
	const windShape = context.createBiquadFilter();
	windShape.type = "bandpass";
	windShape.frequency.value = 420;
	windShape.Q.value = 0.9;
	const windGain = context.createGain();
	windGain.gain.value = 0;
	noise.connect(windShape).connect(windGain).connect(master);
	noise.start();

	// The drone: D and A, low, warm, slowly breathing.
	const padTone = context.createBiquadFilter();
	padTone.type = "lowpass";
	padTone.frequency.value = 500;
	padTone.Q.value = 0.4;
	const padGain = context.createGain();
	padGain.gain.value = 0;
	padTone.connect(padGain).connect(master);
	const oscillators: OscillatorNode[] = [];
	for (const [frequency, type, level, detune] of [
		[73.42, "sine", 0.5, 0],
		[110, "triangle", 0.22, 4],
		[146.83, "sine", 0.26, -5],
		[220, "triangle", 0.08, 7],
	] as const) {
		const tone = context.createOscillator();
		tone.type = type;
		tone.frequency.value = frequency;
		tone.detune.value = detune;
		const gain = context.createGain();
		gain.gain.value = level;
		tone.connect(gain).connect(padTone);
		tone.start();
		oscillators.push(tone);
	}
	const breath = context.createOscillator();
	breath.frequency.value = 0.07;
	const breathDepth = context.createGain();
	breathDepth.gain.value = 0.012;
	breath.connect(breathDepth).connect(padGain.gain);
	breath.start();

	function bell(frequency: number, at: number, peak: number, seconds: number) {
		const tone = context.createOscillator();
		tone.type = "sine";
		tone.frequency.value = frequency;
		const gain = context.createGain();
		gain.gain.setValueAtTime(0.0001, at);
		gain.gain.exponentialRampToValueAtTime(peak, at + 0.02);
		gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
		tone.connect(gain);
		gain.connect(master);
		gain.connect(echo);
		tone.start(at);
		tone.stop(at + seconds + 0.05);
	}

	function swell(frequency: number, at: number, peak: number, seconds: number) {
		const tone = context.createOscillator();
		tone.type = "triangle";
		tone.frequency.value = frequency;
		const shape = context.createBiquadFilter();
		shape.type = "lowpass";
		shape.frequency.value = 1400;
		const gain = context.createGain();
		gain.gain.setValueAtTime(0.0001, at);
		gain.gain.exponentialRampToValueAtTime(peak, at + 1.6);
		gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
		tone.connect(shape).connect(gain);
		gain.connect(master);
		gain.connect(echo);
		tone.start(at);
		tone.stop(at + seconds + 0.05);
	}

	let wander = 0;
	return {
		set(wind, close, hidden, closing) {
			const t = context.currentTime;
			wander += 0.004;
			const gust = Math.min(1, Math.abs(wind) / 0.8);
			windGain.gain.setTargetAtTime(0.02 + 0.06 * gust + (hidden ? 0.025 : 0), t, 0.4);
			windShape.frequency.setTargetAtTime(320 + 260 * gust + 90 * Math.sin(wander * 1.7), t, 0.5);
			padGain.gain.setTargetAtTime(0.05 * (1 - 0.6 * closing), t, 0.6);
			padTone.frequency.setTargetAtTime(280 + 900 * close * (1 - closing), t, 0.5);
		},
		chime() {
			const t = context.currentTime + 0.02;
			// A, C sharp, E and A above: a bright, open shimmer.
			[880, 1108.73, 1318.51, 1760, 2217.46].forEach((frequency, i) => bell(frequency, t + i * 0.07, 0.035 - i * 0.004, 2.6));
		},
		rough() {
			const source = context.createBufferSource();
			source.buffer = buffer;
			const shape = context.createBiquadFilter();
			shape.type = "lowpass";
			shape.frequency.value = 260;
			const gain = context.createGain();
			const t = context.currentTime;
			gain.gain.setValueAtTime(0.0001, t);
			gain.gain.exponentialRampToValueAtTime(0.16, t + 0.05);
			gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
			source.connect(shape).connect(gain).connect(master);
			source.start(t, Math.random() * 2);
			source.stop(t + 0.65);
		},
		arrive() {
			const t = context.currentTime + 0.05;
			// D major, spread wide and slow: come to the house.
			[146.83, 220, 293.66, 369.99, 440].forEach((frequency, i) => swell(frequency, t + i * 0.22, 0.03, 7.5));
			[1174.66, 1479.98, 1760].forEach((frequency, i) => bell(frequency, t + 1.2 + i * 0.18, 0.02, 3.5));
		},
		lost() {
			const t = context.currentTime + 0.05;
			// A low, unresolved fifth that fades into the wind.
			[110, 164.81].forEach((frequency) => swell(frequency, t, 0.025, 4));
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
			for (const tone of oscillators) tone.stop();
			void context.close();
		},
	};
}

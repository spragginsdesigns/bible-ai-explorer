/**
 * The storm for Peter's Water Walk (LC-17850), synthesized with Web Audio so
 * the game ships no sound files: wind and rain from filtered noise, the sea's
 * swell, thunder, a splash when a swell strikes, and a quiet chord when the
 * wind ceases. Created only from a tap (browsers start audio on a gesture).
 */

export interface StormAudio {
	/** Storm 0-1 and the wind's push on Peter, both set every frame. */
	set(storm: number, wind: number): void;
	thunder(): void;
	splash(): void;
	step(): void;
	calm(): void;
	setMuted(muted: boolean): void;
	pause(): void;
	resume(): void;
	close(): void;
}

function noiseBuffer(context: AudioContext, seconds: number, brown: boolean): AudioBuffer {
	const buffer = context.createBuffer(1, Math.floor(context.sampleRate * seconds), context.sampleRate);
	const data = buffer.getChannelData(0);
	let last = 0;
	for (let i = 0; i < data.length; i++) {
		const white = Math.random() * 2 - 1;
		if (brown) {
			last = (last + 0.02 * white) / 1.02;
			data[i] = last * 3.5;
		} else data[i] = white;
	}
	return buffer;
}

export function createStormAudio(muted: boolean): StormAudio | null {
	const Context = typeof window === "undefined" ? undefined : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
	if (!Context) return null;
	const context = new Context();
	const master = context.createGain();
	master.gain.value = muted ? 0 : 0.9;
	master.connect(context.destination);

	const white = noiseBuffer(context, 2, false);
	const brown = noiseBuffer(context, 3, true);

	function loop(buffer: AudioBuffer, filter: BiquadFilterType, frequency: number, q: number) {
		const source = context.createBufferSource();
		source.buffer = buffer;
		source.loop = true;
		const shape = context.createBiquadFilter();
		shape.type = filter;
		shape.frequency.value = frequency;
		shape.Q.value = q;
		const gain = context.createGain();
		gain.gain.value = 0;
		source.connect(shape).connect(gain).connect(master);
		source.start();
		return { shape, gain };
	}

	const wind = loop(white, "bandpass", 500, 0.8);
	const rain = loop(white, "highpass", 3200, 0.5);
	const sea = loop(brown, "lowpass", 380, 0.6);

	function burst(buffer: AudioBuffer, filter: BiquadFilterType, frequency: number, peak: number, seconds: number) {
		const source = context.createBufferSource();
		source.buffer = buffer;
		const shape = context.createBiquadFilter();
		shape.type = filter;
		shape.frequency.value = frequency;
		const gain = context.createGain();
		const t = context.currentTime;
		gain.gain.setValueAtTime(0.0001, t);
		gain.gain.exponentialRampToValueAtTime(peak, t + 0.03);
		gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
		source.connect(shape).connect(gain).connect(master);
		source.start(t);
		source.stop(t + seconds + 0.05);
	}

	return {
		set(storm, push) {
			const t = context.currentTime;
			const gust = Math.min(1, Math.abs(push) / 4);
			wind.gain.gain.setTargetAtTime(storm * (0.05 + 0.22 * gust), t, 0.15);
			wind.shape.frequency.setTargetAtTime(380 + 700 * gust, t, 0.2);
			rain.gain.gain.setTargetAtTime(storm * 0.07, t, 0.3);
			sea.gain.gain.setTargetAtTime(0.06 + storm * 0.18, t, 0.4);
		},
		thunder() {
			burst(brown, "lowpass", 160, 0.9, 2.6);
		},
		splash() {
			burst(white, "bandpass", 900, 0.35, 0.7);
		},
		step() {
			burst(white, "highpass", 1800, 0.05, 0.12);
		},
		calm() {
			const t = context.currentTime;
			// D major, low and slow: the wind ceased.
			for (const [frequency, delay] of [
				[146.83, 0],
				[220, 0.25],
				[293.66, 0.5],
				[369.99, 0.75],
			]) {
				const tone = context.createOscillator();
				tone.type = "sine";
				tone.frequency.value = frequency;
				const gain = context.createGain();
				gain.gain.setValueAtTime(0.0001, t + delay);
				gain.gain.exponentialRampToValueAtTime(0.05, t + delay + 1.2);
				gain.gain.exponentialRampToValueAtTime(0.0001, t + delay + 5.5);
				tone.connect(gain).connect(master);
				tone.start(t + delay);
				tone.stop(t + delay + 5.6);
			}
		},
		setMuted(next) {
			master.gain.setTargetAtTime(next ? 0 : 0.9, context.currentTime, 0.05);
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

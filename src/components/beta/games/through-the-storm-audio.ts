/**
 * The storm heard from inside it, for Through the Storm (LC-17851):
 * synthesized with Web Audio so the game ships no sound files. A howling wind
 * that swells and swings across the ears with each gust, rain all round, the
 * sea washing in, the roar of a great swell rising, distant thunder that
 * rolls in after the flash, a warm tone that holds while the eyes are on
 * Jesus and fades when they leave him, a heartbeat as faith fails, and a calm
 * chord when the wind ceases. Created only from a press (browsers start audio
 * on a gesture).
 */

export interface StormMix {
	/** 1 is the full storm; it falls to 0 once the wind ceases. */
	storm: number;
	/** The wind's drag on the view (negative from the left). */
	wind: number;
	/** 0-1: how squarely the eyes are on Jesus. */
	focus: number;
	/** 0-1: how close the next great swell is to reaching him. */
	swell: number;
	/** 0-100. */
	faith: number;
	/** Seconds on the page's clock. */
	now: number;
}

export interface StormSoundscape {
	/** Called every frame. */
	mix(mix: StormMix): void;
	/** Thunder after a flash; `near` 0-1 brings it sooner and louder. */
	thunder(near: number): void;
	brace(): void;
	braced(): void;
	struck(): void;
	sinking(): void;
	rescue(): void;
	calm(): void;
	setMuted(muted: boolean): void;
	pause(): void;
	resume(): void;
	close(): void;
}

const LEVEL = 0.85;

function noise(context: AudioContext, seconds: number, kind: "white" | "pink" | "brown"): AudioBuffer {
	const buffer = context.createBuffer(2, Math.floor(context.sampleRate * seconds), context.sampleRate);
	for (let channel = 0; channel < 2; channel++) {
		const data = buffer.getChannelData(channel);
		let b0 = 0;
		let b1 = 0;
		let b2 = 0;
		let last = 0;
		for (let i = 0; i < data.length; i++) {
			const white = Math.random() * 2 - 1;
			if (kind === "white") data[i] = white;
			else if (kind === "pink") {
				b0 = 0.99765 * b0 + white * 0.099046;
				b1 = 0.963 * b1 + white * 0.2965164;
				b2 = 0.57 * b2 + white * 1.0526913;
				data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.2;
			} else {
				last = (last + 0.02 * white) / 1.02;
				data[i] = last * 3.5;
			}
		}
	}
	return buffer;
}

/** A small hall from decaying noise, so the storm has air around it. */
function hall(context: AudioContext, seconds: number): AudioBuffer {
	const buffer = context.createBuffer(2, Math.floor(context.sampleRate * seconds), context.sampleRate);
	for (let channel = 0; channel < 2; channel++) {
		const data = buffer.getChannelData(channel);
		for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3);
	}
	return buffer;
}

export function createStormSoundscape(muted: boolean): StormSoundscape | null {
	const Context = typeof window === "undefined" ? undefined : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
	if (!Context) return null;
	const context = new Context();
	const master = context.createGain();
	master.gain.value = muted ? 0 : LEVEL;
	const limiter = context.createDynamicsCompressor();
	limiter.threshold.value = -10;
	limiter.ratio.value = 6;
	master.connect(limiter).connect(context.destination);
	const reverb = context.createConvolver();
	reverb.buffer = hall(context, 2.6);
	const wet = context.createGain();
	wet.gain.value = 0.32;
	reverb.connect(wet).connect(master);

	const white = noise(context, 3, "white");
	const pink = noise(context, 4, "pink");
	const brown = noise(context, 5, "brown");

	function bed(buffer: AudioBuffer, type: BiquadFilterType, frequency: number, q: number, send = 0) {
		const source = context.createBufferSource();
		source.buffer = buffer;
		source.loop = true;
		source.loopStart = Math.random();
		const filter = context.createBiquadFilter();
		filter.type = type;
		filter.frequency.value = frequency;
		filter.Q.value = q;
		const gain = context.createGain();
		gain.gain.value = 0;
		const pan = context.createStereoPanner();
		source.connect(filter).connect(gain).connect(pan).connect(master);
		if (send) {
			const sendGain = context.createGain();
			sendGain.gain.value = send;
			pan.connect(sendGain).connect(reverb);
		}
		source.start(0, Math.random() * 2);
		return { filter, gain, pan };
	}

	// The wind: a broad body and two howls that wander in pitch, swung toward the gust's side.
	const windBody = bed(pink, "lowpass", 700, 0.4, 0.4);
	const howlLow = bed(pink, "bandpass", 420, 7, 0.6);
	const howlHigh = bed(white, "bandpass", 980, 9, 0.6);
	const rainNear = bed(white, "highpass", 4200, 0.4);
	const rainFar = bed(pink, "bandpass", 2400, 0.6, 0.5);
	rainNear.pan.pan.value = -0.35;
	rainFar.pan.pan.value = 0.35;
	const sea = bed(brown, "lowpass", 320, 0.5, 0.3);
	const roar = bed(brown, "bandpass", 140, 1.2, 0.5);

	// The tone that holds while the eyes are on Jesus: a soft open fifth.
	const toneGain = context.createGain();
	toneGain.gain.value = 0;
	const toneFilter = context.createBiquadFilter();
	toneFilter.type = "lowpass";
	toneFilter.frequency.value = 900;
	toneFilter.connect(toneGain).connect(master);
	const toneSend = context.createGain();
	toneSend.gain.value = 0.7;
	toneGain.connect(toneSend).connect(reverb);
	for (const [frequency, detune] of [
		[196, -4],
		[293.66, 3],
		[392, -2],
	]) {
		const osc = context.createOscillator();
		osc.type = frequency > 300 ? "sine" : "triangle";
		osc.frequency.value = frequency;
		osc.detune.value = detune;
		const voice = context.createGain();
		voice.gain.value = frequency > 300 ? 0.5 : 0.8;
		osc.connect(voice).connect(toneFilter);
		osc.start();
	}

	function burst(buffer: AudioBuffer, type: BiquadFilterType, from: number, to: number, peak: number, attack: number, seconds: number, at = context.currentTime, send = 0.4, pan = 0) {
		const source = context.createBufferSource();
		source.buffer = buffer;
		const filter = context.createBiquadFilter();
		filter.type = type;
		filter.frequency.setValueAtTime(from, at);
		filter.frequency.exponentialRampToValueAtTime(to, at + seconds);
		const gain = context.createGain();
		gain.gain.setValueAtTime(0.0001, at);
		gain.gain.exponentialRampToValueAtTime(peak, at + attack);
		gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
		const panner = context.createStereoPanner();
		panner.pan.value = pan;
		source.connect(filter).connect(gain).connect(panner).connect(master);
		if (send) {
			const sendGain = context.createGain();
			sendGain.gain.value = send;
			panner.connect(sendGain).connect(reverb);
		}
		source.start(at, Math.random() * 2);
		source.stop(at + seconds + 0.05);
	}

	function tone(frequency: number, peak: number, attack: number, seconds: number, at = context.currentTime, type: OscillatorType = "sine", glideTo?: number) {
		const osc = context.createOscillator();
		osc.type = type;
		osc.frequency.setValueAtTime(frequency, at);
		if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, at + seconds);
		const gain = context.createGain();
		gain.gain.setValueAtTime(0.0001, at);
		gain.gain.exponentialRampToValueAtTime(peak, at + attack);
		gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
		osc.connect(gain).connect(master);
		const sendGain = context.createGain();
		sendGain.gain.value = 0.6;
		gain.connect(sendGain).connect(reverb);
		osc.start(at);
		osc.stop(at + seconds + 0.05);
	}

	let nextBeat = 0;
	return {
		mix({ storm, wind, focus, swell, faith, now }) {
			const t = context.currentTime;
			const gust = Math.min(1, Math.abs(wind) / 3);
			const side = Math.max(-0.8, Math.min(0.8, wind / 3));
			// Looking away, the wind is all he hears; on Jesus it settles a little.
			const fear = 1 - focus * 0.35;
			windBody.gain.gain.setTargetAtTime(storm * (0.1 + 0.18 * gust) * fear, t, 0.2);
			windBody.filter.frequency.setTargetAtTime(500 + 900 * gust, t, 0.3);
			windBody.pan.pan.setTargetAtTime(side * 0.6, t, 0.3);
			howlLow.gain.gain.setTargetAtTime(storm * (0.05 + 0.3 * gust) * fear, t, 0.25);
			howlLow.filter.frequency.setTargetAtTime(330 + 260 * gust + 60 * Math.sin(now * 0.9), t, 0.3);
			howlLow.pan.pan.setTargetAtTime(side, t, 0.3);
			howlHigh.gain.gain.setTargetAtTime(storm * 0.18 * gust * gust * fear, t, 0.2);
			howlHigh.filter.frequency.setTargetAtTime(820 + 700 * gust + 120 * Math.sin(now * 1.7 + 1), t, 0.25);
			howlHigh.pan.pan.setTargetAtTime(-side * 0.5, t, 0.4);
			rainNear.gain.gain.setTargetAtTime(storm * (0.05 + 0.03 * gust), t, 0.4);
			rainFar.gain.gain.setTargetAtTime(storm * 0.06, t, 0.4);
			const wash = 0.6 + 0.4 * Math.sin(now * 0.8) * Math.sin(now * 0.31 + 2);
			sea.gain.gain.setTargetAtTime((0.08 + 0.22 * storm) * wash, t, 0.3);
			sea.filter.frequency.setTargetAtTime(220 + 260 * wash, t, 0.4);
			roar.gain.gain.setTargetAtTime(storm * 0.55 * swell * swell, t, 0.12);
			roar.filter.frequency.setTargetAtTime(110 + 520 * swell * swell, t, 0.15);
			toneGain.gain.setTargetAtTime(0.012 + 0.05 * focus * (0.4 + 0.6 * faith / 100) + 0.05 * (1 - storm), t, 0.35);
			toneFilter.frequency.setTargetAtTime(500 + 1500 * focus, t, 0.4);
			// A heartbeat as faith fails.
			if (storm > 0.5 && faith < 35 && t >= nextBeat) {
				const gap = 0.55 + 0.5 * (faith / 35);
				tone(62, 0.32, 0.01, 0.18, t, "sine", 44);
				tone(58, 0.22, 0.01, 0.16, t + 0.2, "sine", 42);
				nextBeat = t + gap;
			}
		},
		thunder(near) {
			const t = context.currentTime + 0.35 + (1 - near) * 1.6;
			const pan = Math.random() * 1.2 - 0.6;
			if (near > 0.6) burst(white, "highpass", 2400, 600, 0.12, 0.005, 0.35, t - 0.25, 0.8, pan);
			burst(brown, "lowpass", 260, 60, 0.5 + 0.5 * near, 0.08, 2.4, t, 0.6, pan);
			burst(brown, "lowpass", 180, 50, 0.4 + 0.4 * near, 0.3, 3.4, t + 0.5, 0.8, -pan);
		},
		brace() {
			burst(pink, "bandpass", 1600, 500, 0.08, 0.02, 0.3, context.currentTime, 0.2);
		},
		braced() {
			// The swell lifts him and rolls on beneath: a rush passing under.
			burst(pink, "bandpass", 1400, 220, 0.3, 0.06, 1.1, context.currentTime, 0.5);
			tone(293.66, 0.025, 0.05, 0.9);
		},
		struck() {
			const t = context.currentTime;
			burst(white, "lowpass", 5200, 400, 0.65, 0.01, 1.3, t, 0.6);
			burst(brown, "lowpass", 400, 60, 0.7, 0.02, 1.6, t, 0.5);
			tone(78, 0.4, 0.01, 0.5, t, "sine", 38);
		},
		sinking() {
			const t = context.currentTime;
			burst(brown, "lowpass", 900, 90, 0.7, 0.03, 2.2, t, 0.7);
			for (let i = 0; i < 6; i++) tone(520 - i * 50 + Math.random() * 60, 0.04, 0.01, 0.12, t + 0.3 + i * 0.17 + Math.random() * 0.08, "sine", 260);
		},
		rescue() {
			const t = context.currentTime;
			burst(pink, "bandpass", 300, 1800, 0.25, 0.4, 1.4, t, 0.6);
			for (const [frequency, delay] of [
				[196, 0.1],
				[246.94, 0.3],
				[293.66, 0.5],
			]) tone(frequency, 0.05, 0.6, 3.6, t + delay, "triangle");
		},
		calm() {
			const t = context.currentTime;
			// The wind ceased: E major, open and slow, with a bell high above it.
			for (const [frequency, delay, peak] of [
				[82.41, 0, 0.06],
				[164.81, 0.15, 0.05],
				[246.94, 0.45, 0.045],
				[329.63, 0.8, 0.04],
				[415.3, 1.15, 0.035],
				[493.88, 1.5, 0.03],
			]) tone(frequency, peak, 1.4, 7.5, t + delay, frequency < 120 ? "sine" : "triangle");
			for (const [frequency, delay] of [
				[659.25, 1.9],
				[987.77, 2.6],
				[1318.5, 3.4],
			]) tone(frequency, 0.025, 0.01, 3.2, t + delay, "sine");
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

"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * What every chapter game's stage draws and runs on (LC-17851,
 * docs/beta/games.md "A game's stage"): a square canvas painted in a
 * STAGE x STAGE picture at any size, a fixed-step loop, pointer positions in
 * that picture, and a small synthesizer for the game's sound effects.
 */

/** The stage's picture is STAGE x STAGE units, whatever its size on screen. */
export const STAGE = 400;
/** The simulation's fixed step, in seconds. */
export const STAGE_STEP = 1 / 60;

/**
 * Runs a stage: `step()` on a fixed STAGE_STEP clock while not paused, and
 * `draw(context, time)` every frame, the context scaled so the picture is
 * STAGE x STAGE. The canvas fills its square parent at the screen's pixel
 * density (at most 2x).
 */
export function useStageLoop(
	canvasRef: RefObject<HTMLCanvasElement | null>,
	{ paused, step, draw }: { paused: boolean; step: () => void; draw: (context: CanvasRenderingContext2D, time: number) => void },
) {
	const pausedRef = useRef(paused);
	const stepRef = useRef(step);
	const drawRef = useRef(draw);
	pausedRef.current = paused;
	stepRef.current = step;
	drawRef.current = draw;

	useEffect(() => {
		const canvas = canvasRef.current;
		const context = canvas?.getContext("2d");
		if (!canvas || !context) return;
		let scale = 1;
		const resize = () => {
			const width = canvas.clientWidth || STAGE;
			const ratio = Math.min(window.devicePixelRatio || 1, 2);
			canvas.width = Math.round(width * ratio);
			canvas.height = Math.round(width * ratio);
			scale = canvas.width / STAGE;
		};
		resize();
		const observer = new ResizeObserver(resize);
		observer.observe(canvas);
		let frame = 0;
		let last = performance.now();
		let carry = 0;
		const tick = (now: number) => {
			frame = requestAnimationFrame(tick);
			const elapsed = Math.min(0.1, Math.max(0, (now - last) / 1000));
			last = now;
			if (!pausedRef.current) {
				carry += elapsed;
				while (carry >= STAGE_STEP) {
					stepRef.current();
					carry -= STAGE_STEP;
				}
			} else carry = 0;
			context.setTransform(scale, 0, 0, scale, 0, 0);
			drawRef.current(context, now / 1000);
		};
		frame = requestAnimationFrame(tick);
		return () => {
			cancelAnimationFrame(frame);
			observer.disconnect();
		};
	}, [canvasRef]);
}

/** A pointer event's position in the stage's STAGE x STAGE picture. */
export function stagePoint(canvas: HTMLCanvasElement, event: { clientX: number; clientY: number }) {
	const rect = canvas.getBoundingClientRect();
	return {
		x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * STAGE,
		y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * STAGE,
	};
}

/** Takes the presses the player queued since the last step. */
export function takePresses(keys: { presses: string[] }): string[] {
	return keys.presses.length ? keys.presses.splice(0) : [];
}

let sharedAudio: AudioContext | null = null;

/**
 * The one AudioContext every stage plays through. iOS Safari only lets a
 * context start inside a tap or key press, so the player calls
 * `unlockStageAudio` from the Start press and every stage's sound reuses
 * that context instead of opening its own later, in the game loop.
 */
export function stageAudioContext(): AudioContext | null {
	if (typeof window === "undefined") return null;
	if (!sharedAudio || sharedAudio.state === "closed") {
		const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
		if (!Context) return null;
		sharedAudio = new Context();
	}
	// "suspended", or WebKit's "interrupted" after a call or an app switch.
	if (sharedAudio.state !== "running") void sharedAudio.resume();
	return sharedAudio;
}

/** Called from the Start (or Play again, Resume) press: opens or resumes the stages' AudioContext inside the gesture. */
export function unlockStageAudio() {
	stageAudioContext();
}

export interface Synth {
	/** A tone: `frequency` Hz for `seconds`, with an optional glide to `to` Hz. */
	tone: (frequency: number, seconds: number, options?: { type?: OscillatorType; volume?: number; to?: number; delay?: number }) => void;
	/** A burst of filtered noise (splash, wind, thud). */
	noise: (seconds: number, options?: { volume?: number; filter?: number; type?: BiquadFilterType; delay?: number }) => void;
	setMuted: (muted: boolean) => void;
	close: () => void;
}

/**
 * A tiny synthesizer for a stage's sound effects, played through the shared
 * stage AudioContext (unlocked by the Start press) with its own volume.
 */
export function createSynth(muted: boolean): Synth {
	let context: AudioContext | null = null;
	let master: GainNode | null = null;
	let isMuted = muted;
	const ready = () => {
		if (isMuted) return null;
		if (!context) {
			context = stageAudioContext();
			if (!context) return null;
			master = context.createGain();
			master.gain.value = 0.5;
			master.connect(context.destination);
		}
		if (context.state === "suspended") void context.resume();
		return context;
	};
	return {
		tone(frequency, seconds, { type = "sine", volume = 0.3, to, delay = 0 } = {}) {
			const audio = ready();
			if (!audio || !master) return;
			const start = audio.currentTime + delay;
			const oscillator = audio.createOscillator();
			const gain = audio.createGain();
			oscillator.type = type;
			oscillator.frequency.setValueAtTime(frequency, start);
			if (to) oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, to), start + seconds);
			gain.gain.setValueAtTime(0.0001, start);
			gain.gain.exponentialRampToValueAtTime(volume, start + 0.01);
			gain.gain.exponentialRampToValueAtTime(0.0001, start + seconds);
			oscillator.connect(gain).connect(master);
			oscillator.start(start);
			oscillator.stop(start + seconds + 0.02);
		},
		noise(seconds, { volume = 0.25, filter = 1200, type = "lowpass", delay = 0 } = {}) {
			const audio = ready();
			if (!audio || !master) return;
			const start = audio.currentTime + delay;
			const length = Math.max(1, Math.floor(audio.sampleRate * seconds));
			const buffer = audio.createBuffer(1, length, audio.sampleRate);
			const data = buffer.getChannelData(0);
			for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
			const source = audio.createBufferSource();
			source.buffer = buffer;
			const shape = audio.createBiquadFilter();
			shape.type = type;
			shape.frequency.value = filter;
			const gain = audio.createGain();
			gain.gain.value = volume;
			source.connect(shape).connect(gain).connect(master);
			source.start(start);
		},
		setMuted(next) {
			isMuted = next;
			if (master && context) master.gain.setTargetAtTime(next ? 0 : 0.5, context.currentTime, 0.02);
		},
		close() {
			master?.disconnect();
			master = null;
			context = null;
		},
	};
}

/** A stage's synthesizer, following the player's mute and closed when the stage goes. */
export function useSynth(muted: boolean) {
	const synth = useRef<Synth | null>(null);
	if (!synth.current && typeof window !== "undefined") synth.current = createSynth(muted);
	useEffect(() => {
		synth.current?.setMuted(muted);
	}, [muted]);
	useEffect(() => () => synth.current?.close(), []);
	return synth;
}

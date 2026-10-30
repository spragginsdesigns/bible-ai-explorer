/** Browser-only PCM transport. The relay uses PCM16LE, mono, 24 kHz both ways. */
import { VOICE_PLAYBACK_RATE } from "./voice-commands";
export const LIVE_SAMPLE_RATE = 24_000;
const MAX_BUFFERED_SECONDS = 12;
/** WebAudio PCM playback changes pitch slightly at this faster rate. */
export const LIVE_PLAYBACK_RATE = VOICE_PLAYBACK_RATE;

export function pcmToBase64(bytes: ArrayBuffer): string {
	const input = new Uint8Array(bytes);
	let binary = "";
	for (let i = 0; i < input.length; i += 1) binary += String.fromCharCode(input[i]);
	return btoa(binary);
}

export class LiveAudio {
	readonly context: AudioContext;
	private closed = false;
	private stream: MediaStream | null = null;
	private input: MediaStreamAudioSourceNode | null = null;
	private capture: AudioWorkletNode | null = null;
	private silentSink: GainNode | null = null;
	private sources = new Set<AudioBufferSourceNode>();
	private nextPlaybackAt = 0;
	private buffered: Float32Array[] = [];
	private bufferedSamples = 0;
	private muted = false;

	constructor(private readonly onPlaybackBlocked: (blocked: boolean) => void) {
		this.context = new AudioContext();
	}

	/** Call from a user activation, including before the first network await. */
	async resume(): Promise<void> {
		if (this.closed) return;
		await this.context.resume();
		if (this.closed) return;
		const blocked = this.context.state !== "running";
		this.onPlaybackBlocked(blocked);
		if (!blocked) {
			const pending = this.buffered;
			this.buffered = [];
			this.bufferedSamples = 0;
			for (const samples of pending) this.schedule(samples);
		}
	}

	async startCapture(onPcm: (bytes: ArrayBuffer) => void, onTrackEnded: () => void): Promise<void> {
		const stream = await navigator.mediaDevices.getUserMedia({
			audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
		});
		// Permission can settle after End or unmount. Do not leak its late tracks.
		if (this.closed) { stream.getTracks().forEach(track => track.stop()); return; }
		this.stream = stream;
		stream.getAudioTracks().forEach(track => { track.onended = onTrackEnded; });
		await this.context.audioWorklet.addModule("/voice/pcm-capture.js");
		if (this.closed) return;
		this.capture = new AudioWorkletNode(this.context, "sureword-pcm-capture");
		this.capture.port.onmessage = ({ data }: MessageEvent<unknown>) => {
			if (!this.closed && !this.muted && data instanceof ArrayBuffer) onPcm(data);
		};
		this.input = this.context.createMediaStreamSource(stream);
		this.silentSink = this.context.createGain();
		this.silentSink.gain.value = 0;
		this.input.connect(this.capture);
		this.capture.connect(this.silentSink).connect(this.context.destination);
		this.setMuted(this.muted);
	}

	setMuted(muted: boolean): void {
		this.muted = muted;
		this.stream?.getAudioTracks().forEach(track => { track.enabled = !muted; });
		this.capture?.port.postMessage({ enabled: !muted });
	}

	play(base64: string): void {
		if (this.closed) return;
		if (base64.length > LIVE_SAMPLE_RATE * 2 * MAX_BUFFERED_SECONDS * 1.4) throw new Error("The voice audio packet was too large. Start a new session.");
		const binary = atob(base64);
		if (binary.length % 2 !== 0) throw new Error("The voice service returned invalid audio.");
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
		const view = new DataView(bytes.buffer);
		const samples = new Float32Array(bytes.length / 2);
		for (let i = 0; i < samples.length; i += 1) samples[i] = view.getInt16(i * 2, true) / 32768;
		const queuedSeconds = Math.max(0, this.nextPlaybackAt - this.context.currentTime)
			+ (this.bufferedSamples + samples.length) / LIVE_SAMPLE_RATE / LIVE_PLAYBACK_RATE;
		if (queuedSeconds > MAX_BUFFERED_SECONDS || this.sources.size > 512) throw new Error("Voice playback fell behind. Start a new session.");
		if (this.context.state !== "running") {
			this.buffered.push(samples);
			this.bufferedSamples += samples.length;
			this.onPlaybackBlocked(true);
			return;
		}
		this.schedule(samples);
	}

	private schedule(samples: Float32Array): void {
		if (!samples.length || this.closed) return;
		const buffer = this.context.createBuffer(1, samples.length, LIVE_SAMPLE_RATE);
		buffer.getChannelData(0).set(samples);
		const source = this.context.createBufferSource();
		source.buffer = buffer;
		source.playbackRate.value = LIVE_PLAYBACK_RATE;
		source.connect(this.context.destination);
		this.sources.add(source);
		source.onended = () => { this.sources.delete(source); source.disconnect(); };
		const start = Math.max(this.context.currentTime + 0.015, this.nextPlaybackAt);
		source.start(start);
		this.nextPlaybackAt = start + buffer.duration / LIVE_PLAYBACK_RATE;
	}

	flush(): void {
		for (const source of this.sources) { source.onended = null; try { source.stop(); } catch { /* Already ended. */ } source.disconnect(); }
		this.sources.clear();
		this.buffered = [];
		this.bufferedSamples = 0;
		this.nextPlaybackAt = 0;
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.flush();
		this.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
		this.stream = null;
		this.input?.disconnect();
		if (this.capture) { this.capture.port.onmessage = null; this.capture.port.close(); this.capture.disconnect(); }
		this.silentSink?.disconnect();
		void this.context.close().catch(() => undefined);
	}
}

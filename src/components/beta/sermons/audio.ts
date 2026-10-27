/**
 * Sermon to Study's browser half of transcription (LC-17643): decode the
 * founder's file or recording, make it 16 kHz mono, and cut it into WAV
 * pieces of at most 110 seconds, each at a quiet moment near the end of its
 * window so a word is rarely split. A piece is about 3.5 MB, under the
 * server's request limit, and the server checks the exact format.
 */
import { CHUNK_MAX_SECONDS, CHUNK_SAMPLE_RATE } from "@/lib/beta/sermons/sermons-rules";

const RATE = CHUNK_SAMPLE_RATE;
/** Where a cut may fall: the last 15 seconds of a full window. */
const SEARCH_SECONDS = 15;
const FRAME = Math.round(RATE * 0.05);
const MIN_LAST = 2;

/** The whole recording as 16 kHz mono samples. */
export async function decodeToMono(blob: Blob): Promise<Float32Array> {
	const bytes = await blob.arrayBuffer();
	// decodeAudioData resamples to the context's rate, so a 16 kHz context decodes straight to 16 kHz.
	const context = new OfflineAudioContext(1, RATE, RATE);
	const decoded = await context.decodeAudioData(bytes);
	if (decoded.numberOfChannels === 1) return decoded.getChannelData(0).slice();
	const mono = new Float32Array(decoded.length);
	for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
		const data = decoded.getChannelData(channel);
		for (let i = 0; i < data.length; i += 1) mono[i] += data[i] / decoded.numberOfChannels;
	}
	return mono;
}

/** Sample offsets where each piece ends, cutting at the quietest 50 ms near each window's end. */
export function pieceBounds(samples: Float32Array): number[] {
	const max = CHUNK_MAX_SECONDS * RATE;
	const bounds: number[] = [];
	let start = 0;
	while (samples.length - start > max) {
		const windowEnd = start + max;
		// Never leave a last piece under two seconds (the server refuses a sliver).
		const searchEnd = Math.min(windowEnd, samples.length - MIN_LAST * RATE);
		let best = searchEnd;
		let quietest = Number.POSITIVE_INFINITY;
		for (let at = windowEnd - SEARCH_SECONDS * RATE; at + FRAME <= searchEnd; at += FRAME) {
			let energy = 0;
			for (let i = at; i < at + FRAME; i += 1) energy += samples[i] * samples[i];
			if (energy < quietest) {
				quietest = energy;
				best = at + Math.floor(FRAME / 2);
			}
		}
		bounds.push(best);
		start = best;
	}
	bounds.push(samples.length);
	return bounds;
}

/** One piece as a 16-bit PCM WAV. */
export function wavPiece(samples: Float32Array, from: number, to: number): Blob {
	const length = to - from;
	const buffer = new ArrayBuffer(44 + length * 2);
	const view = new DataView(buffer);
	const write = (at: number, text: string) => [...text].forEach((char, i) => view.setUint8(at + i, char.charCodeAt(0)));
	write(0, "RIFF");
	view.setUint32(4, 36 + length * 2, true);
	write(8, "WAVE");
	write(12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, RATE, true);
	view.setUint32(28, RATE * 2, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	write(36, "data");
	view.setUint32(40, length * 2, true);
	for (let i = 0; i < length; i += 1) {
		const sample = Math.max(-1, Math.min(1, samples[from + i]));
		view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
	}
	return new Blob([buffer], { type: "audio/wav" });
}

/** A recorder type this browser supports: Opus in WebM, or AAC in MP4 on Safari. */
export function recorderType(): string | undefined {
	if (typeof MediaRecorder === "undefined") return undefined;
	return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((type) => MediaRecorder.isTypeSupported(type));
}

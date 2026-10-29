import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Run the production worklet/helper, with explicit browser mocks. These unit
// tests do not open a microphone or establish real browser audio compatibility.
const workerSource = readFileSync(new URL("../public/voice/pcm-capture.js", import.meta.url), "utf8");
const helperSource = ts.transpileModule(
	readFileSync(new URL("../src/lib/voice/live-audio.ts", import.meta.url), "utf8"),
	{ compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText;

function captureHarness(rate) {
	let Capture;
	const packets = [];
	vm.runInNewContext(workerSource, {
		sampleRate: rate,
		AudioWorkletProcessor: class {
			constructor() {
				this.port = { postMessage: (bytes, transfer) => {
					assert.equal(transfer.length, 1);
					assert.equal(transfer[0], bytes);
					packets.push(bytes);
				} };
			}
		},
		registerProcessor(name, implementation) {
			assert.equal(name, "sureword-pcm-capture");
			Capture = implementation;
		},
		Int16Array, ArrayBuffer, DataView, Math,
	});
	const worker = new Capture();
	return { worker, packets, enable: enabled => worker.port.onmessage({ data: { enabled } }) };
}

for (const rate of [16_000, 24_000, 44_100, 48_000]) {
	test(`capture continuously resamples ${rate} Hz to 24 kHz across uneven render blocks`, () => {
		const { worker, packets, enable } = captureHarness(rate);
		enable(true);
		for (let offset = 0, block = 0; offset < rate; block += 1) {
			const length = Math.min(block % 2 ? 96 : 128, rate - offset);
			const samples = Float32Array.from({ length }, (_, i) => .5 * Math.sin(2 * Math.PI * 440 * (offset + i) / rate));
			assert.equal(worker.process([[samples]]), true);
			offset += length;
		}
		// Linear interpolation needs at most one source sample of lookahead;
		// the tail may be waiting in a partially filled 20 ms output packet.
		assert.ok(Math.abs(packets.length * 480 + worker.used - 24_000) <= 2);
		let previous = 0;
		let crossings = 0;
		for (const packet of packets) {
			assert.equal(packet.byteLength, 960);
			const view = new DataView(packet);
			for (let i = 0; i < 480; i += 1) {
				const sample = view.getInt16(i * 2, true);
				assert.ok(Math.abs(sample) <= 16_385);
				if (previous < 0 && sample >= 0) crossings += 1;
				previous = sample;
			}
		}
		assert.ok(Math.abs(crossings / (packets.length * .02) - 440) < 2, "tone frequency/phase must survive block boundaries");
	});
}

test("capture packets preserve PCM16LE encoding, clipping, and stereo downmix", () => {
	const { worker, packets, enable } = captureHarness(24_000);
	const input = Float32Array.from({ length: 480 }, (_, i) => [-2, -1, -.5, 0, .5, 1, 2][i % 7]);
	const expected = [-32768, -32768, -16384, 0, 16384, 32767, 32767];
	worker.process([[input]]);
	assert.equal(packets.length, 0, "capture starts disabled");
	assert.equal(worker.used, 0);
	enable(true);
	worker.process([[input]]);
	assert.equal(packets.length, 1);
	const view = new DataView(packets[0]);
	for (let i = 0; i < 480; i += 1) assert.equal(view.getInt16(i * 2, true), expected[i % 7]);
	assert.equal(view.getUint8(0), 0);
	assert.equal(view.getUint8(1), 128, "negative full scale is 00 80 little endian");
	worker.process([[new Float32Array(480).fill(.5), new Float32Array(480).fill(-.5)]]);
	assert.ok(new Uint8Array(packets[1]).every(byte => byte === 0));
});

test("capture mute drops the partial packet and emits no muted samples", () => {
	const { worker, packets, enable } = captureHarness(24_000);
	enable(true);
	worker.process([[new Float32Array(240).fill(.5)]]);
	assert.equal(worker.used, 240);
	enable(false);
	worker.process([[new Float32Array(960).fill(1)]]);
	assert.equal(packets.length, 0);
	assert.equal(worker.used, 0);
	enable(true);
	worker.process([[new Float32Array(480).fill(-.5)]]);
	assert.equal(packets.length, 1);
	const view = new DataView(packets[0]);
	for (let i = 0; i < 480; i += 1) assert.equal(view.getInt16(i * 2, true), -16_384);
});

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
	return { promise, resolve, reject };
}

function audioHarness() {
	const sources = [];
	const worklets = [];
	const blocks = [];
	const mic = deferred();
	const module = deferred();
	let waitForModule = false;
	function node() {
		return { connections: [], connect(target) { this.connections.push(target); return target; }, disconnect() { this.disconnected = true; } };
	}
	class Context {
		constructor() {
			this.state = "running";
			this.currentTime = 0;
			this.destination = node();
			this.audioWorklet = { addModule: async path => {
				assert.equal(path, "/voice/pcm-capture.js");
				if (waitForModule) await module.promise;
			} };
		}
		resume() { this.state = "running"; return Promise.resolve(); }
		close() { this.state = "closed"; this.closed = true; return Promise.resolve(); }
		createBuffer(channels, length, rate) {
			assert.equal(channels, 1);
			const samples = new Float32Array(length);
			const buffer = { duration: length / rate, rate, samples, getChannelData: () => samples };
			blocks.push(buffer);
			return buffer;
		}
		createBufferSource() {
			const source = { ...node(), start(at) { this.at = at; }, stop() { this.stopped = true; } };
			sources.push(source);
			return source;
		}
		createMediaStreamSource(stream) { this.input = { ...node(), stream }; return this.input; }
		createGain() { this.sink = { ...node(), gain: { value: 1 } }; return this.sink; }
	}
	class Worklet {
		constructor(context, name) {
			assert.equal(name, "sureword-pcm-capture");
			Object.assign(this, node());
			this.port = { sent: [], postMessage(value) { this.sent.push(value); }, close() { this.closed = true; } };
			worklets.push(this);
		}
	}
	const sandbox = {
		exports: {}, AudioContext: Context, AudioWorkletNode: Worklet,
		navigator: { mediaDevices: { getUserMedia: async options => {
			assert.equal(options.audio.channelCount, 1);
			assert.equal(options.audio.echoCancellation, true);
			return mic.promise;
		} } },
		atob, btoa, Uint8Array, Float32Array, DataView, ArrayBuffer, Math, Set, Error,
	};
	vm.runInNewContext(helperSource, sandbox);
	const { LiveAudio, pcmToBase64 } = sandbox.exports;
	const blocked = [];
	const audio = new LiveAudio(value => blocked.push(value));
	const track = { enabled: true, stop() { this.stops = (this.stops ?? 0) + 1; } };
	const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
	return { audio, pcmToBase64, sources, worklets, blocks, blocked, track, stream, mic, module, deferModule() { waitForModule = true; } };
}

test("playback decodes PCM16LE and schedules adjacent chunks in order", () => {
	const { audio, pcmToBase64, sources, blocks } = audioHarness();
	const bytes = new ArrayBuffer(960);
	const view = new DataView(bytes);
	[-32768, -16384, 0, 16384, 32767].forEach((sample, i) => view.setInt16(i * 2, sample, true));
	const encoded = pcmToBase64(bytes);
	assert.equal(encoded, Buffer.from(bytes).toString("base64"));
	audio.play(encoded);
	audio.play(encoded);
	assert.equal(blocks[0].rate, 24_000);
	assert.deepEqual(Array.from(blocks[0].samples.slice(0, 5)), [-1, -.5, 0, .5, 32767 / 32768]);
	assert.ok(sources[1].at >= sources[0].at + .02);
	audio.flush();
	assert.ok(sources.every(source => source.stopped && source.disconnected));
	audio.close();
});

test("suspended playback is bounded and resumes queued chunks only once", async () => {
	const { audio, pcmToBase64, sources, blocked } = audioHarness();
	audio.context.state = "suspended";
	const second = pcmToBase64(new ArrayBuffer(48_000));
	for (let i = 0; i < 12; i += 1) audio.play(second);
	assert.equal(sources.length, 0);
	assert.ok(blocked.every(Boolean));
	assert.throws(() => audio.play(second), /fell behind/);
	await audio.resume();
	assert.equal(sources.length, 12);
	assert.equal(blocked.at(-1), false);
	await audio.resume();
	assert.equal(sources.length, 12, "resume must not replay already-drained chunks");
	audio.close();
	assert.ok(sources.every(source => source.stopped));
});

test("malformed and oversized audio cannot create an unbounded playback queue", () => {
	const { audio, pcmToBase64 } = audioHarness();
	assert.throws(() => audio.play(pcmToBase64(new ArrayBuffer(1))), /invalid audio/);
	assert.throws(() => audio.play("x".repeat(900_000)), /too large/);
	audio.close();
});

test("mute gates both microphone tracks and worklet delivery; close releases all capture resources", async () => {
	const { audio, track, stream, mic, worklets } = audioHarness();
	const received = [];
	const capture = audio.startCapture(bytes => received.push(bytes), () => {});
	mic.resolve(stream);
	await capture;
	assert.equal(audio.context.sink.gain.value, 0);
	const worklet = worklets[0];
	const pcm = new ArrayBuffer(960);
	worklet.port.onmessage({ data: pcm });
	assert.equal(received.length, 1);
	audio.setMuted(true);
	assert.equal(track.enabled, false);
	assert.equal(worklet.port.sent.at(-1).enabled, false);
	worklet.port.onmessage({ data: pcm });
	assert.equal(received.length, 1);
	audio.setMuted(false);
	assert.equal(track.enabled, true);
	worklet.port.onmessage({ data: pcm });
	assert.equal(received.length, 2);
	audio.close();
	audio.close();
	assert.equal(track.stops, 1, "cleanup is idempotent");
	assert.equal(track.onended, null);
	assert.equal(worklet.port.onmessage, null);
	assert.equal(worklet.port.closed, true);
	assert.ok(worklet.disconnected && audio.context.input.disconnected && audio.context.sink.disconnected);
	assert.equal(audio.context.state, "closed");
});

test("microphone permission settling after close immediately stops its tracks", async () => {
	const { audio, track, stream, mic, worklets } = audioHarness();
	const capture = audio.startCapture(() => assert.fail("closed capture emitted audio"), () => {});
	audio.close();
	mic.resolve(stream);
	await capture;
	assert.equal(track.stops, 1);
	assert.equal(worklets.length, 0);
});

test("closing while the worklet module loads releases tracks and never creates capture", async () => {
	const { audio, track, stream, mic, module, worklets, deferModule } = audioHarness();
	deferModule();
	const capture = audio.startCapture(() => assert.fail("closed capture emitted audio"), () => {});
	mic.resolve(stream);
	// Wait for startCapture to install the resolved stream and begin module loading.
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(typeof track.onended, "function");
	audio.close();
	module.resolve();
	await capture;
	assert.equal(track.stops, 1);
	assert.equal(worklets.length, 0);
});

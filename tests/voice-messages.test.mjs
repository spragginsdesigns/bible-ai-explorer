/* Voice messages: audio attachments are accepted under their canonical types
 * (with the aliases platforms really send), capped by size and length, counted
 * against a free daily allowance, and handed to the model as quoted transcript
 * text rather than audio or instructions.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseBuffer } from "music-metadata";

import {
	AUDIO_MEDIA_TYPES,
	MAX_AUDIO_BYTES,
	MAX_AUDIO_SECONDS,
	maxBytesFor,
	validateAttachmentInput,
} from "../src/lib/chat-attachment-types.ts";
import {
	DEFAULT_FREE_DAILY_AUDIO_MINUTES,
	audioQuotaDecision,
	audioTranscriptText,
	formatAudioDuration,
	freeDailyAudioSeconds,
} from "../src/lib/audio-transcription-rules.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("each audio format is accepted by extension, under its canonical type", () => {
	const cases = [
		["voice-message.ogg", "audio/ogg", "audio/ogg"],
		["voice-message.ogg", "audio/opus", "audio/ogg"],
		["note.opus", "", "audio/ogg"],
		["sermon.mp3", "audio/mp3", "audio/mpeg"],
		["memo.m4a", "audio/x-m4a", "audio/mp4"],
		["memo.m4a", "audio/mp4", "audio/mp4"],
		["call.wav", "audio/x-wav", "audio/wav"],
		["clip.webm", "audio/webm", "audio/webm"],
		["clip.webm", "application/octet-stream", "audio/webm"],
	];
	for (const [filename, declared, expected] of cases) {
		assert.equal(validateAttachmentInput({ filename, mediaType: declared, size: 1000 }).mediaType, expected, `${filename} ${declared}`);
	}
});

test("a mismatched extension and type is still refused", () => {
	assert.throws(() => validateAttachmentInput({ filename: "memo.mp3", mediaType: "audio/ogg", size: 1000 }));
	assert.throws(() => validateAttachmentInput({ filename: "memo.flac", mediaType: "audio/flac", size: 1000 }));
});

test("audio gets its own 20 MB cap; other caps are unchanged", () => {
	assert.equal(MAX_AUDIO_BYTES, 20 * 1024 * 1024);
	for (const type of AUDIO_MEDIA_TYPES) assert.equal(maxBytesFor(type), MAX_AUDIO_BYTES);
	assert.equal(maxBytesFor("application/pdf"), 10 * 1024 * 1024);
	assert.equal(maxBytesFor("text/plain"), 1024 * 1024);
	assert.throws(
		() => validateAttachmentInput({ filename: "long.ogg", mediaType: "audio/ogg", size: MAX_AUDIO_BYTES + 1 }),
		/20 MB/,
	);
	assert.equal(MAX_AUDIO_SECONDS, 15 * 60);
});

test("the free allowance reads the env, defaults, and 0 turns it off", () => {
	assert.equal(freeDailyAudioSeconds({}), DEFAULT_FREE_DAILY_AUDIO_MINUTES * 60);
	assert.equal(freeDailyAudioSeconds({ AUDIO_TRANSCRIPTION_FREE_DAILY_MINUTES: "15" }), 900);
	assert.equal(freeDailyAudioSeconds({ AUDIO_TRANSCRIPTION_FREE_DAILY_MINUTES: "0" }), 0);
	assert.equal(freeDailyAudioSeconds({ AUDIO_TRANSCRIPTION_FREE_DAILY_MINUTES: "lots" }), 600);
	assert.equal(freeDailyAudioSeconds({ AUDIO_TRANSCRIPTION_FREE_DAILY_MINUTES: "-3" }), 600);
});

test("the whole message has to fit the free allowance; Pro is never capped", () => {
	const cap = 600;
	assert.deepEqual(audioQuotaDecision({ plan: "free", usedSeconds: 0, newSeconds: 332.5, capSeconds: cap }), { ok: true });
	const over = audioQuotaDecision({ plan: "free", usedSeconds: 332.5, newSeconds: 375.3, capSeconds: cap });
	assert.equal(over.ok, false);
	assert.match(over.message, /6:15/);
	assert.match(over.message, /4 min left of today's 10 free minutes/);
	assert.match(over.message, /SureWord Pro has no limit/);
	assert.deepEqual(audioQuotaDecision({ plan: "pro", usedSeconds: 99999, newSeconds: 900, capSeconds: cap }), { ok: true });
	assert.equal(audioQuotaDecision({ plan: "free", usedSeconds: 0, newSeconds: 5, capSeconds: 0 }).ok, false);
});

test("the iOS copy never mentions SureWord Pro (App Review 3.1.1)", () => {
	const cap = 600;
	const over = audioQuotaDecision({ plan: "free", usedSeconds: 332.5, newSeconds: 375.3, capSeconds: cap, mentionPro: false });
	assert.equal(over.ok, false);
	assert.match(over.message, /refresh over the next 24 hours\.$/);
	assert.doesNotMatch(over.message, /Pro/);
	const off = audioQuotaDecision({ plan: "free", usedSeconds: 0, newSeconds: 5, capSeconds: 0, mentionPro: false });
	assert.doesNotMatch(off.message, /Pro/);
	const complete = read("src/app/api/chat/attachments/[id]/complete/route.ts");
	assert.match(complete, /platformFromHeaders\(request\.headers\) !== "ios"/);
});

test("durations print as m:ss", () => {
	assert.equal(formatAudioDuration(332.5), "5:33");
	assert.equal(formatAudioDuration(59.4), "0:59");
	assert.equal(formatAudioDuration(900), "15:00");
});

test("the model reads a quoted transcript framed as content, not instructions", () => {
	const text = audioTranscriptText({ filename: "voice-message.ogg", durationSeconds: 332.5, transcript: " Karma is biblical. " });
	assert.match(text, /voice message \(voice-message\.ogg, 5:33\)/);
	assert.match(text, /not instructions to you/);
	assert.match(text, /\n"Karma is biblical\."$/);
	assert.match(audioTranscriptText({ filename: "x.ogg", durationSeconds: null, transcript: "" }), /no words could be made out/);
});

test("the duration reader measures a real WAV exactly", async () => {
	// 2.5 seconds of 8 kHz, 16-bit mono silence.
	const samples = 20_000;
	const header = Buffer.alloc(44);
	header.write("RIFF", 0);
	header.writeUInt32LE(36 + samples * 2, 4);
	header.write("WAVEfmt ", 8);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(1, 22);
	header.writeUInt32LE(8000, 24);
	header.writeUInt32LE(16000, 28);
	header.writeUInt16LE(2, 32);
	header.writeUInt16LE(16, 34);
	header.write("data", 36);
	header.writeUInt32LE(samples * 2, 40);
	const wav = Buffer.concat([header, Buffer.alloc(samples * 2)]);
	const metadata = await parseBuffer(wav, { mimeType: "audio/wav" }, { duration: true });
	assert.equal(metadata.format.duration, 2.5);
});

test("audio is transcribed at completion and read by the chat route as text", () => {
	const complete = read("src/app/api/chat/attachments/[id]/complete/route.ts");
	// Measure and check the allowance before anything is paid for.
	assert.match(complete, /readAudioDurationSeconds[\s\S]*audioQuotaDecision[\s\S]*transcribeAudio/);
	const chat = read("src/app/api/ask-question/route.ts");
	assert.match(chat, /isAudioMediaType\(record\.mediaType\)[\s\S]*audioTranscriptText/);
	assert.match(chat, /requireAttachments: threadHasFiles/);
});

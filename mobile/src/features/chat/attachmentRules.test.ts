import { describe, expect, it } from "vitest";
import {
	AUDIO_MEDIA_TYPES,
	MAX_AUDIO_BYTES,
	attachmentSizeError,
	filenameForSharedFile,
	formatAudioDuration,
	maxBytesFor,
	resolveAttachmentType,
	voiceMessageLabel,
} from "./attachmentRules";

// Mirrors tests/voice-messages.test.mjs, which pins the server's copy of these rules.
describe("attachment types", () => {
	it.each([
		["voice-message.ogg", "audio/ogg", "audio/ogg"],
		["voice-message.ogg", "audio/opus", "audio/ogg"],
		["note.opus", "", "audio/ogg"],
		["sermon.mp3", "audio/mp3", "audio/mpeg"],
		["memo.m4a", "audio/x-m4a", "audio/mp4"],
		["memo.m4a", "audio/mp4", "audio/mp4"],
		["call.wav", "audio/x-wav", "audio/wav"],
		["clip.webm", "audio/webm", "audio/webm"],
		["clip.webm", "application/octet-stream", "audio/webm"],
		["photo.JPG", "image/jpeg", "image/jpeg"],
		["notes.pdf", "application/pdf; charset=binary", "application/pdf"],
	])("accepts %s declared as %j as %s", (filename, declared, expected) => {
		expect(resolveAttachmentType(filename, declared)).toEqual({ ok: true, mediaType: expected });
	});

	it("still refuses a mismatched extension and type, or an unlisted format", () => {
		expect(resolveAttachmentType("memo.mp3", "audio/ogg").ok).toBe(false);
		expect(resolveAttachmentType("memo.flac", "audio/flac").ok).toBe(false);
		expect(resolveAttachmentType("clip.mp4", "video/mp4").ok).toBe(false);
		const refused = resolveAttachmentType("song.aiff", null);
		expect(refused.ok).toBe(false);
		if (!refused.ok) expect(refused.message).toMatch(/song\.aiff is not a supported .*audio \(OGG, MP3, M4A, WAV, WebM\)/);
	});
});

describe("attachment sizes", () => {
	it("gives audio its own 20 MB cap and leaves the others alone", () => {
		expect(MAX_AUDIO_BYTES).toBe(20 * 1024 * 1024);
		for (const type of AUDIO_MEDIA_TYPES) expect(maxBytesFor(type)).toBe(MAX_AUDIO_BYTES);
		expect(maxBytesFor("application/pdf")).toBe(10 * 1024 * 1024);
		expect(maxBytesFor("image/png")).toBe(10 * 1024 * 1024);
		expect(maxBytesFor("text/plain")).toBe(1024 * 1024);
		expect(maxBytesFor("application/json")).toBe(1024 * 1024);
	});

	it("names the limit a file broke", () => {
		expect(attachmentSizeError("long.ogg", "audio/ogg", MAX_AUDIO_BYTES)).toBeNull();
		expect(attachmentSizeError("long.ogg", "audio/ogg", MAX_AUDIO_BYTES + 1)).toMatch(/20 MB/);
		expect(attachmentSizeError("scan.pdf", "application/pdf", 11 * 1024 * 1024)).toMatch(/10 MB/);
		expect(attachmentSizeError("empty.txt", "text/plain", 0)).toMatch(/empty or unreadable/);
	});
});

describe("voice message labels", () => {
	it("prints durations as m:ss, rounded", () => {
		expect(formatAudioDuration(332.5)).toBe("5:33");
		expect(formatAudioDuration(59.4)).toBe("0:59");
		expect(formatAudioDuration(900)).toBe("15:00");
		expect(formatAudioDuration(-3)).toBe("0:00");
	});

	it("labels the chip with the length when it is known", () => {
		expect(voiceMessageLabel(75)).toBe("Voice message · 1:15");
		expect(voiceMessageLabel(undefined)).toBe("Voice message");
	});
});

describe("shared file names", () => {
	it("keeps a name that already has a known extension", () => {
		expect(filenameForSharedFile("voice-message.ogg", "audio/ogg", "shared")).toBe("voice-message.ogg");
	});

	it("adds the extension the type implies when the sharing app left it off", () => {
		expect(filenameForSharedFile("PTT-20261007-WA0001", "audio/opus", "shared")).toBe("PTT-20261007-WA0001.ogg");
		expect(filenameForSharedFile(null, "image/jpeg", "shared-1")).toBe("shared-1.jpg");
		expect(filenameForSharedFile("/data/cache/42", "application/pdf", "shared")).toBe("42.pdf");
	});

	it("leaves an unknown type alone so validation can name the file", () => {
		expect(filenameForSharedFile("clip", "video/mp4", "shared")).toBe("clip");
	});
});

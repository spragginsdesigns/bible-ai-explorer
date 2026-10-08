import { describe, expect, it } from "vitest";
import {
	MAX_TRANSCRIPT_BYTES,
	captionsToParagraphs,
	chooseCaptionTrack,
	findYouTubeLink,
	formatTimestamp,
	parseYouTubeVideoId,
	transcriptFileText,
	transcriptFilename,
	utf8ByteLength,
	verifyVideoRequest,
	videoSendingStatus,
	type VideoTranscript,
} from "./videoTranscript";

describe("parseYouTubeVideoId", () => {
	it.each([
		["https://youtu.be/GMwihA5jnhY?is=3s-53jq8-8hFmTb8", "GMwihA5jnhY"],
		["https://www.youtube.com/watch?v=GMwihA5jnhY&t=120s", "GMwihA5jnhY"],
		["https://m.youtube.com/watch?v=GMwihA5jnhY", "GMwihA5jnhY"],
		["https://youtube.com/shorts/GMwihA5jnhY?feature=share", "GMwihA5jnhY"],
		["https://www.youtube.com/live/GMwihA5jnhY", "GMwihA5jnhY"],
		["https://www.youtube.com/embed/GMwihA5jnhY", "GMwihA5jnhY"],
		["youtu.be/GMwihA5jnhY", "GMwihA5jnhY"],
	])("reads %s", (url, id) => {
		expect(parseYouTubeVideoId(url)).toBe(id);
	});

	it.each([
		"https://www.youtube.com/@PowerfulJRE",
		"https://www.youtube.com/watch?v=short",
		"https://www.tiktok.com/@someone/video/7299466335934532906",
		"https://notyoutube.com/watch?v=GMwihA5jnhY",
		"not a link",
	])("refuses %s", (url) => {
		expect(parseYouTubeVideoId(url)).toBeNull();
	});
});

describe("findYouTubeLink and verifyVideoRequest", () => {
	it("finds the link inside shared words", () => {
		expect(findYouTubeLink("Watch this! https://youtu.be/GMwihA5jnhY?si=abc so good")).toEqual({
			url: "https://youtu.be/GMwihA5jnhY?si=abc",
			videoId: "GMwihA5jnhY",
		});
	});

	it("leaves the sentence's punctuation off the id", () => {
		expect(findYouTubeLink("/verify https://youtu.be/GMwihA5jnhY.")?.videoId).toBe("GMwihA5jnhY");
		expect(findYouTubeLink("watch https://youtube.com/watch?v=GMwihA5jnhY!")?.videoId).toBe("GMwihA5jnhY");
		expect(findYouTubeLink("https://youtu.be/GMwihA5jnhY, it's wild")?.videoId).toBe("GMwihA5jnhY");
	});

	it("does not mistake a lookalike domain for YouTube", () => {
		expect(findYouTubeLink("https://notyoutube.com/watch?v=GMwihA5jnhY")).toBeNull();
		expect(findYouTubeLink("https://fake-youtube.com/watch?v=GMwihA5jnhY")).toBeNull();
		expect(findYouTubeLink("(https://www.youtube.com/watch?v=GMwihA5jnhY)")?.videoId).toBe("GMwihA5jnhY");
	});

	it("only treats a /verify message with a YouTube link as a video", () => {
		expect(verifyVideoRequest("/verify https://youtu.be/GMwihA5jnhY")?.videoId).toBe("GMwihA5jnhY");
		expect(verifyVideoRequest("/VERIFY  https://youtu.be/GMwihA5jnhY")?.videoId).toBe("GMwihA5jnhY");
		expect(verifyVideoRequest("/verify Jesus never claimed to be God")).toBeNull();
		expect(verifyVideoRequest("/check https://youtu.be/GMwihA5jnhY")).toBeNull();
		expect(verifyVideoRequest("/verifying https://youtu.be/GMwihA5jnhY")).toBeNull();
	});
});

describe("chooseCaptionTrack", () => {
	const auto = { baseUrl: "a", languageCode: "en", kind: "asr" };
	const manual = { baseUrl: "m", languageCode: "en-US" };
	const spanish = { baseUrl: "s", languageCode: "es", isTranslatable: true };

	it("prefers uploaded English over automatic", () => {
		expect(chooseCaptionTrack([auto, manual])).toEqual({ track: manual, translated: false });
	});

	it("uses automatic English when that is all there is", () => {
		expect(chooseCaptionTrack([spanish, auto])).toEqual({ track: auto, translated: false });
	});

	it("asks for another language in English when it can be translated", () => {
		expect(chooseCaptionTrack([spanish])).toEqual({ track: spanish, translated: true });
	});

	it("has nothing to choose from no tracks", () => {
		expect(chooseCaptionTrack([])).toBeNull();
	});
});

describe("captionsToParagraphs", () => {
	it("folds caption events into stamped ~30 second paragraphs", () => {
		const paragraphs = captionsToParagraphs({
			events: [
				{ tStartMs: 0, segs: [{ utf8: "In the beginning" }, { utf8: " was the Word" }] },
				{ tStartMs: 4000, segs: [{ utf8: "\n" }] },
				{ tStartMs: 12_000, segs: [{ utf8: "and the Word was with God" }] },
				{ tStartMs: 31_000, segs: [{ utf8: "and the Word was God." }] },
				{ tStartMs: 3_725_000, segs: [{ utf8: "Amen." }] },
			],
		});
		expect(paragraphs).toEqual([
			"[0:00] In the beginning was the Word and the Word was with God",
			"[0:31] and the Word was God.",
			"[1:02:05] Amen.",
		]);
	});

	it("survives a caption file with no events", () => {
		expect(captionsToParagraphs({})).toEqual([]);
	});
});

describe("transcriptFileText", () => {
	const base: VideoTranscript = {
		videoId: "GMwihA5jnhY",
		url: "https://youtu.be/GMwihA5jnhY",
		title: "Joe Rogan Experience #2562 - Dan McClellan",
		channel: "PowerfulJRE",
		lengthSeconds: 9353,
		automatic: true,
		translated: false,
		languageCode: "en",
		paragraphs: ["[0:00] Hello.", "[0:30] Second."],
	};

	it("leads with what the model needs to judge the captions", () => {
		const text = transcriptFileText(base);
		expect(text).toContain("Title: Joe Rogan Experience #2562 - Dan McClellan");
		expect(text).toContain("Channel: PowerfulJRE");
		expect(text).toContain("Length: 2:35:53");
		expect(text).toContain("automatic captions");
		expect(text.endsWith("[0:00] Hello.\n\n[0:30] Second.\n")).toBe(true);
	});

	it("cuts an over-long transcript at a paragraph and says where", () => {
		const paragraph = `[1:00:00] ${"word ".repeat(2000)}`;
		const text = transcriptFileText({ ...base, paragraphs: Array.from({ length: 200 }, () => paragraph) });
		expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(MAX_TRANSCRIPT_BYTES);
		expect(text).toContain("[Transcript cut off after 1:00:00 to fit.");
	});
});

describe("utf8ByteLength", () => {
	it("counts what a caption file holds on disk, music notes and curly quotes included", () => {
		for (const text of ["plain", "♪ music ♪", "“quoted” - and ’", "emoji 🙏", ""]) {
			expect(utf8ByteLength(text)).toBe(Buffer.byteLength(text, "utf8"));
		}
	});
});

describe("videoSendingStatus", () => {
	it("tells the user how much video is on its way, and warns when it is long", () => {
		expect(videoSendingStatus(45)).toBe("Sending SureWord the transcript...");
		expect(videoSendingStatus(12 * 60 + 10)).toBe("Sending SureWord the transcript (12 minutes of video)...");
		expect(videoSendingStatus(9353)).toBe(
			"Sending SureWord the transcript (2.6 hours of video, so the answer takes a minute or two)...",
		);
	});
});

describe("formatTimestamp and transcriptFilename", () => {
	it("formats minutes and hours", () => {
		expect(formatTimestamp(65_000)).toBe("1:05");
		expect(formatTimestamp(3_600_000)).toBe("1:00:00");
	});

	it("makes a .txt name the attachment rules accept", () => {
		expect(transcriptFilename("Joe Rogan Experience #2562 - Dan McClellan")).toBe(
			"YouTube-transcript-Joe-Rogan-Experience-2562-Dan-McClellan.txt",
		);
		expect(transcriptFilename("🙏🙏")).toBe("YouTube-transcript-video.txt");
	});
});

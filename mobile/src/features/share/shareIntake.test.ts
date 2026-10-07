import { describe, expect, it } from "vitest";
import { planSharedChat, shareActionMessage, type IncomingSharedFile } from "./shareIntake";

const MB = 1024 * 1024;

const file = (overrides: Partial<IncomingSharedFile>): IncomingSharedFile => ({
	path: "file:///data/user/0/com.spragginsdesigns.sureword/cache/voice-message.ogg",
	mimeType: "audio/ogg",
	fileName: "voice-message.ogg",
	size: 48_000,
	...overrides,
});

describe("planSharedChat", () => {
	it("puts shared text in the composer and attaches nothing", () => {
		expect(planSharedChat({ text: "  Karma is in the Bible, right?  ", files: null })).toEqual({
			text: "Karma is in the Bible, right?",
			files: [],
			notices: [],
		});
	});

	it("falls back to the link when a share has no text of its own", () => {
		expect(planSharedChat({ text: "", webUrl: "https://example.com/post", files: null }).text)
			.toBe("https://example.com/post");
	});

	it("attaches a Discord voice message under its canonical type", () => {
		const draft = planSharedChat({ files: [file({ mimeType: "audio/opus" })] });
		expect(draft.text).toBe("");
		expect(draft.notices).toEqual([]);
		expect(draft.files).toEqual([{
			uri: "file:///data/user/0/com.spragginsdesigns.sureword/cache/voice-message.ogg",
			filename: "voice-message.ogg",
			mediaType: "audio/ogg",
			size: 48_000,
		}]);
	});

	it("names a file the sharing app left without an extension", () => {
		const draft = planSharedChat({ files: [file({ fileName: "PTT-20261007-WA0001", mimeType: "audio/ogg" })] });
		expect(draft.files[0]?.filename).toBe("PTT-20261007-WA0001.ogg");
	});

	it("attaches images and PDFs, and keeps an unknown size for the reader to measure", () => {
		const draft = planSharedChat({
			files: [
				file({ path: "file:///cache/IMG_1.jpg", fileName: "IMG_1.jpg", mimeType: "image/jpeg", size: 2 * MB }),
				file({ path: "file:///cache/tract.pdf", fileName: "tract.pdf", mimeType: "application/pdf", size: null }),
			],
		});
		expect(draft.files.map((f) => [f.filename, f.mediaType, f.size])).toEqual([
			["IMG_1.jpg", "image/jpeg", 2 * MB],
			["tract.pdf", "application/pdf", null],
		]);
	});

	it("rejects an unsupported type with a message and keeps the rest", () => {
		const draft = planSharedChat({
			files: [
				file({ path: "file:///cache/clip.mp4", fileName: "clip.mp4", mimeType: "video/mp4" }),
				file({}),
			],
		});
		expect(draft.files.map((f) => f.filename)).toEqual(["voice-message.ogg"]);
		expect(draft.notices).toHaveLength(1);
		expect(draft.notices[0]).toMatch(/^clip\.mp4 is not a supported/);
	});

	it("rejects a file over its size cap", () => {
		const draft = planSharedChat({ files: [file({ size: 21 * MB })] });
		expect(draft.files).toEqual([]);
		expect(draft.notices).toEqual(["voice-message.ogg exceeds the 20 MB file limit."]);
	});

	it("attaches at most five files", () => {
		const files = Array.from({ length: 7 }, (_, i) =>
			file({ path: `file:///cache/p${i}.png`, fileName: `p${i}.png`, mimeType: "image/png", size: 1000 }));
		const draft = planSharedChat({ files });
		expect(draft.files).toHaveLength(5);
		expect(draft.notices).toEqual(["You can attach up to 5 files per message, so only the first 5 were attached."]);
	});

	it("leaves out whatever would push the message past 25 MB", () => {
		const draft = planSharedChat({
			files: [
				file({ path: "file:///cache/a.ogg", fileName: "a.ogg", size: 15 * MB }),
				file({ path: "file:///cache/b.ogg", fileName: "b.ogg", size: 15 * MB }),
				file({ path: "file:///cache/c.png", fileName: "c.png", mimeType: "image/png", size: 5 * MB }),
			],
		});
		expect(draft.files.map((f) => f.filename)).toEqual(["a.ogg", "c.png"]);
		expect(draft.notices).toEqual(["Attachments can total up to 25 MB per message, so b.ogg was left out."]);
	});

	it("skips entries with no readable path and says so when nothing is left", () => {
		const draft = planSharedChat({ text: null, files: [file({ path: null })] });
		expect(draft).toEqual({
			text: "",
			files: [],
			notices: ["Nothing in that share could be opened in SureWord."],
		});
	});
});

describe("shareActionMessage", () => {
	it("prefixes the composer text with the action's command", () => {
		expect(shareActionMessage("check", "  The KJV mistranslates John 1:1. ")).toBe("/check The KJV mistranslates John 1:1.");
		expect(shareActionMessage("reply", "You're judging me.")).toBe("/reply You're judging me.");
	});

	it("sends the bare command when only a file was shared", () => {
		expect(shareActionMessage("check", "")).toBe("/check");
		expect(shareActionMessage("reply", "   ")).toBe("/reply");
	});
});

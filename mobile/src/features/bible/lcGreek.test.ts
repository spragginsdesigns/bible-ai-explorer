import { afterEach, describe, expect, it, vi } from "vitest";
import { getKjvChapter } from "./kjv";
import { CHAPTER_LOAD_ERROR } from "./translations";
import { getChapterTexts, getLcGreekChapter } from "./lcGreek";

vi.mock("@/lib/api", () => ({ API_URL: "https://sureword.app" }));

const MARK_2 = { status: "ready", book: 41, chapter: 2, verses: ["And again he entered Capernaum.", "Many gathered."] };

function mockFetchJson(body: unknown, ok = true) {
	return vi.fn().mockResolvedValue({ ok, json: () => Promise.resolve(body) } as unknown as Response);
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("getLcGreekChapter", () => {
	it("requests the lc-greek route and caches the chapter", async () => {
		const fetchMock = mockFetchJson(MARK_2);
		vi.stubGlobal("fetch", fetchMock);

		expect(await getLcGreekChapter(41, 2)).toEqual(MARK_2.verses);
		await getLcGreekChapter(41, 2);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenCalledWith(
			"https://sureword.app/api/bible/lc-greek?book=41&chapter=2",
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);
	});

	it("reads a failed request, an unavailable answer or another chapter as a load error", async () => {
		vi.stubGlobal("fetch", mockFetchJson({}, false));
		await expect(getLcGreekChapter(41, 3)).rejects.toThrow(CHAPTER_LOAD_ERROR);
		vi.stubGlobal("fetch", mockFetchJson({ status: "unavailable" }));
		await expect(getLcGreekChapter(41, 4)).rejects.toThrow(CHAPTER_LOAD_ERROR);
		vi.stubGlobal("fetch", mockFetchJson(MARK_2));
		await expect(getLcGreekChapter(41, 5)).rejects.toThrow(CHAPTER_LOAD_ERROR);
	});
});

describe("getChapterTexts", () => {
	it("shows the LC Greek and studies the KJV verse with the same number", async () => {
		const verses = ["The beginning of the gospel.", "As it is written."];
		vi.stubGlobal("fetch", mockFetchJson({ status: "ready", book: 41, chapter: 6, verses }));

		const texts = await getChapterTexts(true, "KJV", 41, 6);

		expect(texts.shown).toEqual(verses);
		expect(texts.study).toEqual(getKjvChapter(41, 6));
	});

	it("shows and studies the same text for a translation", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		const texts = await getChapterTexts(false, "KJV", 41, 1);

		expect(texts.shown).toBe(texts.study);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

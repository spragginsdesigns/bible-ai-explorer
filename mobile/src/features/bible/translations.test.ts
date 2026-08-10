import { afterEach, describe, expect, it, vi } from "vitest";
import { CHAPTER_LOAD_ERROR, getChapter } from "./translations";

// bolls.life responses carry extra fields (pk, comment); only verse and text
// are mapped, with stray double spaces collapsed.
const JOHN_3 = [
	{ pk: 1011, verse: 2, text: "The same came to Jesus by night,  and said unto him…", comment: null },
	{ pk: 1010, verse: 1, text: "There was a man of the Pharisees, named Nicodemus…", comment: null },
];

function mockFetchJson(body: unknown, ok = true) {
	return vi.fn().mockResolvedValue({
		ok,
		json: () => Promise.resolve(body),
	} as unknown as Response);
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("getChapter (NKJV)", () => {
	it("maps bolls.life rows to an ordered verse list with collapsed spacing", async () => {
		vi.stubGlobal("fetch", mockFetchJson(JOHN_3));

		const verses = await getChapter("NKJV", 43, 3);

		expect(verses).toEqual([
			"There was a man of the Pharisees, named Nicodemus…",
			"The same came to Jesus by night, and said unto him…",
		]);
	});

	it("requests the expected bolls.life URL", async () => {
		const fetchMock = mockFetchJson(JOHN_3);
		vi.stubGlobal("fetch", fetchMock);

		await getChapter("NKJV", 19, 23);

		expect(fetchMock).toHaveBeenCalledWith(
			"https://bolls.life/get-chapter/NKJV/19/23/",
			expect.objectContaining({ signal: expect.any(AbortSignal) })
		);
	});

	it("caches chapters in memory", async () => {
		const fetchMock = mockFetchJson(JOHN_3);
		vi.stubGlobal("fetch", fetchMock);

		await getChapter("NKJV", 1, 1);
		await getChapter("NKJV", 1, 1);

		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("throws a friendly error when the request fails", async () => {
		vi.stubGlobal("fetch", mockFetchJson({}, false));

		await expect(getChapter("NKJV", 43, 4)).rejects.toThrow(CHAPTER_LOAD_ERROR);
	});

	it("throws a friendly error on network failure", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Network request failed")));

		await expect(getChapter("NKJV", 43, 5)).rejects.toThrow(CHAPTER_LOAD_ERROR);
	});
});

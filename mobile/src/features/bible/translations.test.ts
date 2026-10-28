import { afterEach, describe, expect, it, vi } from "vitest";
import {
	CHAPTER_LOAD_ERROR,
	LANGUAGE_BIBLES,
	TRANSLATIONS,
	TRANSLATION_IDS,
	getChapter,
	isTranslationId,
	parseTranslationId,
	translationPickerLabel,
} from "./translations";

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

describe("translation list", () => {
	it("holds every id exactly once, each entry keyed by its own id", () => {
		expect(TRANSLATION_IDS).toEqual(["KJV", "NKJV", "BSB", "ASV", "RV1909", "LUT1912"]);
		expect(Object.keys(TRANSLATIONS).sort()).toEqual([...TRANSLATION_IDS].sort());
		for (const id of TRANSLATION_IDS) expect(TRANSLATIONS[id].id).toBe(id);
	});

	it("labels the Bibles in other languages with their language", () => {
		expect(TRANSLATIONS.RV1909).toMatchObject({ label: "Reina-Valera 1909", language: "es", copyright: "Public domain" });
		expect(TRANSLATIONS.LUT1912).toMatchObject({ label: "Lutherbibel 1912", language: "de", copyright: "Public domain" });
		expect(translationPickerLabel("RV1909")).toBe("Reina-Valera 1909 · Español");
		expect(translationPickerLabel("LUT1912")).toBe("Lutherbibel 1912 · Deutsch");
		expect(translationPickerLabel("KJV")).toBe("KJV");
		for (const id of ["KJV", "NKJV", "BSB", "ASV"] as const) expect(TRANSLATIONS[id].language).toBe("en");
		expect(TRANSLATIONS.ASV).toMatchObject({ label: "American Standard Version", copyright: "Public domain" });
		expect(translationPickerLabel("ASV")).toBe("ASV");
	});

	it("maps each language to its own Bible", () => {
		expect(LANGUAGE_BIBLES).toEqual({ en: "KJV", es: "RV1909", de: "LUT1912" });
	});

	it("parses only known ids", () => {
		expect(isTranslationId("RV1909")).toBe(true);
		expect(parseTranslationId("LUT1912")).toBe("LUT1912");
		expect(parseTranslationId("rv1909")).toBeNull();
		expect(parseTranslationId("ESV")).toBeNull();
		expect(parseTranslationId(undefined)).toBeNull();
	});
});

describe("getChapter (bundled Bibles in other languages)", () => {
	it("reads Reina-Valera 1909 and Lutherbibel 1912 offline, verse for verse with the KJV", async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal("fetch", fetchSpy);
		const kjv = await getChapter("KJV", 43, 3);
		const rv = await getChapter("RV1909", 43, 3);
		const lut = await getChapter("LUT1912", 43, 3);
		expect(rv).toHaveLength(kjv.length);
		expect(lut).toHaveLength(kjv.length);
		expect(rv[15]).toMatch(/^Porque de tal manera amó Dios al mundo/);
		expect(lut[15]).toMatch(/^Also hat Gott die Welt geliebt/);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("reads the American Standard Version offline, with the verses it omits left empty (LC-17800)", async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal("fetch", fetchSpy);
		const genesis = await getChapter("ASV", 1, 1);
		expect(genesis[0]).toBe("In the beginning God created the heavens and the earth.");
		const matthew = await getChapter("ASV", 40, 17);
		expect(matthew).toHaveLength((await getChapter("KJV", 40, 17)).length);
		expect(matthew[20]).toBe("");
		expect(matthew[21]).toMatch(/^And while they abode in Galilee/);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("fails an out-of-range chapter with the reader's load error", async () => {
		await expect(getChapter("RV1909", 43, 22)).rejects.toThrow(CHAPTER_LOAD_ERROR);
		await expect(getChapter("LUT1912", 67, 1)).rejects.toThrow(CHAPTER_LOAD_ERROR);
	});
});

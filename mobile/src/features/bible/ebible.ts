/**
 * Lazy access to the bundled public-domain Bibles in other languages
 * (data/rv1909 and data/lut1912, chapters of verses in the KJV's shape).
 * Regenerate the data with scripts/bible/build-ebible.py. Metro needs literal
 * require paths, so every book is listed by hand; a book's JSON is parsed on
 * first access and then cached for the session.
 */
import { bookByOrder } from "./books";

type RawBook = string[][];

export type BundledForeignBible = "RV1909" | "LUT1912";

const RV1909_LOADERS: Record<number, () => RawBook> = {
	1: () => require("./data/rv1909/01.json") as RawBook,
	2: () => require("./data/rv1909/02.json") as RawBook,
	3: () => require("./data/rv1909/03.json") as RawBook,
	4: () => require("./data/rv1909/04.json") as RawBook,
	5: () => require("./data/rv1909/05.json") as RawBook,
	6: () => require("./data/rv1909/06.json") as RawBook,
	7: () => require("./data/rv1909/07.json") as RawBook,
	8: () => require("./data/rv1909/08.json") as RawBook,
	9: () => require("./data/rv1909/09.json") as RawBook,
	10: () => require("./data/rv1909/10.json") as RawBook,
	11: () => require("./data/rv1909/11.json") as RawBook,
	12: () => require("./data/rv1909/12.json") as RawBook,
	13: () => require("./data/rv1909/13.json") as RawBook,
	14: () => require("./data/rv1909/14.json") as RawBook,
	15: () => require("./data/rv1909/15.json") as RawBook,
	16: () => require("./data/rv1909/16.json") as RawBook,
	17: () => require("./data/rv1909/17.json") as RawBook,
	18: () => require("./data/rv1909/18.json") as RawBook,
	19: () => require("./data/rv1909/19.json") as RawBook,
	20: () => require("./data/rv1909/20.json") as RawBook,
	21: () => require("./data/rv1909/21.json") as RawBook,
	22: () => require("./data/rv1909/22.json") as RawBook,
	23: () => require("./data/rv1909/23.json") as RawBook,
	24: () => require("./data/rv1909/24.json") as RawBook,
	25: () => require("./data/rv1909/25.json") as RawBook,
	26: () => require("./data/rv1909/26.json") as RawBook,
	27: () => require("./data/rv1909/27.json") as RawBook,
	28: () => require("./data/rv1909/28.json") as RawBook,
	29: () => require("./data/rv1909/29.json") as RawBook,
	30: () => require("./data/rv1909/30.json") as RawBook,
	31: () => require("./data/rv1909/31.json") as RawBook,
	32: () => require("./data/rv1909/32.json") as RawBook,
	33: () => require("./data/rv1909/33.json") as RawBook,
	34: () => require("./data/rv1909/34.json") as RawBook,
	35: () => require("./data/rv1909/35.json") as RawBook,
	36: () => require("./data/rv1909/36.json") as RawBook,
	37: () => require("./data/rv1909/37.json") as RawBook,
	38: () => require("./data/rv1909/38.json") as RawBook,
	39: () => require("./data/rv1909/39.json") as RawBook,
	40: () => require("./data/rv1909/40.json") as RawBook,
	41: () => require("./data/rv1909/41.json") as RawBook,
	42: () => require("./data/rv1909/42.json") as RawBook,
	43: () => require("./data/rv1909/43.json") as RawBook,
	44: () => require("./data/rv1909/44.json") as RawBook,
	45: () => require("./data/rv1909/45.json") as RawBook,
	46: () => require("./data/rv1909/46.json") as RawBook,
	47: () => require("./data/rv1909/47.json") as RawBook,
	48: () => require("./data/rv1909/48.json") as RawBook,
	49: () => require("./data/rv1909/49.json") as RawBook,
	50: () => require("./data/rv1909/50.json") as RawBook,
	51: () => require("./data/rv1909/51.json") as RawBook,
	52: () => require("./data/rv1909/52.json") as RawBook,
	53: () => require("./data/rv1909/53.json") as RawBook,
	54: () => require("./data/rv1909/54.json") as RawBook,
	55: () => require("./data/rv1909/55.json") as RawBook,
	56: () => require("./data/rv1909/56.json") as RawBook,
	57: () => require("./data/rv1909/57.json") as RawBook,
	58: () => require("./data/rv1909/58.json") as RawBook,
	59: () => require("./data/rv1909/59.json") as RawBook,
	60: () => require("./data/rv1909/60.json") as RawBook,
	61: () => require("./data/rv1909/61.json") as RawBook,
	62: () => require("./data/rv1909/62.json") as RawBook,
	63: () => require("./data/rv1909/63.json") as RawBook,
	64: () => require("./data/rv1909/64.json") as RawBook,
	65: () => require("./data/rv1909/65.json") as RawBook,
	66: () => require("./data/rv1909/66.json") as RawBook,
};

const LUT1912_LOADERS: Record<number, () => RawBook> = {
	1: () => require("./data/lut1912/01.json") as RawBook,
	2: () => require("./data/lut1912/02.json") as RawBook,
	3: () => require("./data/lut1912/03.json") as RawBook,
	4: () => require("./data/lut1912/04.json") as RawBook,
	5: () => require("./data/lut1912/05.json") as RawBook,
	6: () => require("./data/lut1912/06.json") as RawBook,
	7: () => require("./data/lut1912/07.json") as RawBook,
	8: () => require("./data/lut1912/08.json") as RawBook,
	9: () => require("./data/lut1912/09.json") as RawBook,
	10: () => require("./data/lut1912/10.json") as RawBook,
	11: () => require("./data/lut1912/11.json") as RawBook,
	12: () => require("./data/lut1912/12.json") as RawBook,
	13: () => require("./data/lut1912/13.json") as RawBook,
	14: () => require("./data/lut1912/14.json") as RawBook,
	15: () => require("./data/lut1912/15.json") as RawBook,
	16: () => require("./data/lut1912/16.json") as RawBook,
	17: () => require("./data/lut1912/17.json") as RawBook,
	18: () => require("./data/lut1912/18.json") as RawBook,
	19: () => require("./data/lut1912/19.json") as RawBook,
	20: () => require("./data/lut1912/20.json") as RawBook,
	21: () => require("./data/lut1912/21.json") as RawBook,
	22: () => require("./data/lut1912/22.json") as RawBook,
	23: () => require("./data/lut1912/23.json") as RawBook,
	24: () => require("./data/lut1912/24.json") as RawBook,
	25: () => require("./data/lut1912/25.json") as RawBook,
	26: () => require("./data/lut1912/26.json") as RawBook,
	27: () => require("./data/lut1912/27.json") as RawBook,
	28: () => require("./data/lut1912/28.json") as RawBook,
	29: () => require("./data/lut1912/29.json") as RawBook,
	30: () => require("./data/lut1912/30.json") as RawBook,
	31: () => require("./data/lut1912/31.json") as RawBook,
	32: () => require("./data/lut1912/32.json") as RawBook,
	33: () => require("./data/lut1912/33.json") as RawBook,
	34: () => require("./data/lut1912/34.json") as RawBook,
	35: () => require("./data/lut1912/35.json") as RawBook,
	36: () => require("./data/lut1912/36.json") as RawBook,
	37: () => require("./data/lut1912/37.json") as RawBook,
	38: () => require("./data/lut1912/38.json") as RawBook,
	39: () => require("./data/lut1912/39.json") as RawBook,
	40: () => require("./data/lut1912/40.json") as RawBook,
	41: () => require("./data/lut1912/41.json") as RawBook,
	42: () => require("./data/lut1912/42.json") as RawBook,
	43: () => require("./data/lut1912/43.json") as RawBook,
	44: () => require("./data/lut1912/44.json") as RawBook,
	45: () => require("./data/lut1912/45.json") as RawBook,
	46: () => require("./data/lut1912/46.json") as RawBook,
	47: () => require("./data/lut1912/47.json") as RawBook,
	48: () => require("./data/lut1912/48.json") as RawBook,
	49: () => require("./data/lut1912/49.json") as RawBook,
	50: () => require("./data/lut1912/50.json") as RawBook,
	51: () => require("./data/lut1912/51.json") as RawBook,
	52: () => require("./data/lut1912/52.json") as RawBook,
	53: () => require("./data/lut1912/53.json") as RawBook,
	54: () => require("./data/lut1912/54.json") as RawBook,
	55: () => require("./data/lut1912/55.json") as RawBook,
	56: () => require("./data/lut1912/56.json") as RawBook,
	57: () => require("./data/lut1912/57.json") as RawBook,
	58: () => require("./data/lut1912/58.json") as RawBook,
	59: () => require("./data/lut1912/59.json") as RawBook,
	60: () => require("./data/lut1912/60.json") as RawBook,
	61: () => require("./data/lut1912/61.json") as RawBook,
	62: () => require("./data/lut1912/62.json") as RawBook,
	63: () => require("./data/lut1912/63.json") as RawBook,
	64: () => require("./data/lut1912/64.json") as RawBook,
	65: () => require("./data/lut1912/65.json") as RawBook,
	66: () => require("./data/lut1912/66.json") as RawBook,
};

const LOADERS: Record<BundledForeignBible, Record<number, () => RawBook>> = {
	RV1909: RV1909_LOADERS,
	LUT1912: LUT1912_LOADERS,
};

const bookCache = new Map<string, RawBook>();

function getBook(bible: BundledForeignBible, order: number): RawBook {
	const key = `${bible}:${order}`;
	const cached = bookCache.get(key);
	if (cached) return cached;
	const loader = LOADERS[bible][order];
	if (!loader) throw new Error(`Unknown book order: ${order}`);
	const book = loader();
	bookCache.set(key, book);
	return book;
}

/** All verses of a chapter, 1-indexed by chapter number. Throws when out of range. */
export function getForeignBibleChapter(bible: BundledForeignBible, order: number, chapter: number): string[] {
	const meta = bookByOrder(order);
	if (!meta || !Number.isInteger(chapter) || chapter < 1 || chapter > meta.chapters) {
		throw new Error(`Unknown chapter: book ${order}, chapter ${chapter}`);
	}
	const verses = getBook(bible, order)[chapter - 1];
	if (!verses) throw new Error(`Unknown chapter: book ${order}, chapter ${chapter}`);
	return verses;
}

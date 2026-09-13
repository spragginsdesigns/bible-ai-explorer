/** Generated publisher BSB data. Regenerate with scripts/bible/build-bsb.py. */
export interface FormattedVerse {
	number: number;
	text: string;
	headings: string[];
	paragraphStart: boolean;
	omitted?: boolean;
	segments: { text: string; italic: boolean; jesusSpeech: boolean }[];
}
type Book = FormattedVerse[][];

const cache = new Map<number, Book>();
const loaders: Record<number, () => Promise<Book>> = {
	1: async () => (await import("../../data/bsb/01.json")).default as Book,
	2: async () => (await import("../../data/bsb/02.json")).default as Book,
	3: async () => (await import("../../data/bsb/03.json")).default as Book,
	4: async () => (await import("../../data/bsb/04.json")).default as Book,
	5: async () => (await import("../../data/bsb/05.json")).default as Book,
	6: async () => (await import("../../data/bsb/06.json")).default as Book,
	7: async () => (await import("../../data/bsb/07.json")).default as Book,
	8: async () => (await import("../../data/bsb/08.json")).default as Book,
	9: async () => (await import("../../data/bsb/09.json")).default as Book,
	10: async () => (await import("../../data/bsb/10.json")).default as Book,
	11: async () => (await import("../../data/bsb/11.json")).default as Book,
	12: async () => (await import("../../data/bsb/12.json")).default as Book,
	13: async () => (await import("../../data/bsb/13.json")).default as Book,
	14: async () => (await import("../../data/bsb/14.json")).default as Book,
	15: async () => (await import("../../data/bsb/15.json")).default as Book,
	16: async () => (await import("../../data/bsb/16.json")).default as Book,
	17: async () => (await import("../../data/bsb/17.json")).default as Book,
	18: async () => (await import("../../data/bsb/18.json")).default as Book,
	19: async () => (await import("../../data/bsb/19.json")).default as Book,
	20: async () => (await import("../../data/bsb/20.json")).default as Book,
	21: async () => (await import("../../data/bsb/21.json")).default as Book,
	22: async () => (await import("../../data/bsb/22.json")).default as Book,
	23: async () => (await import("../../data/bsb/23.json")).default as Book,
	24: async () => (await import("../../data/bsb/24.json")).default as Book,
	25: async () => (await import("../../data/bsb/25.json")).default as Book,
	26: async () => (await import("../../data/bsb/26.json")).default as Book,
	27: async () => (await import("../../data/bsb/27.json")).default as Book,
	28: async () => (await import("../../data/bsb/28.json")).default as Book,
	29: async () => (await import("../../data/bsb/29.json")).default as Book,
	30: async () => (await import("../../data/bsb/30.json")).default as Book,
	31: async () => (await import("../../data/bsb/31.json")).default as Book,
	32: async () => (await import("../../data/bsb/32.json")).default as Book,
	33: async () => (await import("../../data/bsb/33.json")).default as Book,
	34: async () => (await import("../../data/bsb/34.json")).default as Book,
	35: async () => (await import("../../data/bsb/35.json")).default as Book,
	36: async () => (await import("../../data/bsb/36.json")).default as Book,
	37: async () => (await import("../../data/bsb/37.json")).default as Book,
	38: async () => (await import("../../data/bsb/38.json")).default as Book,
	39: async () => (await import("../../data/bsb/39.json")).default as Book,
	40: async () => (await import("../../data/bsb/40.json")).default as Book,
	41: async () => (await import("../../data/bsb/41.json")).default as Book,
	42: async () => (await import("../../data/bsb/42.json")).default as Book,
	43: async () => (await import("../../data/bsb/43.json")).default as Book,
	44: async () => (await import("../../data/bsb/44.json")).default as Book,
	45: async () => (await import("../../data/bsb/45.json")).default as Book,
	46: async () => (await import("../../data/bsb/46.json")).default as Book,
	47: async () => (await import("../../data/bsb/47.json")).default as Book,
	48: async () => (await import("../../data/bsb/48.json")).default as Book,
	49: async () => (await import("../../data/bsb/49.json")).default as Book,
	50: async () => (await import("../../data/bsb/50.json")).default as Book,
	51: async () => (await import("../../data/bsb/51.json")).default as Book,
	52: async () => (await import("../../data/bsb/52.json")).default as Book,
	53: async () => (await import("../../data/bsb/53.json")).default as Book,
	54: async () => (await import("../../data/bsb/54.json")).default as Book,
	55: async () => (await import("../../data/bsb/55.json")).default as Book,
	56: async () => (await import("../../data/bsb/56.json")).default as Book,
	57: async () => (await import("../../data/bsb/57.json")).default as Book,
	58: async () => (await import("../../data/bsb/58.json")).default as Book,
	59: async () => (await import("../../data/bsb/59.json")).default as Book,
	60: async () => (await import("../../data/bsb/60.json")).default as Book,
	61: async () => (await import("../../data/bsb/61.json")).default as Book,
	62: async () => (await import("../../data/bsb/62.json")).default as Book,
	63: async () => (await import("../../data/bsb/63.json")).default as Book,
	64: async () => (await import("../../data/bsb/64.json")).default as Book,
	65: async () => (await import("../../data/bsb/65.json")).default as Book,
	66: async () => (await import("../../data/bsb/66.json")).default as Book,
};
export async function loadBsbChapter(book: number, chapter: number): Promise<FormattedVerse[]> {
	if (!Number.isInteger(book) || !Number.isInteger(chapter) || chapter < 1 || !loaders[book])
		throw new Error("Invalid Bible reference");
	if (!cache.has(book)) cache.set(book, await loaders[book]());
	if (!cache.get(book)?.[chapter - 1]) throw new Error("Invalid Bible reference");
	return getBsbChapter(book, chapter);
}
/** Synchronous formatting access after loadBsbChapter has loaded this book. */
export function getBsbChapter(book: number, chapter: number): FormattedVerse[] {
	const verses = cache.get(book)?.[chapter - 1];
	return verses ?? [];
}

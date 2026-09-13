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

const loaders: Record<number, () => Book> = {
	1: () => require("./data/bsb/01.json") as Book,
	2: () => require("./data/bsb/02.json") as Book,
	3: () => require("./data/bsb/03.json") as Book,
	4: () => require("./data/bsb/04.json") as Book,
	5: () => require("./data/bsb/05.json") as Book,
	6: () => require("./data/bsb/06.json") as Book,
	7: () => require("./data/bsb/07.json") as Book,
	8: () => require("./data/bsb/08.json") as Book,
	9: () => require("./data/bsb/09.json") as Book,
	10: () => require("./data/bsb/10.json") as Book,
	11: () => require("./data/bsb/11.json") as Book,
	12: () => require("./data/bsb/12.json") as Book,
	13: () => require("./data/bsb/13.json") as Book,
	14: () => require("./data/bsb/14.json") as Book,
	15: () => require("./data/bsb/15.json") as Book,
	16: () => require("./data/bsb/16.json") as Book,
	17: () => require("./data/bsb/17.json") as Book,
	18: () => require("./data/bsb/18.json") as Book,
	19: () => require("./data/bsb/19.json") as Book,
	20: () => require("./data/bsb/20.json") as Book,
	21: () => require("./data/bsb/21.json") as Book,
	22: () => require("./data/bsb/22.json") as Book,
	23: () => require("./data/bsb/23.json") as Book,
	24: () => require("./data/bsb/24.json") as Book,
	25: () => require("./data/bsb/25.json") as Book,
	26: () => require("./data/bsb/26.json") as Book,
	27: () => require("./data/bsb/27.json") as Book,
	28: () => require("./data/bsb/28.json") as Book,
	29: () => require("./data/bsb/29.json") as Book,
	30: () => require("./data/bsb/30.json") as Book,
	31: () => require("./data/bsb/31.json") as Book,
	32: () => require("./data/bsb/32.json") as Book,
	33: () => require("./data/bsb/33.json") as Book,
	34: () => require("./data/bsb/34.json") as Book,
	35: () => require("./data/bsb/35.json") as Book,
	36: () => require("./data/bsb/36.json") as Book,
	37: () => require("./data/bsb/37.json") as Book,
	38: () => require("./data/bsb/38.json") as Book,
	39: () => require("./data/bsb/39.json") as Book,
	40: () => require("./data/bsb/40.json") as Book,
	41: () => require("./data/bsb/41.json") as Book,
	42: () => require("./data/bsb/42.json") as Book,
	43: () => require("./data/bsb/43.json") as Book,
	44: () => require("./data/bsb/44.json") as Book,
	45: () => require("./data/bsb/45.json") as Book,
	46: () => require("./data/bsb/46.json") as Book,
	47: () => require("./data/bsb/47.json") as Book,
	48: () => require("./data/bsb/48.json") as Book,
	49: () => require("./data/bsb/49.json") as Book,
	50: () => require("./data/bsb/50.json") as Book,
	51: () => require("./data/bsb/51.json") as Book,
	52: () => require("./data/bsb/52.json") as Book,
	53: () => require("./data/bsb/53.json") as Book,
	54: () => require("./data/bsb/54.json") as Book,
	55: () => require("./data/bsb/55.json") as Book,
	56: () => require("./data/bsb/56.json") as Book,
	57: () => require("./data/bsb/57.json") as Book,
	58: () => require("./data/bsb/58.json") as Book,
	59: () => require("./data/bsb/59.json") as Book,
	60: () => require("./data/bsb/60.json") as Book,
	61: () => require("./data/bsb/61.json") as Book,
	62: () => require("./data/bsb/62.json") as Book,
	63: () => require("./data/bsb/63.json") as Book,
	64: () => require("./data/bsb/64.json") as Book,
	65: () => require("./data/bsb/65.json") as Book,
	66: () => require("./data/bsb/66.json") as Book,
};
export function getBsbChapter(book: number, chapter: number): FormattedVerse[] {
	if (!Number.isInteger(book) || !Number.isInteger(chapter) || chapter < 1)
		throw new Error("Invalid Bible reference");
	const verses = loaders[book]?.()[chapter - 1];
	if (!verses) throw new Error("Invalid Bible reference");
	return verses;
}

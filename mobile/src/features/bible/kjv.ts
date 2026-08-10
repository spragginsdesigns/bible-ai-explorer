/**
 * Lazy access to the bundled KJV text (data/kjv/*.json, chapters → verses).
 * Metro needs literal require paths, so every book is listed by hand; a book's
 * JSON is only parsed on first access and then cached for the session.
 */
import { bookByOrder } from "./books";

type RawBook = string[][];

const LOADERS: Record<number, () => RawBook> = {
	1: () => require("./data/kjv/01-genesis.json") as RawBook,
	2: () => require("./data/kjv/02-exodus.json") as RawBook,
	3: () => require("./data/kjv/03-leviticus.json") as RawBook,
	4: () => require("./data/kjv/04-numbers.json") as RawBook,
	5: () => require("./data/kjv/05-deuteronomy.json") as RawBook,
	6: () => require("./data/kjv/06-joshua.json") as RawBook,
	7: () => require("./data/kjv/07-judges.json") as RawBook,
	8: () => require("./data/kjv/08-ruth.json") as RawBook,
	9: () => require("./data/kjv/09-1-samuel.json") as RawBook,
	10: () => require("./data/kjv/10-2-samuel.json") as RawBook,
	11: () => require("./data/kjv/11-1-kings.json") as RawBook,
	12: () => require("./data/kjv/12-2-kings.json") as RawBook,
	13: () => require("./data/kjv/13-1-chronicles.json") as RawBook,
	14: () => require("./data/kjv/14-2-chronicles.json") as RawBook,
	15: () => require("./data/kjv/15-ezra.json") as RawBook,
	16: () => require("./data/kjv/16-nehemiah.json") as RawBook,
	17: () => require("./data/kjv/17-esther.json") as RawBook,
	18: () => require("./data/kjv/18-job.json") as RawBook,
	19: () => require("./data/kjv/19-psalms.json") as RawBook,
	20: () => require("./data/kjv/20-proverbs.json") as RawBook,
	21: () => require("./data/kjv/21-ecclesiastes.json") as RawBook,
	22: () => require("./data/kjv/22-song-of-solomon.json") as RawBook,
	23: () => require("./data/kjv/23-isaiah.json") as RawBook,
	24: () => require("./data/kjv/24-jeremiah.json") as RawBook,
	25: () => require("./data/kjv/25-lamentations.json") as RawBook,
	26: () => require("./data/kjv/26-ezekiel.json") as RawBook,
	27: () => require("./data/kjv/27-daniel.json") as RawBook,
	28: () => require("./data/kjv/28-hosea.json") as RawBook,
	29: () => require("./data/kjv/29-joel.json") as RawBook,
	30: () => require("./data/kjv/30-amos.json") as RawBook,
	31: () => require("./data/kjv/31-obadiah.json") as RawBook,
	32: () => require("./data/kjv/32-jonah.json") as RawBook,
	33: () => require("./data/kjv/33-micah.json") as RawBook,
	34: () => require("./data/kjv/34-nahum.json") as RawBook,
	35: () => require("./data/kjv/35-habakkuk.json") as RawBook,
	36: () => require("./data/kjv/36-zephaniah.json") as RawBook,
	37: () => require("./data/kjv/37-haggai.json") as RawBook,
	38: () => require("./data/kjv/38-zechariah.json") as RawBook,
	39: () => require("./data/kjv/39-malachi.json") as RawBook,
	40: () => require("./data/kjv/40-matthew.json") as RawBook,
	41: () => require("./data/kjv/41-mark.json") as RawBook,
	42: () => require("./data/kjv/42-luke.json") as RawBook,
	43: () => require("./data/kjv/43-john.json") as RawBook,
	44: () => require("./data/kjv/44-acts.json") as RawBook,
	45: () => require("./data/kjv/45-romans.json") as RawBook,
	46: () => require("./data/kjv/46-1-corinthians.json") as RawBook,
	47: () => require("./data/kjv/47-2-corinthians.json") as RawBook,
	48: () => require("./data/kjv/48-galatians.json") as RawBook,
	49: () => require("./data/kjv/49-ephesians.json") as RawBook,
	50: () => require("./data/kjv/50-philippians.json") as RawBook,
	51: () => require("./data/kjv/51-colossians.json") as RawBook,
	52: () => require("./data/kjv/52-1-thessalonians.json") as RawBook,
	53: () => require("./data/kjv/53-2-thessalonians.json") as RawBook,
	54: () => require("./data/kjv/54-1-timothy.json") as RawBook,
	55: () => require("./data/kjv/55-2-timothy.json") as RawBook,
	56: () => require("./data/kjv/56-titus.json") as RawBook,
	57: () => require("./data/kjv/57-philemon.json") as RawBook,
	58: () => require("./data/kjv/58-hebrews.json") as RawBook,
	59: () => require("./data/kjv/59-james.json") as RawBook,
	60: () => require("./data/kjv/60-1-peter.json") as RawBook,
	61: () => require("./data/kjv/61-2-peter.json") as RawBook,
	62: () => require("./data/kjv/62-1-john.json") as RawBook,
	63: () => require("./data/kjv/63-2-john.json") as RawBook,
	64: () => require("./data/kjv/64-3-john.json") as RawBook,
	65: () => require("./data/kjv/65-jude.json") as RawBook,
	66: () => require("./data/kjv/66-revelation.json") as RawBook,
};

const bookCache = new Map<number, RawBook>();

function getKjvBook(order: number): RawBook {
	const cached = bookCache.get(order);
	if (cached) return cached;
	const loader = LOADERS[order];
	if (!loader) throw new Error(`Unknown book order: ${order}`);
	const book = loader();
	bookCache.set(order, book);
	return book;
}

/** All verses of a chapter, 1-indexed by chapter number. Throws when out of range. */
export function getKjvChapter(order: number, chapter: number): string[] {
	const meta = bookByOrder(order);
	if (!meta || chapter < 1 || chapter > meta.chapters) {
		throw new Error(`Unknown chapter: book ${order}, chapter ${chapter}`);
	}
	return getKjvBook(order)[chapter - 1];
}

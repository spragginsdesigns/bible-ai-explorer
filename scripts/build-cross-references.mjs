// Build src/data/crossrefs/*.json from the openbible.info cross-reference
// dataset (https://a.openbible.info/data/cross-references.zip, CC-BY).
//
//   node scripts/build-cross-references.mjs <path-to-cross_references.txt>
//
// Output: one JSON file per book, keyed "chapter:verse", each value the top
// cross-references by community votes as compact tuples:
//   [order, chapter, verse]                  single verse
//   [order, chapter, verse, endCh, endVerse] range
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MAX_REFS_PER_VERSE = 10;

const OSIS_TO_ORDER = {
	Gen: 1, Exod: 2, Lev: 3, Num: 4, Deut: 5, Josh: 6, Judg: 7, Ruth: 8,
	"1Sam": 9, "2Sam": 10, "1Kgs": 11, "2Kgs": 12, "1Chr": 13, "2Chr": 14,
	Ezra: 15, Neh: 16, Esth: 17, Job: 18, Ps: 19, Prov: 20, Eccl: 21,
	Song: 22, Isa: 23, Jer: 24, Lam: 25, Ezek: 26, Dan: 27, Hos: 28,
	Joel: 29, Amos: 30, Obad: 31, Jonah: 32, Mic: 33, Nah: 34, Hab: 35,
	Zeph: 36, Hag: 37, Zech: 38, Mal: 39, Matt: 40, Mark: 41, Luke: 42,
	John: 43, Acts: 44, Rom: 45, "1Cor": 46, "2Cor": 47, Gal: 48, Eph: 49,
	Phil: 50, Col: 51, "1Thess": 52, "2Thess": 53, "1Tim": 54, "2Tim": 55,
	Titus: 56, Phlm: 57, Heb: 58, Jas: 59, "1Pet": 60, "2Pet": 61,
	"1John": 62, "2John": 63, "3John": 64, Jude: 65, Rev: 66,
};

function parseOsisRef(ref) {
	// "Gen.1.1" or "Col.1.16-Col.1.17"
	const [fromPart, toPart] = ref.split("-");
	const from = fromPart.split(".");
	if (from.length !== 3) return null;
	const order = OSIS_TO_ORDER[from[0]];
	if (!order) return null;
	const chapter = +from[1];
	const verse = +from[2];
	if (!Number.isInteger(chapter) || !Number.isInteger(verse)) return null;
	if (!toPart) return { order, chapter, verse };
	const to = toPart.split(".");
	if (to.length !== 3 || OSIS_TO_ORDER[to[0]] !== order) {
		// Cross-book ranges (rare) fall back to their first verse.
		return { order, chapter, verse };
	}
	const endCh = +to[1];
	const endVerse = +to[2];
	if (endCh === chapter && endVerse === verse) return { order, chapter, verse };
	return { order, chapter, verse, endCh, endVerse };
}

const inputPath = process.argv[2];
if (!inputPath || !fs.existsSync(inputPath)) {
	console.error("Usage: node scripts/build-cross-references.mjs <cross_references.txt>");
	process.exit(1);
}

const books = JSON.parse(fs.readFileSync(path.join(root, "src/data/books.json"), "utf8"));
const fileByOrder = new Map(books.map((b) => [b.order, b.file]));

// order -> { "c:v": [{votes, tuple}] }
const perBook = new Map();
let rows = 0, kept = 0, skipped = 0;

const lines = fs.readFileSync(inputPath, "utf8").split(/\r?\n/);
for (const line of lines.slice(1)) {
	if (!line.trim()) continue;
	rows++;
	const [fromRef, toRef, votesStr] = line.split("\t");
	const votes = +votesStr;
	if (!fromRef || !toRef || !Number.isFinite(votes) || votes < 0) { skipped++; continue; }
	const from = parseOsisRef(fromRef);
	const to = parseOsisRef(toRef);
	if (!from || !to || from.endCh) { skipped++; continue; } // source must be a single verse
	const key = `${from.chapter}:${from.verse}`;
	let book = perBook.get(from.order);
	if (!book) perBook.set(from.order, (book = {}));
	(book[key] ??= []).push({
		votes,
		tuple: to.endCh
			? [to.order, to.chapter, to.verse, to.endCh, to.endVerse]
			: [to.order, to.chapter, to.verse],
	});
	kept++;
}

const outDir = path.join(root, "src/data/crossrefs");
fs.mkdirSync(outDir, { recursive: true });
let totalRefs = 0;
for (let order = 1; order <= 66; order++) {
	const book = perBook.get(order) ?? {};
	const compact = {};
	for (const [key, refs] of Object.entries(book)) {
		refs.sort((a, b) => b.votes - a.votes);
		compact[key] = refs.slice(0, MAX_REFS_PER_VERSE).map((r) => r.tuple);
		totalRefs += compact[key].length;
	}
	const file = fileByOrder.get(order);
	fs.writeFileSync(path.join(outDir, file), JSON.stringify(compact));
}
console.log(`rows=${rows} kept=${kept} skipped=${skipped} written=${totalRefs} refs across 66 files`);

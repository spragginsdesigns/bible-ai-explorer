// Build the bundled original-language data in src/data/originals/:
//
//   node scripts/build-original-languages.mjs
//
// Sources (all public domain or CC-BY, fetched from GitHub):
//   OT: Westminster Leningrad Codex with per-word Strong's numbers and
//       morphology - openscriptures/morphhb (OSHB, CC-BY 4.0)
//   NT: Scrivener 1894 Textus Receptus (the Greek text underlying the KJV)
//       with Strong's numbers and Robinson morphology -
//       byztxt/greektext-textus-receptus (public domain). Variant units
//       ("| stephanus | scrivener |") keep the LAST alternative, verified as
//       the Scrivener/KJV reading at Rev 16:5 (esomenov) and Matt 2:11 (eidon).
//   Dictionaries: Strong's Hebrew & Greek - openscriptures/strongs (CC-BY-SA)
//
// Output, mirroring the KJV corpus layout (chapters -> verses -> words):
//   src/data/originals/NN-book.json      [[["word","strongs","morph"],...],...]
//   src/data/originals/strongs-hebrew.json / strongs-greek.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, "src/data/originals");
fs.mkdirSync(outDir, { recursive: true });

const books = JSON.parse(fs.readFileSync(path.join(root, "src/data/books.json"), "utf8"));
const fileByOrder = new Map(books.map((b) => [b.order, b.file]));

async function fetchText(url) {
	for (let attempt = 1; attempt <= 3; attempt++) {
		try {
			const res = await fetch(url);
			if (!res.ok) throw new Error(`${res.status} for ${url}`);
			return await res.text();
		} catch (err) {
			if (attempt === 3) throw err;
			await new Promise((r) => setTimeout(r, 1500 * attempt));
		}
	}
}

// ---------------- Hebrew OT (WLC / OSHB) ----------------

// OSIS book name -> canonical order 1..39
const WLC_BOOKS = [
	"Gen", "Exod", "Lev", "Num", "Deut", "Josh", "Judg", "Ruth", "1Sam", "2Sam",
	"1Kgs", "2Kgs", "1Chr", "2Chr", "Ezra", "Neh", "Esth", "Job", "Ps", "Prov",
	"Eccl", "Song", "Isa", "Jer", "Lam", "Ezek", "Dan", "Hos", "Joel", "Amos",
	"Obad", "Jonah", "Mic", "Nah", "Hab", "Zeph", "Hag", "Zech", "Mal",
];

/** "c/1961", "d/8199 b", "1254 a" -> "H1961" / "H8199" / "H1254" */
function hebrewStrongs(lemma) {
	const last = lemma.split("/").pop() ?? "";
	const digits = last.match(/\d+/);
	return digits ? `H${digits[0]}` : "";
}

function parseWlcBook(xml) {
	const chapters = [];
	const verseRegex = /<verse osisID="[^".]+\.(\d+)\.(\d+)">([\s\S]*?)<\/verse>/g;
	let verseMatch;
	while ((verseMatch = verseRegex.exec(xml)) !== null) {
		const chapter = +verseMatch[1];
		const verse = +verseMatch[2];
		// Strip <note> elements first: variant notes carry qere readings as real
		// <w> elements, which would otherwise be swept in as duplicate words.
		const body = verseMatch[3].replace(/<note[\s\S]*?<\/note>/g, "");
		const words = [];
		const wordRegex = /<w ([^>]*)>([\s\S]*?)<\/w>/g;
		let wordMatch;
		while ((wordMatch = wordRegex.exec(body)) !== null) {
			const attrs = wordMatch[1];
			const lemma = attrs.match(/lemma="([^"]*)"/)?.[1] ?? "";
			const morph = attrs.match(/morph="([^"]*)"/)?.[1] ?? "";
			// Word text may contain <seg> markers (e.g. maqqef alternatives);
			// strip tags and the intra-word morpheme slashes.
			const text = wordMatch[2].replace(/<[^>]+>/g, "").replace(/\//g, "").trim();
			if (!text) continue;
			words.push([text, hebrewStrongs(lemma), morph]);
		}
		if (words.length === 0) continue;
		while (chapters.length < chapter) chapters.push([]);
		const verses = chapters[chapter - 1];
		while (verses.length < verse) verses.push([]);
		verses[verse - 1] = words;
	}
	return chapters;
}

// ---------------- Greek NT (Scrivener 1894 TR) ----------------

// UTR file code -> canonical order 40..66
const TR_BOOKS = [
	["MT", 40], ["MR", 41], ["LU", 42], ["JOH", 43], ["AC", 44], ["RO", 45],
	["1CO", 46], ["2CO", 47], ["GA", 48], ["EPH", 49], ["PHP", 50], ["COL", 51],
	["1TH", 52], ["2TH", 53], ["1TI", 54], ["2TI", 55], ["TIT", 56], ["PHM", 57],
	["HEB", 58], ["JAS", 59], ["1PE", 60], ["2PE", 61], ["1JO", 62], ["2JO", 63],
	["3JO", 64], ["JUDE", 65], ["RE", 66],
];

// Online-Bible-style transliteration used by the UTR files.
const BETA = {
	a: "α", b: "β", g: "γ", d: "δ", e: "ε", z: "ζ", h: "η", q: "θ", i: "ι",
	k: "κ", l: "λ", m: "μ", n: "ν", x: "ξ", o: "ο", p: "π", r: "ρ", s: "σ",
	t: "τ", u: "υ", f: "φ", c: "χ", y: "ψ", w: "ω", v: "ς",
};
function betaToGreek(word) {
	let out = "";
	for (const ch of word) out += BETA[ch] ?? ch;
	// A non-final sigma at word end (some tokens use "s") becomes final sigma.
	return out.replace(/σ$/, "ς");
}

/**
 * Parse one UTR book. Line format: "c:v token token ..." with continuation
 * lines indented; tokens are a word, its Strong's number, optionally a
 * tense-voice-mood number, and a {MORPH} tag. Variant units are delimited by
 * three pipes: "| stephanus-reading | scrivener-reading |" - keep the last.
 * Bracketed [book titles] are ignored.
 */
function parseTrBook(raw) {
	const logical = [];
	for (const line of raw.split(/\r?\n/)) {
		if (!line.trim()) continue;
		if (/^\d+:\d+/.test(line)) logical.push(line.trim());
		else if (logical.length > 0) logical[logical.length - 1] += ` ${line.trim()}`;
	}

	const chapters = [];
	for (const line of logical) {
		const match = line.match(/^(\d+):(\d+)\s+(.*)$/);
		if (!match) continue;
		const chapter = +match[1];
		const verse = +match[2];
		const body = match[3].replace(/\[[^\]]*\]/g, "");

		// Resolve variant units: keep the final (Scrivener) alternative.
		const resolved = body.replace(/\|([^|]*)\|([^|]*)\|/g, (_, _stephanus, scrivener) => ` ${scrivener} `);

		const tokens = resolved.split(/\s+/).filter(Boolean);
		const words = [];
		let current = null;
		for (const token of tokens) {
			if (/^\{.*\}$/.test(token)) {
				if (current) current[2] = token.slice(1, -1);
				continue;
			}
			if (/^\d+$/.test(token)) {
				// First number after a word is its Strong's; later ones (TVM) are dropped.
				if (current && current[1] === "") current[1] = `G${+token}`;
				continue;
			}
			if (/^[a-z']+$/.test(token)) {
				current = [betaToGreek(token), "", ""];
				words.push(current);
			}
		}
		if (words.length === 0) continue;
		while (chapters.length < chapter) chapters.push([]);
		const verses = chapters[chapter - 1];
		while (verses.length < verse) verses.push([]);
		verses[verse - 1] = words;
	}
	return chapters;
}

// ---------------- Strong's dictionaries ----------------

function parseStrongsJs(js) {
	// Files are "var name = { ... };" possibly followed by module.exports.
	const start = js.indexOf("{");
	let end = js.lastIndexOf("};");
	if (start < 0 || end < 0) throw new Error("Unexpected dictionary format");
	const object = js.slice(start, end + 1);
	return (0, eval)(`(${object})`);
}

function compactDictionary(raw) {
	const out = {};
	for (const [key, entry] of Object.entries(raw)) {
		out[key] = {
			lemma: entry.lemma ?? "",
			translit: entry.translit ?? entry.xlit ?? "",
			def: (entry.strongs_def ?? "").trim().slice(0, 320),
			kjv: (entry.kjv_def ?? "").trim().replace(/^:?\s*/, "").slice(0, 240),
		};
	}
	return out;
}

// ---------------- main ----------------

const RAW_WLC = "https://raw.githubusercontent.com/openscriptures/morphhb/master/wlc";
const RAW_TR = "https://raw.githubusercontent.com/byztxt/greektext-textus-receptus/master/parsed";
const RAW_STRONGS = "https://raw.githubusercontent.com/openscriptures/strongs/master";

let totalWords = 0;
for (let i = 0; i < WLC_BOOKS.length; i++) {
	const order = i + 1;
	const xml = await fetchText(`${RAW_WLC}/${WLC_BOOKS[i]}.xml`);
	const chapters = parseWlcBook(xml);
	const words = chapters.flat(2).length;
	totalWords += words;
	fs.writeFileSync(path.join(outDir, fileByOrder.get(order)), JSON.stringify(chapters));
	console.log(`OT ${WLC_BOOKS[i]}: ${chapters.length} chapters, ${words} words`);
}

for (const [code, order] of TR_BOOKS) {
	const raw = await fetchText(`${RAW_TR}/${code}.UTR`);
	const chapters = parseTrBook(raw);
	const words = chapters.flat(2).length;
	totalWords += words;
	fs.writeFileSync(path.join(outDir, fileByOrder.get(order)), JSON.stringify(chapters));
	console.log(`NT ${code}: ${chapters.length} chapters, ${words} words`);
}

const hebrewDict = compactDictionary(parseStrongsJs(await fetchText(`${RAW_STRONGS}/hebrew/strongs-hebrew-dictionary.js`)));
const greekDict = compactDictionary(parseStrongsJs(await fetchText(`${RAW_STRONGS}/greek/strongs-greek-dictionary.js`)));
fs.writeFileSync(path.join(outDir, "strongs-hebrew.json"), JSON.stringify(hebrewDict));
fs.writeFileSync(path.join(outDir, "strongs-greek.json"), JSON.stringify(greekDict));
console.log(`Dictionaries: ${Object.keys(hebrewDict).length} Hebrew, ${Object.keys(greekDict).length} Greek entries`);
console.log(`Total words: ${totalWords}`);

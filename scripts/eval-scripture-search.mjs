// Eval harness for searchScripture retrieval quality, run against the REAL
// Neon pgvector verse embeddings and OpenAI embedding API.
//
//   node scripts/eval-scripture-search.mjs
//
// Compares retrieval strategies on a labeled query set and reports hit rate /
// MRR per category, plus the similarity distribution of relevant vs
// irrelevant results (to choose an evidence-based similarity floor).
// Read-only against the database; costs a few cents of embeddings.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// ---- env: parse .env.local explicitly and OVERRIDE inherited values ----
const envFile = fs.readFileSync(path.join(root, ".env.local"), "utf8");
for (const line of envFile.split(/\r?\n/)) {
	const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"#]*)"?\s*$/);
	if (match) process.env[match[1]] = match[2].trim();
}
const { OPENAI_API_KEY, DATABASE_URL_UNPOOLED } = process.env;
if (!OPENAI_API_KEY || !DATABASE_URL_UNPOOLED) {
	console.error("Missing OPENAI_API_KEY / DATABASE_URL_UNPOOLED in .env.local");
	process.exit(1);
}

// ---- bundled KJV corpus ----
const books = JSON.parse(fs.readFileSync(path.join(root, "src/data/books.json"), "utf8"));
const bookNameByOrder = new Map(books.map((b) => [b.order, b.name]));
const orderByBookName = new Map(books.map((b) => [b.name.toLowerCase(), b.order]));
/** order -> chapters -> verses (all lowercased for matching) */
const kjv = new Map(
	books.map((b) => [
		b.order,
		JSON.parse(fs.readFileSync(path.join(root, "src/data/kjv", b.file), "utf8")),
	])
);

// ---- labeled query set ----
// expected: list of "Book c:v" or "Book c:v-v2" (any hit inside counts).
const QUERIES = [
	// Half-remembered wording
	{ cat: "phrase", query: "be still and know that I am God", expected: ["Psalms 46:10"] },
	{ cat: "phrase", query: "no weapon formed against me shall prosper", expected: ["Isaiah 54:17"] },
	{ cat: "phrase", query: "I can do all things through Christ", expected: ["Philippians 4:13"] },
	{ cat: "phrase", query: "train up a child in the way he should go", expected: ["Proverbs 22:6"] },
	{ cat: "phrase", query: "faith is the substance of things hoped for", expected: ["Hebrews 11:1"] },
	{ cat: "phrase", query: "the fool says in his heart there is no God", expected: ["Psalms 14:1", "Psalms 53:1"] },
	{ cat: "phrase", query: "the wages of sin is death", expected: ["Romans 6:23"] },
	{ cat: "phrase", query: "all things work together for good", expected: ["Romans 8:28"] },
	// Doctrine
	{ cat: "doctrine", query: "salvation by grace through faith not of works", expected: ["Ephesians 2:8-9"] },
	{ cat: "doctrine", query: "justification by faith without the deeds of the law", expected: ["Romans 3:28", "Romans 5:1", "Galatians 2:16"] },
	{ cat: "doctrine", query: "the deity of Christ, Jesus is God", expected: ["John 1:1", "Colossians 2:9", "Titus 2:13", "John 10:30", "John 20:28", "1 Timothy 3:16"] },
	{ cat: "doctrine", query: "the Trinity, Father Son and Holy Ghost are one", expected: ["1 John 5:7", "Matthew 28:19", "2 Corinthians 13:14"] },
	{ cat: "doctrine", query: "repentance required for salvation", expected: ["Luke 13:3", "Acts 3:19", "Acts 17:30", "2 Peter 3:9"] },
	{ cat: "doctrine", query: "assurance that a believer has eternal life", expected: ["1 John 5:13", "John 10:28-29", "Romans 8:38-39"] },
	{ cat: "doctrine", query: "all scripture is inspired by God", expected: ["2 Timothy 3:16"] },
	{ cat: "doctrine", query: "you must be born again to see the kingdom", expected: ["John 3:3-7", "1 Peter 1:23"] },
	// Life application
	{ cat: "application", query: "comfort for someone grieving the death of a loved one", expected: ["Psalms 34:18", "Matthew 5:4", "1 Thessalonians 4:13-18", "Revelation 21:4", "Psalms 147:3", "2 Corinthians 1:3-4"] },
	{ cat: "application", query: "help with anxiety and worry", expected: ["Philippians 4:6-7", "Matthew 6:25-34", "1 Peter 5:7", "Isaiah 41:10", "John 14:27"] },
	{ cat: "application", query: "how parents should raise and teach their children", expected: ["Ephesians 6:4", "Proverbs 22:6", "Deuteronomy 6:6-7", "Proverbs 29:17", "Colossians 3:21"] },
	{ cat: "application", query: "forgiving people who wronged you", expected: ["Matthew 6:14-15", "Ephesians 4:32", "Colossians 3:13", "Matthew 18:21-22", "Mark 11:25"] },
	{ cat: "application", query: "how God speaks to us today", expected: ["Hebrews 1:1-2", "Psalms 119:105", "2 Timothy 3:16", "John 10:27", "Romans 10:17"] },
	{ cat: "application", query: "does God hear our prayers", expected: ["1 John 5:14-15", "Jeremiah 33:3", "Psalms 34:17", "Matthew 7:7-11", "James 5:16", "1 Peter 3:12"] },
	// Narrative recall
	{ cat: "narrative", query: "Elijah and the still small voice", expected: ["1 Kings 19:11-12"] },
	{ cat: "narrative", query: "Jesus walking on the water", expected: ["Matthew 14:25-29", "Mark 6:48-49", "John 6:19"] },
	{ cat: "narrative", query: "David defeats Goliath with a sling and a stone", expected: ["1 Samuel 17:49-50"] },
	{ cat: "narrative", query: "Saul's conversion on the road to Damascus", expected: ["Acts 9:3-6", "Acts 22:6-8", "Acts 26:13-15"] },
	{ cat: "narrative", query: "Daniel in the lions' den", expected: ["Daniel 6:16-23"] },
	{ cat: "narrative", query: "the prodigal son returns to his father", expected: ["Luke 15:11-24"] },
];

// ---- expected-reference parsing ----
function parseRef(ref) {
	const match = ref.match(/^(.+?) (\d+):(\d+)(?:-(\d+))?$/);
	if (!match) throw new Error(`Bad expected ref: ${ref}`);
	const order = orderByBookName.get(match[1].toLowerCase());
	if (!order) throw new Error(`Unknown book in expected ref: ${ref}`);
	return { order, chapter: +match[2], from: +match[3], to: +(match[4] ?? match[3]) };
}
function isHit(expectedList, order, chapter, verse) {
	return expectedList.some(
		(e) => e.order === order && e.chapter === chapter && verse >= e.from && verse <= e.to
	);
}

// ---- OpenAI embeddings (batched) ----
async function embedAll(texts) {
	const res = await fetch("https://api.openai.com/v1/embeddings", {
		method: "POST",
		headers: { "content-type": "application/json", authorization: `Bearer ${OPENAI_API_KEY}` },
		body: JSON.stringify({ model: "text-embedding-3-large", input: texts }),
	});
	if (!res.ok) throw new Error(`OpenAI embeddings ${res.status}: ${await res.text()}`);
	const json = await res.json();
	return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

// ---- Neon pgvector search (same store the app uses) ----
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient({
	datasources: { db: { url: process.env.DATABASE_URL_UNPOOLED } },
});

async function vectorFind(vector, limit) {
	const rows = await prisma.$queryRawUnsafe(
		`SELECT "book","chapter","verse", 1 - ("embedding" <=> $1::halfvec(3072)) AS similarity
		 FROM "VerseEmbedding" ORDER BY "embedding" <=> $1::halfvec(3072) LIMIT ${limit}`,
		`[${vector.join(",")}]`
	);
	return rows.map((r) => ({
		order: r.book, chapter: r.chapter, verse: r.verse, similarity: Number(r.similarity) || 0,
	}));
}

// ---- keyword scorer (BM25-lite over the bundled KJV) ----
const STOPWORDS = new Set(
	"a an and are as at be but by for from has have he her his i in is it its me my of on or our shall she that the their them they this to unto us was we what when who will with you your thou thee thy ye him verse verses bible say says said about does".split(" ")
);
function tokenize(text) {
	return text.toLowerCase().replace(/[^a-z']+/g, " ").split(/\s+/).filter((t) => t && !STOPWORDS.has(t));
}
// document frequency of each query token across the KJV, computed on demand
function keywordSearch(query, limit) {
	const tokens = [...new Set(tokenize(query))];
	if (tokens.length === 0) return [];
	const df = new Map(tokens.map((t) => [t, 0]));
	const verseTokenSets = [];
	for (const [order, chapters] of kjv) {
		for (let ci = 0; ci < chapters.length; ci++) {
			for (let vi = 0; vi < chapters[ci].length; vi++) {
				const text = chapters[ci][vi].toLowerCase();
				let matched = null;
				for (const t of tokens) {
					if (text.includes(t)) {
						df.set(t, df.get(t) + 1);
						(matched ??= []).push(t);
					}
				}
				if (matched && matched.length >= Math.min(2, tokens.length)) {
					verseTokenSets.push({ order, chapter: ci + 1, verse: vi + 1, matched });
				}
			}
		}
	}
	const N = 31102;
	const scored = verseTokenSets.map((v) => ({
		...v,
		score: v.matched.reduce((s, t) => s + Math.log(N / Math.max(1, df.get(t))), 0),
	}));
	scored.sort((a, b) => b.score - a.score);
	return scored.slice(0, limit);
}

// ---- strategies ----
function dedupeMerge(primary, secondary, limit) {
	const seen = new Set();
	const out = [];
	for (const hit of [...primary, ...secondary]) {
		const key = `${hit.order}:${hit.chapter}:${hit.verse}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(hit);
		if (out.length >= limit) break;
	}
	return out;
}

// ---- metrics ----
function evaluate(results, expectedList) {
	let firstHitRank = 0;
	results.forEach((r, i) => {
		if (!firstHitRank && isHit(expectedList, r.order, r.chapter, r.verse)) firstHitRank = i + 1;
	});
	return firstHitRank;
}

async function main() {
	const expectedParsed = QUERIES.map((q) => q.expected.map(parseRef));
	console.log(`Embedding ${QUERIES.length} queries...`);
	const vectors = await embedAll(QUERIES.map((q) => q.query));

	console.log("Running vector searches (k=10)...");
	const vectorResults = [];
	for (let i = 0; i < QUERIES.length; i++) {
		vectorResults.push(await vectorFind(vectors[i], 10));
		process.stdout.write(".");
	}
	console.log("\nRunning keyword searches...");
	const keywordResults = QUERIES.map((q) => keywordSearch(q.query, 10));

	const strategies = {
		"vector k=5": (i) => vectorResults[i].slice(0, 5),
		"vector k=10": (i) => vectorResults[i],
		"keyword k=5": (i) => keywordResults[i].slice(0, 5),
		"hybrid kw2+vec k=5": (i) => dedupeMerge(keywordResults[i].slice(0, 2), vectorResults[i], 5),
		"hybrid vec+kw k=8": (i) => dedupeMerge(vectorResults[i].slice(0, 5), keywordResults[i], 8),
		"hybrid kw3+vec k=8": (i) => dedupeMerge(keywordResults[i].slice(0, 3), vectorResults[i], 8),
	};

	const cats = [...new Set(QUERIES.map((q) => q.cat))];
	console.log("\n=== Hit rate (any expected verse retrieved) & MRR ===");
	for (const [name, pick] of Object.entries(strategies)) {
		const perCat = Object.fromEntries(cats.map((c) => [c, { hits: 0, n: 0, rr: 0 }]));
		let hits = 0, rr = 0;
		const misses = [];
		for (let i = 0; i < QUERIES.length; i++) {
			const rank = evaluate(pick(i), expectedParsed[i]);
			const c = perCat[QUERIES[i].cat];
			c.n++;
			if (rank) { hits++; c.hits++; rr += 1 / rank; c.rr += 1 / rank; }
			else misses.push(QUERIES[i].query);
		}
		const catStr = cats.map((c) => `${c} ${perCat[c].hits}/${perCat[c].n}`).join("  ");
		console.log(`\n${name}: ${hits}/${QUERIES.length} hit, MRR ${(rr / QUERIES.length).toFixed(3)}`);
		console.log(`  ${catStr}`);
		if (misses.length) console.log(`  misses: ${misses.join(" | ")}`);
	}

	// Similarity distributions for floor selection (vector k=10)
	const relSims = [], irrSims = [];
	for (let i = 0; i < QUERIES.length; i++) {
		for (const r of vectorResults[i]) {
			(isHit(expectedParsed[i], r.order, r.chapter, r.verse) ? relSims : irrSims).push(r.similarity);
		}
	}
	const stats = (arr) => {
		if (!arr.length) return "n=0";
		const sorted = [...arr].sort((a, b) => a - b);
		const q = (p) => sorted[Math.floor(p * (sorted.length - 1))];
		return `n=${arr.length} min=${q(0).toFixed(3)} p25=${q(0.25).toFixed(3)} med=${q(0.5).toFixed(3)} p75=${q(0.75).toFixed(3)} max=${q(1).toFixed(3)}`;
	};
	console.log("\n=== Similarity distribution (vector k=10) ===");
	console.log(`relevant:   ${stats(relSims)}`);
	console.log(`irrelevant: ${stats(irrSims)}`);

	// Show a couple of raw result sets for qualitative review
	console.log("\n=== Samples ===");
	for (const i of [4, 17, 21]) {
		console.log(`\nQ: ${QUERIES[i].query}`);
		for (const r of vectorResults[i].slice(0, 5)) {
			const name = bookNameByOrder.get(r.order);
			const text = kjv.get(r.order)[r.chapter - 1][r.verse - 1];
			console.log(`  ${r.similarity.toFixed(3)} ${name} ${r.chapter}:${r.verse} ${text.slice(0, 80)}`);
		}
	}
}

main().then(() => prisma.$disconnect()).catch((err) => { console.error(err); process.exit(1); });

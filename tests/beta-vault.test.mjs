/**
 * Knowledge Vault (LC-17645, docs/beta/vault.md): the pure rules every vault
 * read, search, answer and export goes through, plus the source contracts the
 * module's routes and page must keep.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
	VAULT_KINDS,
	checkAnswerPoints,
	cleanUncovered,
	excerptAround,
	filterRange,
	fuseRankings,
	isVaultKind,
	keysForReferences,
	orTsQuery,
	parseTimeWindow,
	parseVaultFilters,
	parseVaultKey,
	passageChips,
	passageLabels,
	pickResume,
	plainMarkdown,
	questionTerms,
	refsTouch,
	scanPassageKeys,
	stripCitationMarks,
	vaultMarkdown,
} from "../src/lib/beta/vault/vault-rules.ts";
import { BETA_MODULES } from "../src/lib/beta/modules.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(join(repoRoot, relativePath), "utf8");

// A resolver like src/lib/bible/books.ts resolveReference: names and abbreviations, chapter bounds.
const BOOKS = JSON.parse(read("src/data/books.json"));
const NAMES = new Map();
for (const book of BOOKS) {
	NAMES.set(book.name.toLowerCase(), book);
	NAMES.set(book.abbr.toLowerCase(), book);
}
NAMES.set("psalm", BOOKS.find((b) => b.name === "Psalms"));
NAMES.set("jn", BOOKS.find((b) => b.name === "John"));
function resolve(input) {
	const match = /^(.+?)\s+(\d+)(?::(\d+))?$/.exec(input.trim());
	if (!match) return null;
	const book = NAMES.get(match[1].toLowerCase().replace(/\s+/g, " "));
	const chapter = Number(match[2]);
	if (!book || chapter < 1 || chapter > book.chapters) return null;
	return match[3] === undefined ? { order: book.order, chapter } : { order: book.order, chapter, verse: Number(match[3]) };
}
const bookName = (order) => BOOKS.find((b) => b.order === order)?.name ?? null;

test("passages are found in prose: verses, chapters, ranges, numbered books and 'of' names", () => {
	assert.deepEqual(scanPassageKeys("For God so loved the world (John 3:16).", resolve), ["43.3", "43.3.16"]);
	assert.deepEqual(scanPassageKeys("Romans 8:28-30 and then Romans 9", resolve), ["45.8", "45.8.28", "45.8.29", "45.8.30", "45.9"]);
	assert.deepEqual(scanPassageKeys("1 John 4:8 says God is love", resolve), ["62.4", "62.4.8"]);
	assert.deepEqual(scanPassageKeys("Song of Solomon 2:4", resolve), ["22.2", "22.2.4"]);
	assert.deepEqual(scanPassageKeys("the Gospel of John 3:16", resolve), ["43.3", "43.3.16"], "'Gospel of John' falls back to John");
	assert.deepEqual(scanPassageKeys("compare Psalm 23 with Ps 91:1", resolve), ["19.23", "19.91", "19.91.1"]);
	assert.deepEqual(scanPassageKeys("john 3:16 typed in lowercase", resolve), ["43.3", "43.3.16"], "a verse makes any case a reference");
});

test("a verse followed by its own colon is still that verse (notes write 'Romans 8:15: ye have')", () => {
	assert.deepEqual(scanPassageKeys("Romans 8:15: ye have received the Spirit of adoption. Galatians 4:6 says the same.", resolve), ["45.8", "45.8.15", "48.4", "48.4.6"]);
	assert.deepEqual(scanPassageKeys("Romans 8: no condemnation", resolve), ["45.8"], "a chapter and a colon is the chapter");
	assert.deepEqual(scanPassageKeys("Romans 8:28-30: all things", resolve), ["45.8", "45.8.28", "45.8.29", "45.8.30"]);
	const adoption = scanPassageKeys("Romans 8:15: ye have received the Spirit of adoption. For now Romans 8 is about our status.", resolve);
	assert.equal(refsTouch(adoption, "45.8.28"), false, "a note on 8:15 that also names the chapter is not about 8:28");
});

test("prose that only looks like a passage is not one", () => {
	assert.deepEqual(scanPassageKeys("see chapter 3 and page 12", resolve), []);
	assert.deepEqual(scanPassageKeys("in 2 days at 3:15 pm", resolve), []);
	assert.deepEqual(scanPassageKeys("john 3 without a verse is not trusted lowercase", resolve), []);
	assert.deepEqual(scanPassageKeys("Romans 99", resolve), [], "the resolver bounds chapters");
	assert.deepEqual(scanPassageKeys("", resolve), []);
	assert.deepEqual(scanPassageKeys("Genesis 1:1-2:3", resolve), ["1.1", "1.1.1"], "a cross-chapter range keeps its start");
});

test("structured references from chat answers become keys", () => {
	assert.deepEqual(keysForReferences(["John 14:26", "Acts 2:4", "Nonsense 1:1"], resolve), ["43.14", "43.14.26", "44.2", "44.2.4"]);
});

test("a passage filter matches by book, chapter or verse, and a chapter mention covers its verses", () => {
	const note = ["45.8"]; // "Romans 8"
	const verse = ["45.8", "45.8.28"]; // "Romans 8:28"
	assert.equal(refsTouch(note, "45"), true);
	assert.equal(refsTouch(note, "45.8"), true);
	assert.equal(refsTouch(note, "45.8.28"), true, "a whole-chapter mention covers 8:28");
	assert.equal(refsTouch(verse, "45.8.28"), true);
	assert.equal(refsTouch(verse, "45.8.1"), false, "a note on 8:28 is not about 8:1");
	assert.equal(refsTouch(verse, "45.9"), false);
	assert.equal(refsTouch(note, "4"), false, "book 4 is not book 45");
	assert.equal(refsTouch(note, "nonsense"), false);
	assert.equal(parseVaultKey("67.1"), null);
	assert.deepEqual(parseVaultKey("45"), { book: 45, chapter: undefined, verse: undefined });
});

test("passage labels collapse verse runs and keep Bible order", () => {
	assert.deepEqual(passageLabels(["45.8", "45.8.28", "45.8.29", "45.8.30", "45.8.32", "43.3"], bookName), ["John 3", "Romans 8:28-30, 32"]);
	assert.deepEqual(passageLabels(["1.1", "2.1", "3.1"], bookName, 2), ["Genesis 1", "Exodus 1", "+1 more"]);
});

test("a passage chip taps to something that reads back as one reference", () => {
	assert.deepEqual(passageChips(["45.8", "45.8.28", "45.8.29", "45.8.30", "45.8.32", "43.3", "43.14", "43.14.26"], bookName), [
		{ label: "John 3", filter: "John 3" },
		{ label: "John 14:26", filter: "John 14:26" },
		{ label: "Romans 8:28-30, 32", filter: "Romans 8" },
	]);
	const many = passageChips(["1.1", "2.1", "3.1"], bookName, 2);
	assert.deepEqual(many[2], { label: "+1 more", filter: null });
	for (const chip of passageChips(["45.8", "45.8.28", "45.8.29", "19.119", "19.119.105"], bookName)) {
		assert.ok(chip.filter && resolve(chip.filter), `${chip.label} -> ${chip.filter} must resolve`);
	}
});

test("filters are parsed, cleaned and clamped; bad values are dropped, not trusted", () => {
	const params = new URLSearchParams({ q: "  holy   spirit ", kind: "note,chat,bogus,note", from: "2026-04-01", to: "2026-13-40", passage: " John 3 ", topic: "Grace", limit: "999", before: "not a date" });
	const filters = parseVaultFilters((name) => params.get(name));
	assert.deepEqual(filters, { q: "holy spirit", kinds: ["note", "chat"], from: "2026-04-01", to: null, passage: "John 3", topic: "grace", before: null, limit: 60 });
	const empty = parseVaultFilters(() => null);
	assert.equal(empty.q, "");
	assert.deepEqual(empty.kinds, []);
	assert.equal(empty.limit, 30);
	assert.equal(parseVaultFilters((n) => (n === "q" ? "x".repeat(500) : null)).q.length, 200);
	assert.equal(isVaultKind("chat"), true);
	assert.equal(isVaultKind("__proto__"), false);
	assert.equal(VAULT_KINDS.length, 8);
});

const inRange = (iso, range) => {
	const t = new Date(iso).getTime();
	return (!range.since || t >= range.since.getTime()) && (!range.until || t <= range.until.getTime());
};

test("a date range covers whole days and the page cursor", () => {
	const range = filterRange({ from: "2026-04-01", to: "2026-04-30", before: null });
	assert.equal(inRange("2026-04-01T00:00:00Z", range), true);
	assert.equal(inRange("2026-04-30T23:59:59Z", range), true);
	assert.equal(inRange("2026-05-01T00:00:00Z", range), false);
	assert.equal(inRange("2026-03-31T23:59:59Z", range), false);
	const paged = filterRange({ from: null, to: null, before: "2026-04-10T12:00:00.000Z" });
	assert.equal(inRange("2026-04-10T12:00:00.000Z", paged), false, "the cursor itself was on the last page");
	assert.equal(inRange("2026-04-10T11:59:59.000Z", paged), true);
});

test("a question's subject words, with the question, time and study words removed", () => {
	assert.deepEqual(questionTerms("What have I studied about the Holy Spirit over the last six months?"), ["holy", "spirit"]);
	assert.deepEqual(questionTerms("How has my understanding of justification by faith grown?"), ["understanding", "justification", "faith", "grown"]);
	assert.deepEqual(questionTerms("What did I study last month?"), []);
	assert.deepEqual(questionTerms("What have I learned about grace since March?"), ["grace"], "a month the period already names is no search word");
	assert.equal(orTsQuery(["holy", "spirit"]), "holy:* | spirit:*");
	assert.equal(orTsQuery([]), null);
	assert.equal(orTsQuery(["a'b", "c|d"]), "ab:* | cd:*", "only letters and digits reach to_tsquery");
});

test("the period a question names", () => {
	const now = new Date("2026-10-26T12:00:00Z");
	const six = parseTimeWindow("What have I studied about the Holy Spirit over the last six months?", now);
	assert.equal(six.label, "the last 6 months");
	assert.equal(Math.round((now - six.since) / 86_400_000), 183);
	assert.equal(six.until, null);
	assert.equal(parseTimeWindow("past 3 weeks", now).label, "the last 3 weeks");
	assert.equal(parseTimeWindow("in the last year", now).label, "the last year");
	assert.equal(parseTimeWindow("this year", now).since.toISOString(), "2026-01-01T00:00:00.000Z");
	assert.equal(parseTimeWindow("since March", now).since.toISOString(), "2026-03-01T00:00:00.000Z");
	assert.equal(parseTimeWindow("since November", now).since.toISOString(), "2025-11-01T00:00:00.000Z", "a month still ahead means last year's");
	const y = parseTimeWindow("what did I study in 2025", now);
	assert.equal(y.label, "2025");
	assert.equal(y.until.toISOString(), "2025-12-31T23:59:59.999Z");
	assert.equal(parseTimeWindow("yesterday's chat", now).label, "yesterday");
	assert.equal(parseTimeWindow("What is grace?", now), null);
});

test("rank fusion rewards agreement between words and meaning", () => {
	const scores = fuseRankings([["a", "b", "c"], ["c", "d"]]);
	assert.ok(scores.get("c") > scores.get("a"), "found by both beats first in one");
	assert.ok(scores.get("a") > scores.get("b"));
	assert.equal(scores.has("z"), false);
});

test("an answer keeps only points that cite real sources", () => {
	const points = checkAnswerPoints(
		[
			{ text: "You studied the Comforter in John 14 [1].", sources: [1, 1, 3] },
			{ text: "An invented claim.", sources: [] },
			{ text: "Out of range.", sources: [9, 0, -1, 1.5] },
			{ text: "   ", sources: [2] },
			{ text: 42, sources: [1] },
			{ text: "In May you wrote a note [S2, S3].", sources: [2] },
		],
		3,
	);
	assert.deepEqual(points, [
		{ text: "You studied the Comforter in John 14.", sources: [1, 3] },
		{ text: "In May you wrote a note.", sources: [2] },
	]);
	assert.deepEqual(checkAnswerPoints([], 3), []);
});

test("source numbers written into prose come out; the chips carry them", () => {
	assert.equal(stripCitationMarks("In May you studied the Comforter. (Sources 2, 4, 6, 11)"), "In May you studied the Comforter.");
	assert.equal(stripCitationMarks("You highlighted Acts 2:4 (source 14) and wrote about it [12]."), "You highlighted Acts 2:4 and wrote about it.");
	assert.equal(stripCitationMarks("Lesson 4 (see sources 1 and 3), then more."), "Lesson 4, then more.");
	assert.equal(stripCitationMarks("Romans 8:28 (KJV) stays."), "Romans 8:28 (KJV) stays.", "only citation marks go");
	assert.equal(stripCitationMarks("You asked about prayer [Source 3, Source 4] in July."), "You asked about prayer in July.");
	assert.equal(cleanUncovered("None"), null);
	assert.equal(cleanUncovered(" n/a. "), null);
	assert.equal(cleanUncovered(null), null);
	assert.equal(cleanUncovered("Nothing about Obadiah (source 1)."), "Nothing about Obadiah.");
});

test("chat Markdown reads as plain prose in an excerpt", () => {
	assert.equal(
		plainMarkdown("The Comforter is **the Holy Ghost**.\n> “But the Comforter, which is the Holy Ghost”\n> John 14:26, KJV\n- *Teaches* all things\n## Heading\nSee [the reader](/bible/chapter?book=43) and `code`."),
		"The Comforter is the Holy Ghost.\n“But the Comforter, which is the Holy Ghost”\nJohn 14:26, KJV\nTeaches all things\nHeading\nSee the reader and code.",
	);
	assert.equal(plainMarkdown("2 * 3 = 6 and snake_case_name stay"), "2 * 3 = 6 and snake_case_name stay");
});

test("excerpts centre on the match and never exceed their length", () => {
	const text = `${"filler ".repeat(80)}the Comforter, which is the Holy Ghost ${"more ".repeat(80)}`;
	const excerpt = excerptAround(text, ["holy ghost"], 120);
	assert.match(excerpt, /Holy Ghost/);
	assert.ok(excerpt.length <= 122);
	assert.ok(excerpt.startsWith("…"));
	assert.equal(excerptAround("short text", ["nothing"], 120), "short text");
});

test("continue where you left off picks the newest study, then one per feature", () => {
	const t = (feature, at, module) => ({ feature, action: "", title: feature, detail: null, href: "/", at, module });
	const { primary, others } = pickResume([
		t("reader", "2026-10-20T10:00:00Z"),
		t("chat", "2026-10-25T10:00:00Z"),
		t("chat", "2026-10-24T10:00:00Z"),
		t("module", "2026-10-23T10:00:00Z", "projects"),
		t("module", "2026-10-22T10:00:00Z", "paths"),
		t("note", "bad date"),
	]);
	assert.equal(primary.feature, "chat");
	assert.deepEqual(others.map((o) => o.module ?? o.feature), ["projects", "paths", "reader"]);
	assert.deepEqual(pickResume([]), { primary: null, others: [] });
});

test("the Markdown export carries every section and says when it is partial", () => {
	const md = vaultMarkdown({
		exportedAt: "2026-10-26T12:00:00.000Z",
		notes: [{ id: "n1", title: "Romans 8", createdAt: "2026-04-01T00:00:00Z", updatedAt: "2026-05-01T00:00:00Z", tags: ["grace"], linksTo: ["Adoption"], linkedFrom: [], text: "No condemnation." }],
		highlights: [{ reference: "John 14:26", translation: "KJV", color: "Yellow", label: "Promises", text: "But the Comforter...", createdAt: "2026-03-01T00:00:00Z", updatedAt: "2026-03-01T00:00:00Z" }],
		chats: [{ id: "c1", title: "The Comforter", createdAt: "2026-05-01T00:00:00Z", updatedAt: "2026-05-01T00:00:00Z", messages: [{ role: "user", createdAt: "2026-05-01T00:00:00Z", text: "Who is the Comforter?" }, { role: "assistant", createdAt: "2026-05-01T00:00:01Z", text: "The Holy Ghost." }] }],
		reading: [{ date: "2026-05-02", chapters: ["John 14"] }],
		verses: [],
		memories: [{ category: "study", status: null, createdAt: "2026-05-01T00:00:00Z", updatedAt: "2026-05-01T00:00:00Z", text: "Studying the Holy Spirit" }],
		sermons: [],
		studies: [{ id: "b1", module: "projects", kind: "project", title: "The Book of Romans", createdAt: "2026-04-01T00:00:00Z", updatedAt: "2026-04-02T00:00:00Z", refs: ["45.8"], topics: ["adoption"], body: "Outline", data: {} }],
		truncated: ["chats"],
	});
	for (const heading of ["## Notes (1)", "## Highlights (1)", "## Chats (1)", "## Reading (1)", "## Learning by heart (0)", "## Memories (1)", "## Sermon studies (0)", "## Beta studies (1)"]) {
		assert.ok(md.includes(heading), heading);
	}
	assert.match(md, /Links to: \[\[Adoption\]\]/);
	assert.match(md, /> Who is the Comforter\?/);
	assert.match(md, /\*\*John 14:26\*\* \(KJV, Promises\)/);
	assert.match(md, /stops at its size limits for: chats/);
});

test("the vault is a registered library module with its own page, and every vault route gates first", () => {
	const entry = BETA_MODULES.find((m) => m.slug === "vault");
	assert.equal(entry.destination, "library");
	assert.ok(existsSync(join(repoRoot, "src/app/beta/library/vault/page.tsx")));
	const page = read("src/app/beta/library/vault/page.tsx");
	assert.match(page, /await requireBetaPage\(\)/);
	assert.match(page, /return betaMetadata\(/);
	const routes = [];
	const walk = (dir) => {
		for (const name of readdirSync(join(repoRoot, dir), { withFileTypes: true })) {
			if (name.isDirectory()) walk(`${dir}/${name.name}`);
			else if (name.name === "route.ts") routes.push(`${dir}/${name.name}`);
		}
	};
	walk("src/app/api/beta/vault");
	assert.ok(routes.length >= 7, routes.join(", "));
	for (const route of routes) {
		const source = read(route);
		assert.match(source, /const gate = await requireBetaApi\(\);\s*if \(!gate\.ok\) return gate\.response;/, `${route} gates before anything else`);
		assert.equal(/prisma\.betaItem/.test(source), false, `${route} reads beta items only through the store`);
	}
});

test("vault code never reads beta items around the store, and the index is in account deletion", () => {
	for (const file of readdirSync(join(repoRoot, "src/lib/beta/vault"))) {
		assert.equal(/prisma\.betaItem|"BetaItem"/.test(read(`src/lib/beta/vault/${file}`)), false, `${file} goes through src/lib/beta/store.ts`);
	}
	assert.match(read("src/lib/account-deletion.ts"), /model: "VaultEmbedding", via: "cascade"/);
	assert.match(read("prisma/schema.prisma"), /model VaultEmbedding \{[\s\S]*onDelete: Cascade/);
});

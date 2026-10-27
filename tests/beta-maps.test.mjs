/**
 * Concept Maps (LC-17654, docs/beta/maps.md): the ready-made maps checked
 * verse by verse against the bundled KJV, the map rules (passages, structure,
 * interpretations side by side), the layout and view math the canvas draws
 * with, the repair of a generated draft, and the source contracts that keep
 * generation retrieval-grounded and founder-only.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { LIBRARY_MAP_SOURCES, compileLibraryMap } from "../src/lib/beta/maps/library-data.ts";
import {
	assembleGeneratedMap,
	checkConceptMap,
	fitView,
	focusBranch,
	formatPassage,
	initialView,
	labelPillWidth,
	layoutConceptMap,
	mapOutlineText,
	mapPassageTexts,
	mapStoreRefKeys,
	neighbourNode,
	panToReveal,
	parsePassage,
	versesToPassages,
	zoomAround,
} from "../src/lib/beta/maps/map-rules.ts";
import { findBetaModule } from "../src/lib/beta/modules.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(repoRoot, path), "utf8");

const books = JSON.parse(read("src/data/books.json"));
const norm = (name) => name.toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ").trim();
const names = new Map();
for (const book of books) {
	names.set(norm(book.name), book);
	names.set(norm(book.abbr), book);
}
names.set("psalm", books.find((book) => book.order === 19));
const index = { byName: (name) => names.get(norm(name)) ?? null, byOrder: (order) => books.find((book) => book.order === order) ?? null };
const kjv = new Map();
const verseCount = (book, chapter) => {
	const meta = books.find((item) => item.order === book);
	if (!meta) return null;
	if (!kjv.has(book)) kjv.set(book, JSON.parse(read(`src/data/kjv/${meta.file}`)));
	return kjv.get(book)[chapter - 1]?.length ?? null;
};
const context = { books: index, verseCount };

const compiled = Object.fromEntries(LIBRARY_MAP_SOURCES.map((source) => [source.slug, checkConceptMap(compileLibraryMap(source), context)]));
const library = (slug) => {
	const result = compiled[slug];
	assert.ok(result?.ok, `${slug}: ${result?.error}`);
	return result.value;
};

/* ---------------------------------------------------------------- library */

test("every ready-made map passes its checks against the bundled KJV", () => {
	assert.ok(LIBRARY_MAP_SOURCES.length >= 6);
	for (const [slug, result] of Object.entries(compiled)) assert.ok(result.ok, `${slug}: ${result.ok ? "" : result.error}`);
	const slugs = LIBRARY_MAP_SOURCES.map((source) => source.slug);
	assert.equal(new Set(slugs).size, slugs.length, "slugs are unique");
});

test("the six maps the issue asks for are all there", () => {
	const trinity = library("trinity");
	for (const label of ["The Father is God", "The Son is God", "The Holy Ghost is God"]) assert.ok(trinity.nodes.some((node) => node.label === label), label);

	const covenants = library("covenants");
	const branches = covenants.nodes.filter((node) => node.parentId === covenants.nodes[0].id).map((node) => node.label);
	for (const name of ["Noahic", "Abrahamic", "Mosaic", "Davidic", "new covenant"]) assert.ok(branches.some((label) => label.includes(name)), name);

	const salvation = library("salvation");
	for (const label of ["Justification", "Sanctification", "Glorification"]) assert.ok(salvation.nodes.some((node) => node.label === label), label);

	const gospels = library("life-of-christ");
	const stages = gospels.nodes.filter((node) => node.parentId === gospels.nodes[0].id).map((node) => node.label);
	assert.deepEqual(stages.map((label) => Number(label.split(".")[0])), [1, 2, 3, 4, 5, 6, 7], "the Gospels' events run in order");

	const armour = library("armor-of-god");
	for (const piece of ["girdle of truth", "breastplate of righteousness", "gospel of peace", "shield of faith", "helmet of salvation", "sword of the Spirit"]) {
		assert.ok(armour.nodes.some((node) => node.label.toLowerCase().includes(piece.toLowerCase())), piece);
	}

	const fall = library("fall-and-redemption");
	const passages = mapPassageTexts(fall);
	assert.ok(passages.some((ref) => ref.startsWith("Genesis 3")), "starts at Genesis 3");
	assert.ok(passages.some((ref) => ref.startsWith("Revelation 22")), "ends at Revelation 22");
	for (const label of ["Genesis 3: The fall", "Romans 5: Justification", "Galatians: Not by works"]) assert.ok(fall.nodes.some((node) => node.label === label), `the concept board's ${label}`);
});

test("every node and every connection in the library carries verses", () => {
	for (const source of LIBRARY_MAP_SOURCES) {
		const map = library(source.slug);
		for (const node of map.nodes) {
			assert.ok(node.refs.length >= 1, `${source.slug}/${node.id} refs`);
			if (node.parentId) assert.ok(node.via && node.via.refs.length >= 1, `${source.slug}/${node.id} connection refs`);
		}
		for (const link of map.links) assert.ok(link.refs.length >= 1 && link.label, `${source.slug}/${link.id}`);
		// And the raw compiled data says so too, not just the checker's defaults.
		for (const node of compileLibraryMap(source).nodes) if (node.parentId) assert.ok(node.via.refs.length >= 1, `${source.slug}/${node.id} compiled connection refs`);
	}
});

test("where Christians differ, the library shows readings side by side and the foundation is never one of them", () => {
	let questions = 0;
	for (const source of LIBRARY_MAP_SOURCES) {
		const map = library(source.slug);
		for (const question of map.nodes.filter((node) => node.kind === "question")) {
			questions++;
			const readings = map.nodes.filter((node) => node.parentId === question.id);
			assert.ok(readings.length >= 2 && readings.every((node) => node.kind === "reading" && node.refs.length >= 1), `${source.slug}: ${question.label}`);
		}
		assert.equal(map.nodes.find((node) => node.label === "One God in three persons")?.kind ?? "topic", "topic");
	}
	assert.ok(questions >= 4, "at least four disputed passages across the library");
	assert.equal(library("trinity").nodes.some((node) => node.kind !== "topic"), false, "the Trinity is taught, not offered as one reading");
	const millennium = library("christ-in-prophecy").nodes.find((node) => node.kind === "question");
	assert.match(millennium.label, /thousand years/);
});

/* --------------------------------------------------------------- passages */

test("passages parse, check against the KJV and print canonically", () => {
	const cases = [
		["Romans 5:12-21", "Romans 5:12-21"],
		["john 3:16", "John 3:16"],
		["Psalm 23", "Psalm 23"],
		["Psalms 139:7-10", "Psalm 139:7-10"],
		["1 Cor 15:3-4", "1 Corinthians 15:3-4"],
		["Matthew 26:57-27:26", "Matthew 26:57-27:26"],
		["Genesis 1-2", "Genesis 1-2"],
		["Song of Solomon 2:4", "Song of Solomon 2:4"],
		["Jude 24", "Jude 1:24"],
		["Philemon 4-7", "Philemon 1:4-7"],
		["Jude 1", "Jude 1"],
	];
	for (const [input, expected] of cases) {
		const passage = parsePassage(input, index, verseCount);
		assert.ok(passage, input);
		assert.equal(formatPassage(passage, index), expected, input);
	}
	for (const bad of ["Romans 17:1", "John 3:99", "John 3:18-16", "Hezekiah 1:1", "Genesis 1-2:3", "", "3:16", "Romans 0:1", "Matthew 27:26-26:57"]) {
		assert.equal(parsePassage(bad, index, verseCount), null, bad);
	}
	assert.ok(parsePassage("John 3:99", index), "without verse counts only the shape is checked");
	// A long run of book-like words fails fast instead of backtracking for hours.
	const started = Date.now();
	for (const hostile of [`Song${" of".repeat(40)} !`, `Song${" of".repeat(2000)} !`, `${"a ".repeat(500)}1:1`]) {
		assert.equal(parsePassage(hostile, index, verseCount), null);
	}
	assert.ok(Date.now() - started < 200, "hostile passages parse in linear time");
});

test("verses become ranges, and the study store gets every verse and chapter key", () => {
	const passages = versesToPassages([
		{ book: 45, chapter: 5, verse: 2 },
		{ book: 45, chapter: 5, verse: 1 },
		{ book: 45, chapter: 5, verse: 1 },
		{ book: 45, chapter: 8, verse: 1 },
		{ book: 1, chapter: 3, verse: 15 },
	]);
	assert.deepEqual(passages.map((passage) => formatPassage(passage, index)), ["Genesis 3:15", "Romans 5:1-2", "Romans 8:1"]);
	const keys = mapStoreRefKeys([parsePassage("Romans 5:1-2", index), parsePassage("Psalm 23", index)], verseCount);
	assert.deepEqual(keys.sort(), ["19.23", "45.5", "45.5.1", "45.5.2"].sort());
	const capped = mapStoreRefKeys([parsePassage("Psalm 119:1-176", index)], verseCount, 100);
	assert.deepEqual(capped, ["19.119", "19.119.1"], "past the cap a range keeps its chapter and first verse");
});

/* ------------------------------------------------------------- map checks */

const tiny = () => ({
	title: "Faith",
	summary: "",
	topics: ["Faith", "faith", "  Grace  "],
	nodes: [
		{ id: "root", parentId: null, label: "Faith", note: "", kind: "topic", refs: ["Hebrews 11:1"], via: null },
		{ id: "a", parentId: "root", label: "Without faith", note: "", kind: "topic", refs: ["Hebrews 11:6"], via: { label: "needed", refs: [] } },
		{ id: "q", parentId: "root", label: "A question", note: "", kind: "question", refs: ["James 2:24"] },
		{ id: "r1", parentId: "q", label: "One", note: "", kind: "reading", refs: ["Romans 3:28"] },
		{ id: "r2", parentId: "q", label: "Two", note: "", kind: "reading", refs: ["James 2:24"] },
	],
	links: [{ id: "l1", from: "a", to: "r1", label: "both by faith", refs: ["Romans 4:3"] }],
});

test("a good map is normalized: connections borrow verses, topics are tidied", () => {
	const result = checkConceptMap(tiny(), context);
	assert.ok(result.ok, result.error);
	assert.deepEqual(result.value.nodes[1].via, { label: "needed", refs: ["Hebrews 11:6"] });
	assert.deepEqual(result.value.topics, ["faith", "grace"]);
	assert.deepEqual(result.value.origin, { kind: "custom" });
	assert.match(mapOutlineText(result.value), /A question \(Christians read this differently\)/);
	assert.match(mapOutlineText(result.value), /One \(interpretation\) \[Romans 3:28\]/);
});

test("a broken map is refused with the reason", () => {
	const broken = (mutate) => {
		const map = tiny();
		mutate(map);
		return checkConceptMap(map, context);
	};
	const cases = [
		[(map) => (map.nodes[1].parentId = "nope"), /does not exist/],
		[(map) => { map.nodes[1].parentId = "a"; }, /loop/],
		[(map) => { map.nodes.splice(4, 1); }, /at least 2 interpretations/],
		[(map) => { map.nodes[1].kind = "reading"; }, /must sit under a question/],
		[(map) => { map.nodes[3].kind = "topic"; }, /every node must be an interpretation/],
		[(map) => { map.nodes[1].refs = []; }, /at least one passage/],
		[(map) => { map.nodes[1].refs = ["Hebrews 11:99"]; }, /not a passage in the KJV/],
		[(map) => { map.nodes[1].label = "   "; }, /needs a label/],
		[(map) => { map.links[0] = { id: "l1", from: "root", to: "a", label: "x", refs: ["Hebrews 11:1"] }; }, /repeats the line/],
		[(map) => { map.links[0].refs = []; }, /at least one passage/],
		[(map) => { map.links.push({ ...map.links[0], id: "l2", from: "r1", to: "a" }); }, /linked twice/],
		[(map) => { map.nodes[0].parentId = "a"; }, /first node must be the root/],
		[(map) => { map.nodes[2].id = "a"; }, /share the id/],
		[(map) => { map.title = "x".repeat(121); }, /title is longer/],
		[(map) => { map.nodes = map.nodes.slice(0, 1); }, /at least 2 nodes/],
	];
	for (const [mutate, reason] of cases) {
		const result = broken(mutate);
		assert.equal(result.ok, false, String(reason));
		assert.match(result.error, reason);
	}
	assert.equal(checkConceptMap(null, context).ok, false);
	assert.equal(checkConceptMap({ title: "x", nodes: "nope" }, context).ok, false);
});

/* ------------------------------------------------------- layout and view */

test("the layout is a tidy tree: root on the left, no overlaps, readings side by side", () => {
	for (const source of LIBRARY_MAP_SOURCES) {
		const map = library(source.slug);
		const layout = layoutConceptMap(map);
		assert.equal(layout.nodes.size, map.nodes.length, source.slug);
		const placed = [...layout.nodes.values()];
		const root = layout.nodes.get(map.nodes[0].id);
		assert.ok(placed.every((node) => node.x >= root.x), `${source.slug}: root is leftmost`);
		for (let i = 0; i < placed.length; i++) {
			for (let j = i + 1; j < placed.length; j++) {
				const a = placed[i];
				const b = placed[j];
				const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
				assert.equal(overlap, false, `${source.slug}: ${a.id} overlaps ${b.id}`);
			}
		}
		for (const question of map.nodes.filter((node) => node.kind === "question")) {
			const readings = map.nodes.filter((node) => node.parentId === question.id).map((node) => layout.nodes.get(node.id));
			assert.equal(new Set(readings.map((node) => node.y)).size, 1, `${source.slug}: readings share a row`);
			assert.ok(layout.groups.some((group) => group.questionId === question.id), "the readings are framed");
		}
		assert.ok(placed.every((node) => node.x + node.width <= layout.width && node.y + node.height <= layout.height), `${source.slug}: inside the canvas`);
		for (const edge of layout.edges.filter((item) => item.kind === "link")) {
			const a = layout.nodes.get(edge.from);
			const b = layout.nodes.get(edge.to);
			if (Math.abs(a.x - b.x) >= 1) continue;
			// A link inside one column labels itself to the right of it, never over its nodes.
			assert.equal(edge.labelAnchor, "start", `${source.slug}: ${edge.id} anchor`);
			assert.ok(edge.labelX >= a.x + a.width && edge.labelX + 146 <= layout.width, `${source.slug}: ${edge.id} label clear of the column and inside the canvas`);
		}
		assert.deepEqual(labelCollisions(map, layout), [], `${source.slug}: link labels cover nothing`);
		assert.deepEqual(layoutConceptMap(map), layout, "deterministic");
	}
});

/** Same-column link labels that cover a node, a tree line label, a reading frame or another link label. */
function labelCollisions(map, layout) {
	const box = (x, y, w, h) => ({ x, y, w, h });
	const hit = (p, q) => p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
	const obstacles = [...layout.nodes.values()].map((n) => box(n.x, n.y, n.width, n.height));
	for (const edge of layout.edges.filter((e) => e.kind === "tree")) {
		const text = map.nodes.find((n) => n.id === edge.to)?.via?.label;
		if (text) obstacles.push(box(edge.labelX - labelPillWidth(text), edge.labelY - 12, labelPillWidth(text), 24));
	}
	for (const g of layout.groups) obstacles.push(box(g.x, g.y, g.width, g.height));
	const out = [];
	for (const edge of layout.edges.filter((e) => e.kind === "link" && e.labelAnchor === "start")) {
		const text = map.links.find((l) => l.id === edge.id).label;
		const mine = box(edge.labelX, edge.labelY - 12, labelPillWidth(text), 24);
		if (obstacles.some((o) => hit(mine, o))) out.push(edge.id);
		obstacles.push(mine);
	}
	return out;
}

test("a link label beside a busy column slides along its line off the labels it would cover", () => {
	// Three branches with three children each; a link from the first branch to the third lands, by default,
	// level with the middle branch's middle child, whose line label it would cover.
	const node = (id, parentId, via) => ({ id, parentId, label: id, note: "", kind: "topic", refs: ["John 1:1"], via: parentId ? { label: via ?? "", refs: ["John 1:1"] } : null });
	const nodes = [node("root", null)];
	for (const b of ["a", "b", "c"]) {
		nodes.push(node(b, "root", "branch"));
		for (const k of [1, 2, 3]) nodes.push(node(`${b}${k}`, b, "a long line label here"));
	}
	const map = { nodes, links: [{ id: "link-1", from: "a", to: "c", label: "a long cross link label", refs: ["John 1:1"] }] };
	const layout = layoutConceptMap(map);
	const edge = layout.edges.find((e) => e.id === "link-1");
	const a = layout.nodes.get("a");
	const c = layout.nodes.get("c");
	const b2 = layout.nodes.get("b2");
	assert.equal(edge.labelAnchor, "start");
	assert.notEqual(edge.labelY, b2.y + b2.height / 2, "moved off the middle child's line label");
	assert.ok(edge.labelY > a.y + a.height && edge.labelY < c.y, "still between the two ends of its line");
	assert.deepEqual(labelCollisions(map, layout), []);
});

test("focusing a branch keeps the path down to it and the whole branch", () => {
	const map = library("covenants");
	const davidic = map.nodes.find((node) => node.label === "Davidic covenant");
	const focused = focusBranch(map, davidic.id);
	assert.equal(focused.nodes[0].id, map.nodes[0].id, "the root stays");
	assert.ok(focused.nodes.every((node) => node.id === map.nodes[0].id || node.id === davidic.id || node.parentId === davidic.id || focused.nodes.some((parent) => parent.id === node.parentId && parent.parentId === davidic.id)));
	assert.ok(focused.nodes.some((node) => node.kind === "reading"), "the readings come along");
	assert.equal(focused.nodes.some((node) => node.label === "Noahic covenant"), false);
	assert.ok(focused.links.every((link) => focused.nodes.some((node) => node.id === link.from) && focused.nodes.some((node) => node.id === link.to)));
	assert.equal(checkConceptMap(focused, context).ok, true, "a focused map is still a valid map");
	assert.equal(focusBranch(map, map.nodes[0].id), map);
	assert.equal(focusBranch(map, "nope"), map);
});

test("zoom keeps the point under the finger, fit shows everything, arrows walk the tree", () => {
	const view = { x: 10, y: 20, scale: 1 };
	const zoomed = zoomAround(view, 2, 110, 120);
	assert.equal(zoomed.scale, 2);
	assert.equal((110 - zoomed.x) / zoomed.scale, (110 - view.x) / view.scale);
	assert.equal(zoomAround(view, 100, 0, 0).scale, 2, "clamped at 200%");
	assert.equal(zoomAround(view, 0.001, 0, 0).scale, 0.25, "clamped at 25%");
	const fit = fitView({ width: 2000, height: 1000 }, { width: 400, height: 400 });
	assert.ok(2000 * fit.scale <= 400 + 1e-9 || fit.scale === 0.25);

	const map = library("salvation");
	const layout = layoutConceptMap(map);
	const first = initialView(layout, { width: 375, height: 520 }, map.nodes[0].id);
	assert.ok(first.scale >= 0.72, "a phone starts readable, not as a speck");
	const root = layout.nodes.get(map.nodes[0].id);
	assert.ok(root.x * first.scale + first.x >= 0 && root.x * first.scale + first.x < 60, "the root starts at the left edge");
	const far = [...layout.nodes.values()].at(-1);
	const revealed = panToReveal(first, far, { width: 375, height: 520 });
	const left = far.x * revealed.scale + revealed.x;
	assert.ok(left >= 24 - 1e-9 && left + far.width * revealed.scale <= 375 - 24 + 1e-9 || far.width * revealed.scale > 327);
	// A node below the view comes up clear of the toolbar along the bottom, not just the 24px margin.
	const below = { x: 40, y: 900, width: 212, height: 88 };
	const clear = panToReveal({ x: 0, y: 0, scale: 1 }, below, { width: 375, height: 520 }, 24, 84);
	assert.equal(below.y + below.height + clear.y, 520 - 84);
	assert.equal(panToReveal({ x: 0, y: 0, scale: 1 }, below, { width: 375, height: 520 }).y + below.y + below.height, 520 - 24, "the default keeps one margin");

	const branch = map.nodes[1];
	assert.equal(neighbourNode(map, map.nodes[0].id, "ArrowRight"), branch.id);
	assert.equal(neighbourNode(map, branch.id, "ArrowLeft"), map.nodes[0].id);
	assert.equal(neighbourNode(map, branch.id, "ArrowDown"), map.nodes.filter((node) => node.parentId === map.nodes[0].id)[1].id);
	assert.equal(neighbourNode(map, branch.id, "ArrowUp"), null);
});

/* ------------------------------------------------------ generated drafts */

const pool = [
	{ id: "V1", book: 44, chapter: 2, verse: 1 },
	{ id: "V2", book: 44, chapter: 2, verse: 2 },
	{ id: "V3", book: 44, chapter: 2, verse: 4 },
	{ id: "V4", book: 44, chapter: 10, verse: 44 },
	{ id: "V5", book: 44, chapter: 8, verse: 17 },
	{ id: "V6", book: 43, chapter: 14, verse: 26 },
];
const draftNode = (id, parent, kind, verses, extra = {}) => ({ id, parent, label: `Node ${id}`, note: "A note.", kind, verses, connection: "", connectionVerses: [], ...extra });

test("a generated draft cites only retrieved verses, and its mistakes are repaired", () => {
	const draft = {
		title: "The Holy Spirit in Acts",
		summary: "How the Spirit came and worked.",
		topics: ["Holy Spirit", "acts"],
		nodes: [
			draftNode("n1", null, "topic", ["V1"]),
			draftNode("n2", "n1", "topic", ["V1", "V2", "V3", "V99"], { connection: "first at", connectionVerses: ["V1"] }),
			draftNode("ghost", "n1", "topic", ["V77"]),
			draftNode("n3", "ghost", "topic", ["V4"]),
			draftNode("n4", "n1", "question", ["V5"]),
			draftNode("n5", "n4", "reading", ["V5"]),
			draftNode("n6", "n7", "topic", ["V6"]),
			draftNode("n7", "n6", "topic", ["V6"]),
			draftNode("n8", null, "reading", ["v3"]),
		],
		links: [
			{ from: "n2", to: "n3", label: "same Spirit", verses: ["V4"] },
			{ from: "n2", to: "n1", label: "parent", verses: ["V1"] },
			{ from: "n2", to: "n3", label: "again", verses: ["V4"] },
			{ from: "n3", to: "n5", label: "no verses", verses: ["V42"] },
		],
	};
	const raw = assembleGeneratedMap(draft, pool, index, "the Holy Spirit in Acts");
	const result = checkConceptMap(raw, context);
	assert.ok(result.ok, result.error);
	const map = result.value;
	const byId = new Map(map.nodes.map((node) => [node.id, node]));
	assert.deepEqual(byId.get("n2").refs, ["Acts 2:1-2", "Acts 2:4"], "consecutive verses merge; the invented V99 is dropped");
	assert.equal(byId.has("ghost"), false, "a node with no retrieved verse is removed");
	assert.equal(byId.get("n3").parentId, "n1", "its child moves up");
	assert.equal(byId.get("n4").kind, "topic", "a question with one reading becomes an ordinary node");
	assert.equal(byId.get("n5").kind, "topic");
	assert.equal(byId.get("n8").kind, "topic", "a reading outside a question becomes ordinary");
	assert.equal(byId.get("n8").parentId, "n1", "a second root hangs from the root");
	assert.ok(["n6", "n7"].every((id) => byId.get(id)), "a loop is broken, not lost");
	assert.ok(map.nodes.every((node) => node.refs.every((ref) => ref.startsWith("Acts") || ref.startsWith("John 14"))), "nothing outside the pool");
	assert.deepEqual(map.links.map((link) => link.label), ["same Spirit"], "duplicate, parent-child and verse-less links are dropped");
	assert.deepEqual(map.origin, { kind: "generated", theme: "the Holy Spirit in Acts" });
	assert.equal(assembleGeneratedMap({ ...draft, nodes: [draftNode("a", null, "topic", ["V404"])] }, pool, index, "x"), null);
});

/* ------------------------------------------------------- source contracts */

test("generation is founder-only, metered, and grounded in retrieval", () => {
	const route = read("src/app/api/beta/maps/generate/route.ts");
	// Gated before the usage meter, so anyone off the list gets the ordinary 404 whatever they send.
	assert.match(route, /export async function POST\(req: Request\) \{\s*const gate = await requireBetaApi\(\);\s*if \(!gate\.ok\) return gate\.response;\s*return generate\(req, gate\.userId\);/);
	assert.match(route, /const generate = withIncludedAiRequest\(/);
	assert.match(route, /\}, "beta-maps"\);/);
	const generate = read("src/lib/beta/maps/generate.ts");
	assert.match(generate, /searchScripture\(/);
	assert.match(generate, /findVersesFullText\(/);
	assert.match(generate, /never lean on a verse you remember/);
	assert.match(generate, /assembleGeneratedMap\(/);
	assert.match(generate, /checkMapAgainstKjv\(/);
	assert.match(generate, /systemPrompt/);
	for (const file of ["src/app/api/beta/maps/route.ts", "src/app/api/beta/maps/[id]/route.ts"]) {
		const source = read(file);
		assert.match(source, /requireBetaApi\(\)/, file);
		assert.match(source, /checkMapAgainstKjv|getSavedMap|deleteSavedMap/, file);
	}
	assert.equal(/prisma\./.test(read("src/lib/beta/maps/store.ts")), false, "maps use the shared store, never prisma directly");
});

test("the registry marks Concept Maps live with its own route and docs", () => {
	const entry = findBetaModule("study", "maps");
	assert.equal(entry.status, "live");
	assert.equal(entry.issue, "LC-17654");
	assert.ok(existsSync(join(repoRoot, "src/app/beta/study/maps/page.tsx")));
	assert.ok(existsSync(join(repoRoot, "src/app/beta/study/maps/[mapId]/page.tsx")));
	assert.ok(existsSync(join(repoRoot, "docs/beta/maps.md")));
	assert.match(read("src/app/beta/study/maps/[mapId]/page.tsx"), /await requireBetaPage\(\)/);
});

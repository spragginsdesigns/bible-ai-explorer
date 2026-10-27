/**
 * Living Study Graph (LC-17646, docs/beta/graph.md): the pure rules the graph
 * is built, laid out, searched and suggested from, plus the source contracts
 * its routes, page and server half must keep.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
	DISMISSED_LINK_KIND,
	GRAPH_RADIUS,
	buildGraph,
	chapterKeys,
	followTopic,
	linkedKey,
	neighbourhood,
	searchGraph,
	suggestConnections,
} from "../src/lib/beta/graph/graph-rules.ts";

const BOOKS = { 1: "Genesis", 43: "John", 45: "Romans", 48: "Galatians", 49: "Ephesians" };
const label = (key) => {
	const [b, c, v] = key.split(".").map(Number);
	return v ? `${BOOKS[b]} ${c}:${v}` : `${BOOKS[b]} ${c}`;
};
const position = (key) => (Number(key.split(".")[0]) - 1) / 66;

function input(overrides = {}) {
	return {
		entries: [
			{ id: "study:romans", kind: "study", title: "Romans 5: peace with God", href: "/beta/study/projects?item=romans", date: "2026-10-20T00:00:00.000Z", refs: ["45.5", "45.5.1"], topics: ["justification", "faith"], module: "projects", itemId: "romans" },
			{ id: "study:galatians", kind: "study", title: "Galatians 2 sermon", href: "/beta/study/sermons?item=galatians", date: "2026-08-02T00:00:00.000Z", refs: ["48.2", "48.2.16"], topics: ["justification"], module: "sermons", itemId: "galatians" },
			{ id: "note:n1", kind: "note", title: "Faith and works", href: "/notes?note=n1", date: "2026-09-01T00:00:00.000Z", refs: ["49.2", "49.2.8"], topics: ["works"] },
			{ id: "note:n2", kind: "note", title: "Grace", href: "/notes?note=n2", date: "2026-03-01T00:00:00.000Z", refs: [], topics: [] },
			{ id: "highlight:h1", kind: "highlight", title: "Genesis 3:15", detail: "Promises", href: "/bible/chapter?book=1&chapter=3&verse=15", date: "2026-04-01T00:00:00.000Z", refs: ["1.3", "1.3.15"], topics: ["promises"] },
			{ id: "reading:r1", kind: "reading", title: "Romans 5", href: "/bible/chapter?book=45&chapter=5", date: "2026-10-21T00:00:00.000Z", refs: ["45.5"], topics: [] },
		],
		wikilinks: [["n1", "n2"], ["n1", "missing"], ["n2", "n1"]],
		links: [{ id: "l1", fromId: "romans", toId: "galatians", kind: "related", reason: "Both are about justification.", origin: "suggested" }],
		crossRefs: [{ from: "45.5", to: "48.2", verses: [["Romans 5:1", "Galatians 2:16"]] }],
		chapterLabel: label,
		chapterPosition: position,
		chapterHref: (key) => `/bible/chapter?book=${key.split(".")[0]}&chapter=${key.split(".")[1]}`,
		...overrides,
	};
}

test("chapter keys come from verse and chapter keys, once each, in Bible order", () => {
	assert.deepEqual(chapterKeys(["48.2.16", "45.5.1", "45.5", "1.3.15", "bad"]), ["1.3", "45.5", "48.2"]);
});

test("the graph joins studies, notes, passages, topics, wikilinks, links and cross-references", () => {
	const graph = buildGraph(input());
	const ids = new Set(graph.nodes.map((node) => node.id));
	for (const id of ["study:romans", "study:galatians", "note:n1", "note:n2", "passage:45.5", "passage:48.2", "passage:49.2", "passage:1.3", "topic:justification", "topic:promises"]) assert.ok(ids.has(id), id);
	// Highlights and reading fold into their passage instead of becoming nodes.
	assert.ok(!ids.has("highlight:h1") && !ids.has("reading:r1"));
	const genesis = graph.nodes.find((node) => node.id === "passage:1.3");
	assert.equal(genesis.folded.length, 1);
	assert.equal(graph.nodes.find((node) => node.id === "passage:45.5").folded[0].kind, "reading");
	const kinds = (kind) => graph.edges.filter((edge) => edge.kind === kind);
	assert.equal(kinds("wikilink").length, 1, "only resolved wikilinks between drawn notes, one edge per pair");
	assert.equal(kinds("wikilink")[0].both, true, "a link and its backlink are one edge marked both ways");
	assert.equal(kinds("suggested").length, 1);
	assert.equal(kinds("suggested")[0].linkId, "l1");
	assert.equal(kinds("crossref").length, 1);
	assert.deepEqual(kinds("crossref")[0].verses, [["Romans 5:1", "Galatians 2:16"]]);
	assert.ok(graph.edges.some((edge) => edge.kind === "topic" && edge.source === "passage:1.3" && edge.target === "topic:promises"), "a highlight's colour name tags its passage");
	assert.equal(graph.counts.study, 2);
	assert.equal(graph.truncated, false);
});

test("dismissed suggestions are never drawn, accepted ones are links", () => {
	const graph = buildGraph(input({ links: [
		{ id: "l1", fromId: "romans", toId: "galatians", kind: DISMISSED_LINK_KIND, reason: null, origin: "user" },
		{ id: "l2", fromId: "galatians", toId: "romans", kind: "builds-on", reason: "Paul's argument", origin: "user" },
	] }));
	assert.deepEqual(graph.edges.filter((edge) => edge.kind === "link" || edge.kind === "suggested").map((edge) => [edge.kind, edge.linkId]), [["link", "l2"]]);
});

test("passages sit on the ring in Bible order, everything else inside it", () => {
	const graph = buildGraph(input());
	for (const node of graph.nodes) {
		const r = Math.hypot(node.x, node.y);
		if (node.kind === "passage") assert.ok(Math.abs(r - GRAPH_RADIUS) < 2, `${node.id} on the ring`);
		else assert.ok(r < GRAPH_RADIUS, `${node.id} inside`);
	}
	const genesis = graph.nodes.find((node) => node.id === "passage:1.3");
	assert.ok(genesis.y < -GRAPH_RADIUS * 0.95, "Genesis at the top");
	// Clockwise from twelve o'clock, evenly spaced, in Bible order.
	const clock = (n) => (Math.atan2(n.y, n.x) + Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI);
	const ring = graph.nodes.filter((n) => n.kind === "passage").sort((a, b) => clock(a) - clock(b));
	assert.deepEqual(ring.map((n) => n.id), ["passage:1.3", "passage:45.5", "passage:48.2", "passage:49.2"]);
	const gaps = ring.slice(1).map((n, i) => clock(n) - clock(ring[i]));
	assert.ok(gaps.every((gap) => Math.abs(gap - gaps[0]) < 0.02), "evenly spaced");
	// Same input, same layout.
	assert.deepEqual(buildGraph(input()).nodes.map((n) => [n.x, n.y]), graph.nodes.map((n) => [n.x, n.y]));
});

test("the cap keeps the newest entries and says so", () => {
	const graph = buildGraph(input({ maxNodes: 3 }));
	assert.equal(graph.nodes.length, 3);
	assert.equal(graph.truncated, true);
	assert.equal(graph.nodes[0].id, "study:romans");
});

test("several hundred nodes lay out quickly", () => {
	const entries = [];
	for (let i = 0; i < 500; i++) {
		const book = 1 + (i % 66);
		entries.push({ id: `note:${i}`, kind: "note", title: `Note ${i}`, href: `/notes?note=${i}`, date: new Date(Date.UTC(2026, i % 12, 1)).toISOString(), refs: [`${book}.${1 + (i % 3)}`], topics: [`topic ${i % 25}`] });
	}
	const started = performance.now();
	const graph = buildGraph(input({ entries, wikilinks: [], links: [], crossRefs: [], maxNodes: 900 }));
	const took = performance.now() - started;
	assert.ok(graph.nodes.length > 550, String(graph.nodes.length));
	assert.ok(took < 4000, `layout took ${Math.round(took)}ms`);
	assert.ok(graph.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)));
	assert.ok(graph.nodes.every((node) => Math.hypot(node.x, node.y) <= GRAPH_RADIUS + 1));
});

test("a small graph keeps its dots apart", () => {
	const graph = buildGraph(input());
	const free = graph.nodes.filter((node) => node.kind !== "passage");
	let closest = Infinity;
	for (let i = 0; i < free.length; i++) for (let j = i + 1; j < free.length; j++) closest = Math.min(closest, Math.hypot(free[i].x - free[j].x, free[i].y - free[j].y));
	assert.ok(closest > 100, `closest pair ${Math.round(closest)} units apart`);
});

const studies = [
	{ itemId: "romans", title: "Romans 5: peace with God", refs: ["45.5", "45.5.1"], topics: ["justification", "faith"], updatedAt: "2026-10-20T00:00:00.000Z" },
	{ itemId: "galatians", title: "Galatians 2 sermon", refs: ["48.2", "48.2.16"], topics: ["justification"], updatedAt: "2026-08-02T00:00:00.000Z" },
	{ itemId: "psalm", title: "Psalm 23 for the hospital visit", refs: ["19.23"], topics: ["comfort"], updatedAt: "2026-07-01T00:00:00.000Z" },
];
const cross = [{ from: "45.5", to: "48.2", verseKeys: [["45.5.1", "48.2.16"], ["45.5.2", "48.2.20"]] }];

test("a suggestion names what both studies share, newest study first", () => {
	const out = suggestConnections({ studies, crossRefs: cross, linked: new Set(), label });
	assert.equal(out.length, 1, "Psalm 23 shares nothing with either");
	assert.equal(out[0].fromId, "romans");
	assert.equal(out[0].toId, "galatians");
	assert.equal(out[0].reason, "“Romans 5: peace with God” and “Galatians 2 sermon”: both are about justification; Romans 5:1 and Galatians 2:16 are cross-references.");
});

test("a chapter-only cross-reference is named by its verses, and a source never repeats its parent's suggestion", () => {
	const projects = [
		{ itemId: "eph", title: "Ephesians 2", refs: ["49.2", "49.2.8"], topics: ["faith"], updatedAt: "2026-09-05" },
		{ itemId: "gal", title: "Galatians 2", refs: ["48.2", "48.2.16"], topics: ["faith"], updatedAt: "2026-08-02" },
		{ itemId: "src", title: "Notes on Ephesians 2:8", refs: ["49.2", "49.2.8"], topics: ["faith"], updatedAt: "2026-09-06", parentItemId: "eph" },
	];
	const chapterOnly = [{ from: "48.2", to: "49.2", verseKeys: [["48.2.20", "49.2.6"]] }];
	const out = suggestConnections({ studies: projects, crossRefs: chapterOnly, linked: new Set(), label });
	assert.deepEqual(out.map((s) => [s.fromId, s.toId]), [["eph", "gal"]], "the source is covered by its parent's suggestion, and is never paired with its own parent");
	assert.equal(out[0].reason, "“Ephesians 2” and “Galatians 2”: both are about faith; their chapters meet in a cross-reference (Ephesians 2:6 and Galatians 2:20).");
	// Once the parent is linked to Galatians, the source still is not offered it.
	assert.equal(suggestConnections({ studies: projects, crossRefs: chapterOnly, linked: new Set([linkedKey("eph", "gal")]), label }).length, 0);
});

test("already linked or dismissed pairs, parents and children, and other studies under focus are skipped", () => {
	assert.equal(suggestConnections({ studies, crossRefs: cross, linked: new Set([linkedKey("galatians", "romans")]), label }).length, 0);
	assert.equal(suggestConnections({ studies: [studies[0], { ...studies[1], parentItemId: "romans" }], crossRefs: cross, linked: new Set(), label }).length, 0);
	assert.equal(suggestConnections({ studies, crossRefs: cross, linked: new Set(), focusItemId: "psalm", label }).length, 0);
	assert.equal(suggestConnections({ studies, crossRefs: cross, linked: new Set(), focusItemId: "galatians", label }).length, 1);
});

test("a chapter-level cross-reference alone is not enough; a shared chapter is", () => {
	const loose = [
		{ itemId: "a", title: "A", refs: ["45.5"], topics: [], updatedAt: "2026-10-01" },
		{ itemId: "b", title: "B", refs: ["48.2"], topics: [], updatedAt: "2026-09-01" },
	];
	assert.equal(suggestConnections({ studies: loose, crossRefs: cross, linked: new Set(), label }).length, 0);
	const shared = [loose[0], { ...loose[1], refs: ["45.5"] }];
	const [one] = suggestConnections({ studies: shared, crossRefs: cross, linked: new Set(), label });
	assert.equal(one.reason, "“A” and “B”: both study Romans 5.");
	assert.deepEqual(suggestConnections({ studies: [], crossRefs: [], linked: new Set(), label }), []);
});

test("search finds labels and details, passages and topics first on a tie", () => {
	const graph = buildGraph(input());
	assert.equal(searchGraph(graph.nodes, "roman")[0].id, "passage:45.5");
	assert.deepEqual(searchGraph(graph.nodes, "  "), []);
	assert.equal(searchGraph(graph.nodes, "JUSTIFICATION")[0].id, "topic:justification");
	assert.equal(searchGraph(graph.nodes, "zzzz").length, 0);
});

test("a topic is followed across books and over time", () => {
	const graph = buildGraph(input());
	const trail = followTopic(graph, "topic:justification", (order) => BOOKS[order]);
	assert.deepEqual(trail.books.map((book) => [book.name, book.passages.map((p) => p.label)]), [["Romans", ["Romans 5"]], ["Galatians", ["Galatians 2"]]]);
	assert.deepEqual(trail.months.map((month) => [month.month, month.nodes.map((n) => n.id)]), [["2026-08", ["study:galatians"]], ["2026-10", ["study:romans"]]]);
	assert.equal(followTopic(graph, "passage:45.5", () => ""), null);
	assert.equal(followTopic(graph, "topic:nothing", () => ""), null);
});

test("a node's neighbourhood lists suggestions first", () => {
	const graph = buildGraph(input());
	const around = neighbourhood(graph, "study:romans");
	assert.equal(around[0].edge.kind, "suggested");
	assert.ok(around.some(({ node }) => node.id === "topic:faith"));
});

// ---------------------------------------------------------------------------
// Source contracts
// ---------------------------------------------------------------------------

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");
function files(dir) {
	return readdirSync(join(root, dir)).flatMap((name) => {
		const path = join(dir, name);
		return statSync(join(root, path)).isDirectory() ? files(path) : [path];
	});
}

test("every graph route is gated and answers privately", () => {
	const routes = files("src/app/api/beta/graph").filter((path) => path.endsWith("route.ts"));
	assert.equal(routes.length, 3);
	for (const path of routes) {
		const source = read(path);
		assert.match(source, /const gate = await requireBetaApi\(\);\s*if \(!gate\.ok\) return gate\.response;/, path);
		assert.match(source, /graphJson|graphFailure/, path);
	}
	assert.match(read("src/lib/beta/graph/http.ts"), /BETA_PRIVATE_HEADERS/);
});

test("the page gates itself and the module's code never touches the store's tables or an AI provider directly", () => {
	const page = read("src/app/beta/library/graph/page.tsx");
	assert.match(page, /await requireBetaPage\(\)/);
	assert.match(page, /betaMetadata\(/);
	for (const path of [...files("src/lib/beta/graph"), ...files("src/app/api/beta/graph"), ...files("src/components/beta/graph")]) {
		const source = read(path);
		assert.doesNotMatch(source, /prisma\.beta(Item|Link)\b/, `${path} goes through the store`);
		assert.doesNotMatch(source, /@\/lib\/ai\/|openai|withIncludedAiRequest/i, `${path}: suggestions make no model call`);
	}
});

test("passage-to-passage edges reuse the Connections ring's cross-references", () => {
	const source = read("src/lib/beta/graph/graph.ts");
	assert.match(source, /getChapterConnections/);
	assert.match(source, /topics: item\.private \? \[\] : item\.topics/, "a private item is shown by title, passages and dates only");
	assert.match(source, /filter\(\(item\) => !item\.private\)/, "private items are never suggested");
});

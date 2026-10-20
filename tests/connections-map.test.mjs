/**
 * The Connections ring (docs/FEATURES.md -> "Connections map"): the shared
 * geometry, palette and answer parser every client draws from, and the
 * contract that the Android copy never drifts from the web one.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
	CONNECTION_SECTIONS,
	angleOfIndex,
	batchArcs,
	bookAtIndex,
	chordPath,
	connectionSectionOf,
	indexAtAngle,
	parseConnectionExplanation,
	sectionInk,
	ringArcPath,
	sectionSpan,
} from "../src/lib/bible/connectionsMap.ts";

const read = (relativePath) =>
	readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

test("the Android copy is byte for byte the web module", () => {
	assert.equal(
		read("../mobile/src/features/bible/connectionsMap.ts"),
		read("../src/lib/bible/connectionsMap.ts")
	);
});

test("the ten sections cover all 66 books exactly once, in canon order", () => {
	let next = 1;
	for (const section of CONNECTION_SECTIONS) {
		assert.equal(section.first, next, section.id);
		assert.ok(section.last >= section.first);
		next = section.last + 1;
	}
	assert.equal(next, 67);
	assert.equal(connectionSectionOf(19).id, "poetry");
	assert.equal(connectionSectionOf(44).id, "acts");
	assert.equal(connectionSectionOf(45).id, "pauline");
	assert.equal(connectionSectionOf(66).id, "revelation");
});

test("the ring runs clockwise from twelve o'clock and never closes the gap", () => {
	const frame = { cx: 100, cy: 100, r: 80, total: 31102 };
	const first = angleOfIndex(frame, 0);
	const last = angleOfIndex(frame, 31101);
	assert.ok(first > -Math.PI / 2 && first < -Math.PI / 2 + 0.05, "Genesis just right of the top");
	assert.ok(last < Math.PI * 1.5 && last > Math.PI * 1.5 - 0.05, "Revelation just left of the top");
	assert.ok(angleOfIndex(frame, 15000) > first);
});

test("a tap angle maps back to the verse under it, and the top gap to nothing", () => {
	const frame = { cx: 0, cy: 0, r: 80, total: 31102 };
	for (const index of [0, 1, 777, 15551, 31101]) {
		assert.equal(indexAtAngle(frame, angleOfIndex(frame, index)), index);
	}
	assert.equal(indexAtAngle(frame, -Math.PI / 2), null);
});

test("chords and ring segments are well-formed SVG path data", () => {
	const frame = { cx: 100, cy: 100, r: 80, total: 1000 };
	assert.match(chordPath(frame, 10, 900), /^M[\d.]+ [\d.]+Q[\d.]+ [\d.]+ [\d.]+ [\d.]+$/);
	assert.match(ringArcPath(frame, 0, 600, 84), /^M[\d.]+ [\d.]+A84\.0 84\.0 0 1 1 [\d.]+ [\d.]+$/);
	// A one-verse book still draws when the trim is wider than its arc, and an
	// empty run draws nothing rather than wrapping the whole ring.
	assert.notEqual(ringArcPath(frame, 5, 6, 84, 1), "");
	assert.equal(ringArcPath(frame, 6, 6, 84, 0.004), "");
});

test("every book of the real canon draws a ring segment", () => {
	const read = (path) => JSON.parse(readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8"));
	const baseline = [];
	let start = 0;
	for (const book of read("../src/data/books.json")) {
		const verses = read(`../src/data/kjv/${book.file}`).reduce((sum, chapter) => sum + chapter.length, 0);
		baseline.push([book.order, start, verses]);
		start += verses;
	}
	assert.equal(start, 31102);
	// A ~300px phone ring, trimmed as ConnectionsRing draws it.
	const frame = { cx: 160, cy: 160, r: 126, total: start };
	const missing = baseline
		.filter(([, bookStart, verses]) => !ringArcPath(frame, bookStart, bookStart + verses, frame.r, 0.004))
		.map(([order]) => order);
	assert.deepEqual(missing, []);
});

test("book and section lookups follow the baseline runs", () => {
	const books = [
		[1, 0, 10],
		[2, 10, 5],
		[40, 15, 20],
	];
	assert.equal(bookAtIndex(books, 0), 1);
	assert.equal(bookAtIndex(books, 12), 2);
	assert.equal(bookAtIndex(books, 34), 40);
	assert.deepEqual(sectionSpan(books, CONNECTION_SECTIONS[0]), [0, 15]);
	assert.deepEqual(sectionSpan(books, CONNECTION_SECTIONS[5]), [15, 35]);
});

test("arcs of one colour are drawn as one path", () => {
	const batches = batchArcs([
		{ color: "#a", d: "M1 1" },
		{ color: "#b", d: "M2 2" },
		{ color: "#a", d: "M3 3" },
	]);
	assert.deepEqual(batches, [
		{ key: "#a", color: "#a", d: "M1 1M3 3" },
		{ key: "#b", color: "#b", d: "M2 2" },
	]);
});

test("the explain answer splits into a summary and one card per passage", () => {
	const parsed = parseConnectionExplanation(
		"God provides the sacrifice.\nGenesis 22:8 :: Abraham says God will provide a lamb.\nIt points to Christ.\n**Romans 5:8** :: God commends his love.\nIsaiah 53"
	);
	assert.equal(parsed.summary, "God provides the sacrifice.");
	assert.deepEqual(parsed.items, [
		{ reference: "Genesis 22:8", text: "Abraham says God will provide a lamb. It points to Christ." },
		{ reference: "Romans 5:8", text: "God commends his love." },
	]);
	// Once the answer is complete, a wrapped last line is kept, not held back.
	const done = parseConnectionExplanation("Thread.\nJohn 1:29 :: Behold the Lamb.\nwhich taketh away sin.", true);
	assert.equal(done.items[0].text, "Behold the Lamb. which taketh away sin.");
});

test("section text darkens on a light background and keeps its colour on dark", () => {
	assert.equal(sectionInk("#6fe3f5", true), "#6fe3f5");
	assert.equal(sectionInk("#6fe3f5", false), "#458d98");
});

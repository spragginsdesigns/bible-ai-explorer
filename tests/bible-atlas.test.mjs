import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
	ATLAS_ERAS,
	eraIndex,
	getEntityView,
	groupEventsByEra,
	parseAtlasRef,
	refTouchesChapter,
	searchAtlasData,
	selectTimelineEvents,
	whoIsInChapter,
} from "../src/lib/bible/atlas-core.ts";

const read = (path) => JSON.parse(readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8"));

const books = read("../src/data/books.json");
const events = read("../src/data/bible-atlas/events.json");
const people = read("../src/data/bible-atlas/people.json");
const places = read("../src/data/bible-atlas/places.json");
const atlas = { events, people, places };

/** Verses of one chapter, straight off the bundled KJV. Cached per book. */
const bookCache = new Map();
function kjvChapter(order, chapter) {
	if (!bookCache.has(order)) {
		const meta = books.find((book) => book.order === order);
		bookCache.set(order, read(`../src/data/kjv/${meta.file}`));
	}
	return bookCache.get(order)[chapter - 1] ?? null;
}

test("the atlas is the size the feature promises", () => {
	assert.ok(events.length >= 150, `only ${events.length} events`);
	assert.ok(people.length >= 150, `only ${people.length} people`);
	assert.ok(places.length >= 80, `only ${places.length} places`);
});

test("every id is unique and kebab-case", () => {
	for (const [list, kind] of [
		[events, "event"],
		[people, "person"],
		[places, "place"],
	]) {
		const seen = new Set();
		for (const entry of list) {
			assert.match(entry.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `${kind} id "${entry.id}"`);
			assert.ok(!seen.has(entry.id), `${kind} id "${entry.id}" appears twice`);
			seen.add(entry.id);
		}
	}
});

test("every reference resolves to a chapter and verse the KJV actually has", () => {
	const all = [
		...events.map((event) => [`event ${event.id}`, event.refs]),
		...people.map((person) => [`person ${person.id}`, person.refs]),
		...places.map((place) => [`place ${place.id}`, place.refs]),
	];
	let checked = 0;
	for (const [label, refs] of all) {
		assert.ok(refs.length > 0, `${label} cites nothing`);
		for (const raw of refs) {
			const ref = parseAtlasRef(books, raw);
			assert.ok(ref, `${label}: "${raw}" does not parse`);
			const verses = kjvChapter(ref.order, ref.chapter);
			assert.ok(verses, `${label}: "${raw}" has no such chapter`);
			if (ref.verse !== undefined) {
				assert.ok(ref.verse <= verses.length, `${label}: "${raw}" is past the end of the chapter`);
			}
			if (ref.endChapter !== ref.chapter) {
				assert.ok(kjvChapter(ref.order, ref.endChapter), `${label}: "${raw}" ends nowhere`);
			} else if (ref.endVerse !== undefined) {
				assert.ok(ref.endVerse <= verses.length, `${label}: "${raw}" ends past the chapter`);
			}
			checked += 1;
		}
	}
	assert.ok(checked > 1000, `only ${checked} references were checked`);
});

test("every person and place an event names exists", () => {
	const personIds = new Set(people.map((person) => person.id));
	const placeIds = new Set(places.map((place) => place.id));
	for (const event of events) {
		for (const id of event.people) {
			assert.ok(personIds.has(id), `event ${event.id} names missing person "${id}"`);
		}
		for (const id of event.places) {
			assert.ok(placeIds.has(id), `event ${event.id} names missing place "${id}"`);
		}
	}
	for (const person of people) {
		for (const id of person.related) {
			assert.ok(
				personIds.has(id) || placeIds.has(id),
				`person ${person.id} is related to missing "${id}"`
			);
		}
		assert.ok(!person.related.includes(person.id), `person ${person.id} is related to itself`);
	}
});

test("events are filed under a real era, and never go backwards in time", () => {
	let last = -1;
	for (const event of events) {
		const index = eraIndex(event.era);
		assert.notEqual(index, -1, `event ${event.id} has era "${event.era}"`);
		assert.ok(index >= last, `event ${event.id} is out of chronological order`);
		last = index;
	}
	assert.equal(ATLAS_ERAS.length, 9);
});

test("references parse in all four authored shapes, and only those", () => {
	assert.deepEqual(parseAtlasRef(books, "Genesis 1"), {
		label: "Genesis 1",
		order: 1,
		book: "Genesis",
		chapter: 1,
		endChapter: 1,
	});
	assert.deepEqual(parseAtlasRef(books, "John 3:16"), {
		label: "John 3:16",
		order: 43,
		book: "John",
		chapter: 3,
		verse: 16,
		endChapter: 3,
		endVerse: 16,
	});
	assert.equal(parseAtlasRef(books, "Genesis 12:1-4").endVerse, 4);
	assert.equal(parseAtlasRef(books, "Genesis 6-9").endChapter, 9);
	// "Psalm" and abbreviations resolve the way the reader resolves them.
	assert.equal(parseAtlasRef(books, "Psalm 23").order, 19);
	assert.equal(parseAtlasRef(books, "1 Sam 3:10").order, 9);
	// And nothing else does.
	assert.equal(parseAtlasRef(books, "Hezekiah 1:1"), null);
	assert.equal(parseAtlasRef(books, "Genesis 51"), null);
	assert.equal(parseAtlasRef(books, "Genesis 9-6"), null);
	assert.equal(parseAtlasRef(books, "just some words"), null);
});

test("a reference covers every chapter it spans, and no others", () => {
	const flood = parseAtlasRef(books, "Genesis 6-9");
	assert.ok(refTouchesChapter(flood, 1, 7));
	assert.ok(!refTouchesChapter(flood, 1, 10));
	assert.ok(!refTouchesChapter(flood, 2, 7), "a different book must not match");
});

test("search finds a person by name", () => {
	const [best] = searchAtlasData(atlas, "moses");
	assert.equal(best.id, "moses");
	assert.equal(best.kind, "person");
});

test("search finds Paul by a name Scripture also calls him", () => {
	assert.equal(searchAtlasData(atlas, "saul of tarsus")[0].id, "paul");
	// A bare "Saul" is the king first, but Paul is still in the results.
	const bare = searchAtlasData(atlas, "saul");
	assert.ok(
		bare.some((hit) => hit.id === "paul"),
		"Paul should still be found under Saul"
	);
});

test("search matches aliases, places and event titles too", () => {
	assert.equal(searchAtlasData(atlas, "Elias")[0].id, "elijah");
	assert.equal(searchAtlasData(atlas, "Calvary")[0].id, "golgotha");
	assert.equal(searchAtlasData(atlas, "capernaum")[0].kind, "place");
	assert.ok(searchAtlasData(atlas, "fiery furnace").some((hit) => hit.kind === "event"));
	assert.deepEqual(searchAtlasData(atlas, "   "), []);
	assert.deepEqual(searchAtlasData(atlas, "quetzalcoatl"), []);
});

test("search is stable and respects its limit", () => {
	const first = searchAtlasData(atlas, "john", 5);
	assert.ok(first.length <= 5);
	assert.deepEqual(first, searchAtlasData(atlas, "john", 5));
});

test("era grouping keeps chronological order and drops empty eras", () => {
	const groups = groupEventsByEra(atlas, events);
	assert.deepEqual(
		groups.map((group) => group.era),
		[...ATLAS_ERAS]
	);
	assert.deepEqual(
		groups.map((group) => eraIndex(group.era)),
		groups.map((group) => eraIndex(group.era)).slice().sort((a, b) => a - b)
	);
	assert.equal(
		groups.reduce((total, group) => total + group.events.length, 0),
		events.length
	);

	const oneEra = groupEventsByEra(atlas, selectTimelineEvents(atlas, books, { era: "Life of Christ" }));
	assert.equal(oneEra.length, 1);
	assert.equal(oneEra[0].era, "Life of Christ");
});

test("the timeline can be narrowed to an era, a chapter, or a person", () => {
	const exodus = selectTimelineEvents(atlas, books, { era: "Egypt & the Exodus" });
	assert.ok(exodus.length > 0);
	assert.ok(exodus.every((event) => event.era === "Egypt & the Exodus"));

	// Exodus 14 is the Red sea, and nothing else on the timeline touches it.
	const redSea = selectTimelineEvents(atlas, books, { book: 2, chapter: 14 });
	assert.deepEqual(
		redSea.map((event) => event.id),
		["crossing-the-red-sea"]
	);

	const moses = selectTimelineEvents(atlas, books, { personId: "moses" });
	assert.ok(moses.length > 5);
	assert.ok(moses.every((event) => event.people.includes("moses")));

	assert.deepEqual(selectTimelineEvents(atlas, books, { personId: "nobody-at-all" }), []);
});

test("who is in a chapter answers with the people and places of that chapter", () => {
	const genesis22 = whoIsInChapter(atlas, books, 1, 22);
	assert.ok(genesis22.people.some((person) => person.id === "abraham"));
	assert.ok(genesis22.people.some((person) => person.id === "isaac"));
	assert.ok(genesis22.places.some((place) => place.id === "moriah"));
	assert.ok(genesis22.events.some((event) => event.id === "offering-of-isaac"));

	// A chapter the atlas says nothing about answers empty rather than throwing.
	const nothing = whoIsInChapter(atlas, books, 3, 13);
	assert.deepEqual(nothing.events, []);
});

test("an event view resolves its people and places into chips", () => {
	const [flood] = selectTimelineEvents(atlas, books, {}).filter((event) => event.id === "the-flood");
	const view = groupEventsByEra(atlas, [flood])[0].events[0];
	assert.equal(view.title, flood.title);
	assert.ok(view.people.some((person) => person.name === "Noah"));
	assert.deepEqual(view.places.map((place) => place.name), ["Ararat"]);
	assert.ok(view.people.every((person) => person.kind === "person"));
});

test("an entity view carries its aliases, relations and events", () => {
	const moses = getEntityView(atlas, "moses");
	assert.equal(moses.kind, "person");
	assert.equal(moses.era, "Egypt & the Exodus");
	assert.ok(moses.related.some((related) => related.id === "aaron"));
	assert.ok(moses.events.some((event) => event.id === "the-burning-bush"));

	const jericho = getEntityView(atlas, "jericho");
	assert.equal(jericho.kind, "place");
	assert.equal(jericho.era, null, "a place is not tied to one era");
	assert.deepEqual(jericho.related, []);
	assert.ok(jericho.events.some((event) => event.id === "fall-of-jericho"));

	assert.equal(getEntityView(atlas, "no-such-id"), null);
});

test("the mirrored copies the Android app ships are identical to the source", () => {
	for (const file of ["events.json", "people.json", "places.json"]) {
		assert.deepEqual(
			read(`../mobile/src/data/bible-atlas/${file}`),
			read(`../src/data/bible-atlas/${file}`),
			`${file} has drifted - re-run node scripts/build-bible-atlas.mjs`
		);
	}
	const source = readFileSync(
		fileURLToPath(new URL("../src/lib/bible/atlas-core.ts", import.meta.url)),
		"utf8"
	);
	const mirrored = readFileSync(
		fileURLToPath(new URL("../mobile/src/features/atlas/atlasCore.ts", import.meta.url)),
		"utf8"
	);
	assert.ok(
		mirrored.endsWith(source),
		"mobile/src/features/atlas/atlasCore.ts has drifted - re-run node scripts/build-bible-atlas.mjs"
	);
});

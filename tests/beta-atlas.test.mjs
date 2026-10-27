/**
 * SureWord Beta: Atlas & Timeline (LC-17655, docs/beta/atlas.md).
 *
 * Holds the beta's map and timeline data to the corpus's own rules
 * (src/data/bible-atlas/README.md): every reference resolves in the bundled
 * KJV, every place is actually named in a verse it cites, every corpus id it
 * points at exists, and every date that claims to come from the corpus or
 * from Ussher still says what that source says. Also checks the pure rules
 * the map, the scrubber and the reader link run on.
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { eventDateFromLabel, parseAtlasRef } from "../src/lib/bible/atlas-core.ts";
import {
	BASEMAP_PROJECTION,
	MAP_HEIGHT,
	MAP_WIDTH,
	MAX_SCALE,
	activeSpans,
	atlasUrlQuery,
	buildTimelineScale,
	clampCamera,
	declutter,
	eraSlug,
	fitPoints,
	formatYear,
	formatYearSpan,
	interpolateCamera,
	labelBox,
	lifeChapters,
	minScale,
	nameTokens,
	nearestDated,
	parseAtlasUrl,
	placesNamedIn,
	projectLonLat,
	stepToNext,
	toMap,
	toScreen,
	zoomAround,
} from "../src/lib/beta/atlas/atlas-rules.ts";
import { BETA_ATLAS_GEO, BETA_ATLAS_SAME_SITE, BETA_ATLAS_UNMAPPED, BETA_ATLAS_WAYPOINTS } from "../src/lib/beta/atlas/places.ts";
import { BETA_JOURNEYS } from "../src/lib/beta/atlas/journeys.ts";
import { BETA_ERA_SPANS, BETA_TIMELINE_LANES } from "../src/lib/beta/atlas/lanes.ts";
import { ATLAS_ERAS } from "../src/lib/bible/atlas-core.ts";

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const json = (path) => JSON.parse(read(path));

const books = json("../src/data/books.json");
const events = json("../src/data/bible-atlas/events.json");
const people = json("../src/data/bible-atlas/people.json");
const corpusPlaces = json("../src/data/bible-atlas/places.json");

const eventById = new Map(events.map((event) => [event.id, event]));
const peopleIds = new Set(people.map((person) => person.id));
const corpusPlaceIds = new Set(corpusPlaces.map((place) => place.id));
const waypointById = new Map(BETA_ATLAS_WAYPOINTS.map((place) => [place.id, place]));
const placeById = new Map([...corpusPlaces.map((place) => [place.id, place]), ...BETA_ATLAS_WAYPOINTS.map((place) => [place.id, place])]);

const bookCache = new Map();
function kjvChapter(order, chapter) {
	if (!bookCache.has(order)) {
		const meta = books.find((book) => book.order === order);
		bookCache.set(order, json(`../src/data/kjv/${meta.file}`));
	}
	return bookCache.get(order)[chapter - 1] ?? null;
}

/** The KJV text of an authored reference, or an assertion failure naming it. */
function kjvText(label, raw) {
	const ref = parseAtlasRef(books, raw);
	assert.ok(ref, `${label}: "${raw}" does not parse`);
	const verses = kjvChapter(ref.order, ref.chapter);
	assert.ok(verses, `${label}: "${raw}" has no such chapter`);
	if (ref.verse === undefined) return verses.join(" ");
	const last = ref.endChapter === ref.chapter ? ref.endVerse ?? ref.verse : verses.length;
	assert.ok(ref.verse <= verses.length && last <= verses.length, `${label}: "${raw}" is past the end of the chapter`);
	return verses.slice(ref.verse - 1, last).join(" ");
}

const names = (place) => [place.name, ...(place.alsoCalled ?? [])];
const folded = (value) => ` ${nameTokens(value).join(" ")} `;
const namesPlace = (text, candidates) => candidates.some((name) => folded(text).includes(folded(name)));

/* --------------------------------------------------------------- places */

test("waypoints follow the corpus rules: unique kebab ids, resolvable refs, and named in a cited verse", () => {
	const seen = new Set();
	for (const place of BETA_ATLAS_WAYPOINTS) {
		assert.match(place.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `waypoint id "${place.id}"`);
		assert.ok(!seen.has(place.id), `waypoint "${place.id}" twice`);
		assert.ok(!corpusPlaceIds.has(place.id), `waypoint "${place.id}" duplicates a corpus place; use the corpus id`);
		seen.add(place.id);
		assert.ok(place.description.length >= 40, `${place.id}: description`);
		assert.ok(place.refs.length >= 1, `${place.id}: cites nothing`);
		const texts = place.refs.map((raw) => kjvText(`waypoint ${place.id}`, raw));
		assert.ok(
			texts.some((text) => namesPlace(text, names(place))),
			`${place.id}: none of ${place.refs.join(", ")} names ${names(place).join(" / ")}`
		);
	}
});

test("every corpus place is on the map, shares a marker, or says why it is not", () => {
	for (const place of corpusPlaces) {
		const placed = BETA_ATLAS_GEO[place.id] || BETA_ATLAS_SAME_SITE[place.id] || BETA_ATLAS_UNMAPPED[place.id];
		assert.ok(placed, `corpus place "${place.id}" has no coordinates, shared site or reason`);
	}
	for (const place of BETA_ATLAS_WAYPOINTS) assert.ok(BETA_ATLAS_GEO[place.id], `waypoint "${place.id}" has no coordinates`);
	for (const [id, entry] of Object.entries(BETA_ATLAS_SAME_SITE)) {
		assert.ok(corpusPlaceIds.has(id), `same-site "${id}" is not a corpus place`);
		assert.ok(BETA_ATLAS_GEO[entry.at], `same-site "${id}" points at "${entry.at}", which has no marker`);
		assert.equal(BETA_ATLAS_GEO[id], undefined, `"${id}" shares a marker and must not have its own`);
	}
	for (const id of Object.keys(BETA_ATLAS_UNMAPPED)) assert.equal(BETA_ATLAS_GEO[id], undefined, `"${id}" is unmapped and placed`);
});

test("every coordinate belongs to a place and sits inside the basemap", () => {
	for (const [id, geo] of Object.entries(BETA_ATLAS_GEO)) {
		assert.ok(placeById.has(id), `coordinates for unknown place "${id}"`);
		assert.ok(geo.lon > BASEMAP_PROJECTION.lonMin && geo.lon < BASEMAP_PROJECTION.lonMax, `${id}: longitude off the map`);
		assert.ok(geo.lat > BASEMAP_PROJECTION.latMin && geo.lat < BASEMAP_PROJECTION.latMax, `${id}: latitude off the map`);
		assert.ok(["known", "traditional", "uncertain"].includes(geo.certainty), `${id}: certainty`);
		assert.ok(["city", "region", "mountain", "water", "island"].includes(geo.feature), `${id}: feature`);
		assert.ok([1, 2, 3].includes(geo.rank), `${id}: rank`);
	}
	// Spot checks against well-known sites, so a swapped lat/lon cannot pass.
	const near = (id, lat, lon) => assert.ok(Math.abs(BETA_ATLAS_GEO[id].lat - lat) < 0.2 && Math.abs(BETA_ATLAS_GEO[id].lon - lon) < 0.2, `${id} is not where it should be`);
	near("jerusalem", 31.78, 35.23);
	near("rome", 41.89, 12.48);
	near("ephesus", 37.94, 27.34);
	near("babylon", 32.54, 44.42);
	near("melita", 35.9, 14.4);
});

/* ------------------------------------------------------------- journeys */

test("journeys: known places, KJV refs that name each stop, real corpus events and people", () => {
	const ids = new Set();
	for (const journey of BETA_JOURNEYS) {
		assert.match(journey.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
		assert.ok(!ids.has(journey.id), `journey "${journey.id}" twice`);
		ids.add(journey.id);
		assert.ok(journey.stops.length >= 5, `${journey.id}: too few stops`);
		for (const id of journey.people) assert.ok(peopleIds.has(id), `${journey.id}: unknown person "${id}"`);
		for (const id of [journey.when.from, journey.when.to]) assert.ok(eventById.has(id), `${journey.id}: unknown event "${id}"`);
		journey.stops.forEach((stop, index) => {
			const label = `${journey.id} stop ${index + 1} (${stop.place})`;
			const place = placeById.get(stop.place);
			assert.ok(place, `${label}: unknown place`);
			assert.ok(BETA_ATLAS_GEO[stop.place], `${label}: not on the map`);
			assert.ok(stop.refs.length >= 1 && stop.refs.length <= 4, `${label}: one to four refs`);
			assert.ok(stop.note.length >= 10 && stop.note.length <= 320, `${label}: note length`);
			const texts = stop.refs.map((raw) => kjvText(label, raw));
			const candidates = stop.as ? [stop.as] : names(place);
			assert.ok(texts.some((text) => namesPlace(text, candidates)), `${label}: no verse names ${candidates.join(" / ")}`);
			if (stop.event) {
				const event = eventById.get(stop.event);
				assert.ok(event, `${label}: unknown event "${stop.event}"`);
			}
			if (index > 0) assert.notEqual(journey.stops[index - 1].place, stop.place, `${label}: same place twice in a row`);
		});
	}
	assert.deepEqual([...ids], ["abraham", "exodus", "gospels", "paul-1", "paul-2", "paul-3", "rome"]);
});

test("Paul's journeys start and end where Acts says", () => {
	const ends = Object.fromEntries(BETA_JOURNEYS.map((j) => [j.id, [j.stops[0].place, j.stops.at(-1).place]]));
	assert.deepEqual(ends["paul-1"], ["antioch", "antioch"]);
	assert.deepEqual(ends["paul-2"], ["antioch", "antioch"]);
	assert.deepEqual(ends["paul-3"], ["antioch", "jerusalem"]);
	assert.deepEqual(ends.rome, ["caesarea", "rome"]);
	assert.deepEqual(ends.exodus, ["rameses", "jericho"]);
	assert.deepEqual(ends.abraham, ["ur", "hebron"]);
});

/* ---------------------------------------------------------------- lanes */

const signedYear = (event, which) => {
	const date = event.date ?? eventDateFromLabel(event.yearLabel);
	return which === "start" ? date.startYear : date.endYear;
};

test("timeline lanes: resolvable refs, real people and events, and spans in order", () => {
	const laneIds = BETA_TIMELINE_LANES.map((lane) => lane.id);
	assert.deepEqual(laneIds, ["patriarchs", "judges", "united", "israel", "judah", "prophets", "exile", "christ", "church"]);
	const journeyIds = new Set(BETA_JOURNEYS.map((j) => j.id));
	for (const lane of BETA_TIMELINE_LANES) {
		for (const span of lane.spans) {
			const label = `${lane.id}/${span.id}`;
			assert.ok(span.start <= span.end, `${label}: starts after it ends`);
			assert.ok(span.start !== 0 && span.end !== 0, `${label}: there is no year zero`);
			assert.ok(["ussher", "corpus", "reigns"].includes(span.source), `${label}: source`);
			for (const raw of span.refs) kjvText(label, raw);
			if (span.person) assert.ok(peopleIds.has(span.person), `${label}: unknown person "${span.person}"`);
			if (span.journey) assert.ok(journeyIds.has(span.journey), `${label}: unknown journey`);
			for (const id of span.events ?? []) assert.ok(eventById.has(id), `${label}: unknown event "${id}"`);
			if (span.source === "corpus") {
				assert.ok(span.events?.length, `${label}: a corpus date must name its events`);
				assert.equal(span.start, signedYear(eventById.get(span.events[0]), "start"), `${label}: start no longer matches ${span.events[0]}`);
				if (span.events.length > 1) assert.equal(span.end, signedYear(eventById.get(span.events.at(-1)), "end"), `${label}: end no longer matches ${span.events.at(-1)}`);
			}
			if (span.source === "reigns") assert.ok(span.note, `${label}: say which reigns`);
		}
		for (const id of lane.events ?? []) assert.ok(eventById.has(id), `${lane.id}: unknown event "${id}"`);
		for (const entry of lane.undated ?? []) {
			for (const raw of entry.refs) kjvText(`${lane.id}/${entry.label}`, raw);
			if (entry.person) assert.ok(peopleIds.has(entry.person), `${lane.id}/${entry.label}: unknown person`);
		}
	}
});

test("the kings run on without overlap, Ussher's way, from the division to the captivities", () => {
	for (const id of ["israel", "judah"]) {
		const spans = BETA_TIMELINE_LANES.find((lane) => lane.id === id).spans;
		assert.equal(spans[0].start, -975, `${id} starts at the division`);
		for (let i = 1; i < spans.length; i++) {
			assert.ok(spans[i].start >= spans[i - 1].end, `${id}: ${spans[i].id} starts before ${spans[i - 1].id} ends`);
		}
	}
	const israel = BETA_TIMELINE_LANES.find((lane) => lane.id === "israel").spans;
	const judah = BETA_TIMELINE_LANES.find((lane) => lane.id === "judah").spans;
	assert.equal(israel.at(-1).end, -721, "Samaria taken in Hoshea's ninth year");
	assert.equal(judah.at(-1).end, -588, "Ussher levels Jerusalem in 588");
	assert.equal(judah.find((s) => s.id === "hezekiah").start, -726);
	// The corpus dates line up with the reigns they fall in.
	const reign = (spans, year) => activeSpans(spans, year).map((s) => s.id);
	assert.ok(reign(judah, signedYear(eventById.get("joash-hidden-and-crowned"), "start")).includes("joash"));
	assert.ok(reign(israel, signedYear(eventById.get("jehu-destroys-baal"), "start")).includes("jehu"));
	assert.ok(reign(judah, signedYear(eventById.get("hezekiahs-life-lengthened"), "start")).includes("hezekiah"));
	assert.ok(reign(israel, signedYear(eventById.get("israel-carried-to-assyria"), "start")).includes("hoshea"));
});

test("the eras follow the corpus: same nine in order, one continuous track, every dated event inside its era", () => {
	assert.deepEqual(BETA_ERA_SPANS.map((e) => e.era), [...ATLAS_ERAS]);
	for (let i = 0; i < BETA_ERA_SPANS.length; i++) {
		const era = BETA_ERA_SPANS[i];
		const scaleStart = i === 0 ? era.start : BETA_ERA_SPANS[i - 1].scaleEnd;
		assert.ok(era.scaleEnd > scaleStart, `${era.era}: empty on the track`);
		assert.ok(era.weight > 0);
	}
	assert.equal(BETA_ERA_SPANS[0].start, -4004);
	assert.equal(BETA_ERA_SPANS.at(-1).scaleEnd, 96);
	for (const event of events) {
		const date = event.date ?? eventDateFromLabel(event.yearLabel);
		if (date.provenance === "undated" || /^foretold/i.test(event.yearLabel)) continue;
		const era = BETA_ERA_SPANS.find((e) => e.era === event.era);
		assert.ok(date.startYear >= era.start && date.endYear <= era.end, `${event.id} (${event.yearLabel}) is outside ${era.era}`);
	}
});

/* ---------------------------------------------------------------- rules */

test("the basemap generator and the client agree on the projection", () => {
	const generator = read("../scripts/beta-atlas-basemap.mjs");
	for (const [name, key] of [
		["LON_MIN", "lonMin"],
		["LON_MAX", "lonMax"],
		["LAT_MIN", "latMin"],
		["LAT_MAX", "latMax"],
		["UNITS_PER_DEGREE", "unitsPerDegree"],
	]) {
		const match = generator.match(new RegExp(`const ${name} = (\\d+);`));
		assert.ok(match, `${name} missing from the generator`);
		assert.equal(Number(match[1]), BASEMAP_PROJECTION[key], `${name} differs`);
	}
	assert.match(generator, /const X_SCALE = Math\.cos\(\(34 \* Math\.PI\) \/ 180\);/);
	const basemapPath = fileURLToPath(new URL("../src/lib/beta/atlas/basemap.ts", import.meta.url));
	assert.ok(existsSync(basemapPath), "run node scripts/beta-atlas-basemap.mjs");
	const basemap = read("../src/lib/beta/atlas/basemap.ts");
	assert.equal(Number(basemap.match(/width: (\d+)/)[1]), Math.round(MAP_WIDTH));
	assert.equal(Number(basemap.match(/height: (\d+)/)[1]), Math.round(MAP_HEIGHT));
	assert.match(basemap, /Natural Earth/);
});

test("projection and camera: round trips, clamping and fitting", () => {
	const jerusalem = projectLonLat(35.2316, 31.7767);
	const rome = projectLonLat(12.4853, 41.8925);
	assert.ok(jerusalem.x > rome.x && jerusalem.y > rome.y, "Jerusalem is east and south of Rome");
	const viewport = { width: 375, height: 320 };
	const camera = fitPoints([jerusalem, rome], viewport, 40);
	for (const point of [jerusalem, rome]) {
		const screen = toScreen(point, camera, viewport);
		assert.ok(screen.x >= 39 && screen.x <= 336 && screen.y >= 0 && screen.y <= 320, "both ends in view");
		const back = toMap(screen, camera, viewport);
		assert.ok(Math.abs(back.x - point.x) < 1e-6 && Math.abs(back.y - point.y) < 1e-6);
	}
	const clamped = clampCamera({ cx: -9999, cy: 1e9, scale: 99 }, viewport);
	assert.equal(clamped.scale, MAX_SCALE);
	assert.ok(clamped.cx >= 0 && clamped.cy <= MAP_HEIGHT);
	assert.equal(clampCamera({ cx: 0, cy: 0, scale: 0 }, viewport).scale, minScale(viewport));
	const anchor = { x: 100, y: 120 };
	const before = toMap(anchor, camera, viewport);
	const zoomed = zoomAround(camera, viewport, 2, anchor);
	const after = toMap(anchor, zoomed, viewport);
	assert.ok(Math.abs(before.x - after.x) < 1e-6 && Math.abs(before.y - after.y) < 1e-6, "the point under the fingers stays put");
	const mid = interpolateCamera(camera, zoomed, 0.5);
	assert.ok(Number.isFinite(mid.scale) && mid.scale > 0);
	assert.deepEqual(interpolateCamera(camera, zoomed, 1), { ...zoomed, scale: interpolateCamera(camera, zoomed, 1).scale });
	assert.ok(Math.abs(interpolateCamera(camera, zoomed, 1).scale - zoomed.scale) < 1e-9);
	assert.deepEqual(fitPoints([], viewport).scale, minScale(viewport));
	// Uneven padding keeps the points clear of the side that needs more room.
	const padded = fitPoints([jerusalem], viewport, { left: 20, top: 20, right: 120, bottom: 40 }, 0.1);
	const onScreen = toScreen(jerusalem, padded, viewport);
	assert.ok(Math.abs(onScreen.x - (20 + (375 - 140) / 2)) < 1e-6, "centred in the padded box");
	assert.ok(Math.abs(onScreen.y - (20 + (320 - 60) / 2)) < 1e-6);
});

test("declutter keeps tap targets apart and lets the higher priority win", () => {
	const viewport = { width: 375, height: 300 };
	const shown = declutter(
		[
			{ id: "golgotha", x: 100, y: 100, priority: 3 },
			{ id: "jerusalem", x: 104, y: 102, priority: 1 },
			{ id: "bethany", x: 160, y: 100, priority: 3 },
			{ id: "offscreen", x: -200, y: 100, priority: 0 },
		],
		viewport,
		30
	);
	assert.deepEqual([...shown].sort(), ["bethany", "jerusalem"]);
	// Labels count: two names that would print over each other cannot both show.
	const labelled = declutter(
		[
			{ id: "egypt", x: 100, y: 200, priority: 2, box: labelBox("EGYPT", "area") },
			{ id: "red-sea", x: 130, y: 205, priority: 2, box: labelBox("Red Sea", "area") },
			{ id: "sidon", x: 200, y: 100, priority: 3, box: labelBox("Sidon", "point") },
			{ id: "damascus", x: 236, y: 104, priority: 3, box: labelBox("Damascus", "point") },
		],
		viewport,
		30
	);
	assert.deepEqual([...labelled].sort(), ["damascus", "egypt"]);
	assert.ok(labelBox("Jerusalem", "point").right > labelBox("Ur", "point").right);
});

test("a tall pane can still see the whole map: zoom out stops when the map fits, and it is centred", () => {
	const tall = { width: 375, height: 700 };
	const whole = clampCamera({ cx: 0, cy: 0, scale: 0 }, tall);
	assert.equal(whole.scale, Math.min(375 / MAP_WIDTH, 700 / MAP_HEIGHT));
	assert.equal(whole.cx, MAP_WIDTH / 2);
	assert.equal(whole.cy, MAP_HEIGHT / 2, "the map does not fill the height, so it sits in the middle");
	const rome = projectLonLat(12.4853, 41.8925);
	const ur = projectLonLat(46.1031, 30.9626);
	const fit = fitPoints([rome, ur], tall, 24);
	for (const point of [rome, ur]) {
		const screen = toScreen(point, fit, tall);
		assert.ok(screen.x >= 0 && screen.x <= tall.width, "Rome and Ur both on a phone");
	}
});

test("dates are labelled the corpus's way, with no year zero", () => {
	assert.equal(formatYear(-975), "975 BC");
	assert.equal(formatYear(30), "AD 30");
	assert.equal(formatYearSpan(-975, -958), "c. 975 - 958 BC");
	assert.equal(formatYearSpan(-4, 30), "c. 4 BC - AD 30");
	assert.equal(formatYearSpan(45, 48), "c. AD 45 - 48");
	assert.equal(formatYearSpan(-520, -520), "c. 520 BC");
	// The journeys are dated exactly as their corpus events are.
	const paul1 = eventById.get("first-missionary-journey");
	assert.equal(paul1.yearLabel, "c. AD 45 - 48");
	assert.equal(formatYearSpan(signedYear(paul1, "start"), signedYear(paul1, "end")), "c. AD 45 - 48");
});

test("the timeline scale gives each era its share and maps back", () => {
	const scale = buildTimelineScale([
		{ start: -4004, end: -1635, weight: 1 },
		{ start: -1635, end: -4, weight: 1 },
		{ start: -4, end: 96, weight: 2 },
	]);
	assert.equal(scale.toPosition(-4004), 0);
	assert.equal(scale.toPosition(96), 1);
	assert.ok(Math.abs(scale.toPosition(-1635) - 0.25) < 1e-9);
	assert.ok(Math.abs(scale.toPosition(-4) - 0.5) < 1e-9);
	for (const year of [-4004, -1491, -975, -588, -4, 30, 96]) assert.equal(scale.toYear(scale.toPosition(year)), year);
	assert.notEqual(scale.toYear(scale.toPosition(-1) + 0.0001), 0, "never lands on a year zero");
	assert.equal(scale.toYear(-5), -4004);
	assert.equal(scale.toYear(5), 96);
});

test("what is happening at a year, and stepping between starts", () => {
	const items = [
		{ id: "a", start: -975, end: -958 },
		{ id: "b", start: -958, end: -955 },
		{ id: "c", start: -910, end: -896 },
	];
	assert.deepEqual(activeSpans(items, -958).map((s) => s.id), ["a", "b"]);
	assert.deepEqual(activeSpans(items, -930), []);
	assert.deepEqual(nearestDated(items, -930, 2).map((s) => s.id), ["c", "b"]);
	assert.equal(stepToNext([-975, -958, -910], -960, 1), -958);
	assert.equal(stepToNext([-975, -958, -910], -960, -1), -975);
	assert.equal(stepToNext([-975], -975, -1), -975);
});

test("places named in a verse: longest name wins, punctuation and case ignored", () => {
	const places = [
		{ id: "antioch", names: ["Antioch"] },
		{ id: "antioch-in-pisidia", names: ["Antioch in Pisidia"] },
		{ id: "caesarea", names: ["Caesarea"] },
		{ id: "caesarea-philippi", names: ["Caesarea Philippi"] },
		{ id: "fair-havens", names: ["The fair havens", "Lasea"] },
		{ id: "cana", names: ["Cana"] },
	];
	assert.deepEqual(placesNamedIn("But when they departed from Perga, they came to Antioch in Pisidia, and went into the synagogue", places), ["antioch-in-pisidia"]);
	assert.deepEqual(placesNamedIn("When Jesus came into the coasts of Caesarea Philippi, he asked", places), ["caesarea-philippi"]);
	assert.deepEqual(placesNamedIn("Antioch; and Caesarea.", places), ["antioch", "caesarea"]);
	assert.deepEqual(placesNamedIn("unto a place which is called The fair havens; nigh whereunto was the city of Lasea.", places), ["fair-havens"]);
	assert.deepEqual(placesNamedIn("the land of Canaan", places), [], "Cana is not inside Canaan");
	assert.deepEqual(placesNamedIn("", places), []);
	assert.deepEqual(placesNamedIn("a mountain on the east of Beth-el", [{ id: "bethel", names: ["Bethel"] }]), ["bethel"], "KJV hyphenation");
	assert.deepEqual(nameTokens("encamped at Ezion-gaber."), ["encamped", "at", "eziongaber"]);
	// Every journey stop's verses find their own place through the same matcher the reader uses.
	for (const journey of BETA_JOURNEYS) {
		for (const stop of journey.stops) {
			if (stop.as) continue;
			const place = placeById.get(stop.place);
			const text = stop.refs.map((raw) => kjvText(stop.place, raw)).join(" ");
			assert.ok(placesNamedIn(text, [{ id: place.id, names: names(place) }]).includes(place.id), `${journey.id}/${stop.place}`);
		}
	}
});

test("the waypoint shape is the corpus's AtlasPlace shape, so promoting one is a copy", () => {
	const corpusKeys = new Set(corpusPlaces.flatMap((place) => Object.keys(place)));
	for (const place of BETA_ATLAS_WAYPOINTS) {
		for (const key of Object.keys(place)) assert.ok(corpusKeys.has(key), `${place.id}: "${key}" is not a corpus place field`);
	}
	assert.ok(waypointById.size >= 30);
});

test("the atlas URL: unknown values fall back, and a state survives a round trip", () => {
	const known = {
		journeys: BETA_JOURNEYS.map((j) => ({ id: j.id, stops: j.stops.length })),
		eras: [...ATLAS_ERAS],
		regions: ["world", "jerusalem"],
		places: new Set(["ephesus", "rome"]),
		events: new Map([["the-flood", -2348], ["the-trial-of-job", null]]),
		people: new Map([["david", 14], ["noah", 2]]),
		defaultJourney: "paul-2",
		defaultYear: -975,
	};
	const fallback = parseAtlasUrl({}, known);
	assert.deepEqual(fallback, { mode: "journeys", journey: "paul-2", stop: 0, year: -975, era: null, region: null, person: null, step: 0, selection: null });
	const junk = parseAtlasUrl({ journey: "paul-9", stop: "999", year: "0", era: "nope", region: "mars", place: "atlantis", mode: "maps", person: "goliath-of-ur", step: "3" }, known);
	assert.deepEqual(junk, fallback);
	const fromReader = parseAtlasUrl({ place: "ephesus" }, known);
	assert.equal(fromReader.mode, "places");
	assert.deepEqual(fromReader.selection, { kind: "place", id: "ephesus" });
	const fromEvent = parseAtlasUrl({ event: "the-flood" }, known);
	assert.equal(fromEvent.mode, "timeline");
	assert.equal(fromEvent.year, -2348, "an event opens the timeline at its year");
	assert.equal(parseAtlasUrl({ event: "the-trial-of-job" }, known).year, -975, "an undated event leaves the year alone");
	for (const state of [
		{ mode: "journeys", journey: "rome", stop: 7, year: -975, era: null, region: null, selection: { kind: "place", id: "rome" } },
		{ mode: "timeline", journey: "paul-2", stop: 0, year: -760, era: "Divided Kingdom", region: null, selection: { kind: "event", id: "the-flood" } },
		{ mode: "places", journey: "paul-2", stop: 0, year: -975, era: null, region: "jerusalem", selection: null },
		{ mode: "people", journey: "paul-2", stop: 0, year: -975, era: null, region: null, person: "david", step: 13, selection: { kind: "place", id: "rome" } },
		{ mode: "people", journey: "paul-2", stop: 0, year: -975, era: null, region: null, person: null, step: 0, selection: null },
	]) {
		const query = Object.fromEntries(new URLSearchParams(atlasUrlQuery(state)));
		const back = parseAtlasUrl(query, known);
		assert.equal(back.mode, state.mode);
		assert.deepEqual(back.selection, state.selection);
		if (state.mode === "journeys") assert.deepEqual([back.journey, back.stop], [state.journey, state.stop]);
		if (state.mode === "timeline") assert.deepEqual([back.year, back.era], [state.year, state.era]);
		if (state.mode === "places") assert.equal(back.region, state.region);
		if (state.mode === "people") assert.deepEqual([back.person, back.step], [state.person, state.step]);
	}
	// People (LC-17725): a person opens People at the first event; a step past the life, or one on no person, falls back.
	assert.deepEqual(pick(parseAtlasUrl({ person: "david" }, known)), ["people", "david", 0]);
	assert.deepEqual(pick(parseAtlasUrl({ mode: "people", person: "david", step: "15" }, known)), ["people", "david", 0]);
	assert.deepEqual(pick(parseAtlasUrl({ mode: "people", person: "noah", step: "2" }, known)), ["people", "noah", 1]);
	assert.deepEqual(pick(parseAtlasUrl({ mode: "people", step: "4" }, known)), ["people", null, 0]);
	assert.deepEqual(pick(parseAtlasUrl({ mode: "journeys", person: "david", step: "4" }, known)), ["journeys", null, 0], "another mode carries no person");
	assert.deepEqual(pick(parseAtlasUrl({ person: "David" }, known)), ["journeys", null, 0], "ids are exact");
	assert.equal(eraSlug("Creation & the Patriarchs"), "creation-the-patriarchs");
});

function pick(state) {
	return [state.mode, state.person, state.step];
}

test("People: every person has a life of corpus events, in the corpus's order", () => {
	const order = new Map(events.map((event, index) => [event.id, index]));
	for (const person of people) {
		const life = events.filter((event) => event.people.includes(person.id));
		assert.ok(life.length > 0, `${person.id} has no events to play`);
		const indexes = life.map((event) => order.get(event.id));
		assert.deepEqual(indexes, [...indexes].sort((a, b) => a - b), `${person.id}: the life plays in corpus order`);
	}
	const david = events.filter((event) => event.people.includes("david")).map((event) => event.id);
	assert.equal(david[0], "david-anointed");
	assert.equal(david.at(-1), "solomon-made-king");
});

test("People: a life's chapters are each chapter its events and the person cite, once, in life order", () => {
	const spans = (refs) => refs.map((ref) => parseAtlasRef(books, ref)).filter(Boolean);
	const life = (id) => events.filter((event) => event.people.includes(id));
	const david = people.find((person) => person.id === "david");
	const chapters = lifeChapters(life("david").map((event) => spans(event.refs)), spans(david.refs));
	assert.equal(chapters[0].key, "9.16");
	assert.equal(chapters[0].label, "1 Samuel 16");
	const elah = chapters.find((chapter) => chapter.label === "1 Samuel 17");
	assert.deepEqual(elah.events, [1], "David and Goliath is the life's second event");
	assert.equal(new Set(chapters.map((chapter) => chapter.key)).size, chapters.length, "each chapter once");
	// "Genesis 6-9" covers four chapters; the flood names Noah.
	const noah = lifeChapters(life("noah").map((event) => spans(event.refs)), []).map((chapter) => chapter.label);
	for (const label of ["Genesis 7", "Genesis 8"]) assert.ok(noah.includes(label), `Noah's life touches ${label}`);
	const range = lifeChapters([[parseAtlasRef(books, "Genesis 6-9")]], []);
	assert.deepEqual(range.map((chapter) => chapter.key), ["1.6", "1.7", "1.8", "1.9"]);
	assert.deepEqual(lifeChapters([], []), []);
	for (const person of people) {
		for (const chapter of lifeChapters(life(person.id).map((event) => spans(event.refs)), spans(person.refs))) {
			assert.match(chapter.key, /^\d{1,2}\.\d{1,3}$/, `${person.id}: ${chapter.key}`);
		}
	}
});

test("every region preset is framed by places on the map", async () => {
	const { ATLAS_REGIONS } = await import("../src/lib/beta/atlas/regions.ts");
	const ids = new Set();
	for (const region of ATLAS_REGIONS) {
		assert.ok(!ids.has(region.id), `region ${region.id} twice`);
		ids.add(region.id);
		assert.ok(region.places.length >= 2, `${region.id}: frame it with at least two places`);
		for (const id of region.places) assert.ok(BETA_ATLAS_GEO[id], `${region.id}: "${id}" is not on the map`);
	}
});

test("the timeline's date footnote names the corpus dates that differ from Ussher's Annals, as the corpus has them", () => {
	const ui = read("../src/components/beta/atlas/atlasUi.tsx");
	const note = ui.match(/export const TIMELINE_DATE_NOTE =\s*"([^"]+)"/)?.[1] ?? "";
	assert.equal(eventById.get("jerusalem-burnt").yearLabel, "c. 586 BC", "the corpus changed: update TIMELINE_DATE_NOTE");
	assert.equal(eventById.get("the-crucifixion").yearLabel, "c. AD 30", "the corpus changed: update TIMELINE_DATE_NOTE");
	assert.match(note, /586 BC/);
	assert.match(note, /AD 30/);
	assert.match(note, /588 BC and AD 33/, "Ussher's own years (Annals para. 850, and AD 33)");
});

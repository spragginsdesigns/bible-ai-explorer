// Validate the hand-authored Bible atlas (src/data/bible-atlas/*.json) against
// the bundled KJV text, then mirror it into the Android app.
//
//   node scripts/build-bible-atlas.mjs
//
// The atlas is written by hand rather than generated, so this script is what
// keeps it honest. It exits non-zero on the first sign of anything wrong:
//
//   - a reference that does not resolve to a real KJV book/chapter/verse;
//   - a duplicate or malformed id;
//   - an event pointing at a person or place that does not exist;
//   - a `related` id that does not exist;
//   - a relation with an unknown endpoint, type, certainty or reference;
//   - a person or place whose name (or one of its `alsoCalled` aliases) does
//     not actually appear in ANY of the verses it cites. That last check is
//     the one that catches invented Scripture: it reads the KJV text itself.
//
// On success it copies the four JSON files to mobile/src/data/bible-atlas/
// and `src/lib/bible/atlas-core.ts` to mobile/src/features/atlas/atlasCore.ts,
// so the phone and the server are never running different rules.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDir = path.join(root, "src", "data", "bible-atlas");
const kjvDir = path.join(root, "src", "data", "kjv");
const mobileDataDir = path.join(root, "mobile", "src", "data", "bible-atlas");
const mobileCorePath = path.join(root, "mobile", "src", "features", "atlas", "atlasCore.ts");
const corePath = path.join(root, "src", "lib", "bible", "atlas-core.ts");

const ERAS = [
	"Creation & the Patriarchs",
	"Egypt & the Exodus",
	"Conquest & Judges",
	"United Kingdom",
	"Divided Kingdom",
	"Exile & Return",
	"Between the Testaments",
	"Life of Christ",
	"The Early Church",
];

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const errors = [];
function fail(message) {
	errors.push(message);
}

function readJson(file) {
	return JSON.parse(fs.readFileSync(file, "utf8"));
}

/* --------------------------------------------------------------- the KJV */

const books = readJson(path.join(root, "src", "data", "books.json"));
const bookByName = new Map();
for (const book of books) {
	bookByName.set(normalize(book.name), book);
	bookByName.set(normalize(book.abbr), book);
}
bookByName.set("psalm", bookByName.get("psalms"));
bookByName.set("song of songs", bookByName.get("song of solomon"));

const chapterCache = new Map();
/** Verses of one chapter as an array of strings, straight off the bundle. */
function kjvChapter(order, chapter) {
	let bookText = chapterCache.get(order);
	if (!bookText) {
		const meta = books.find((candidate) => candidate.order === order);
		bookText = readJson(path.join(kjvDir, meta.file));
		chapterCache.set(order, bookText);
	}
	return bookText[chapter - 1] ?? null;
}

function normalize(value) {
	return String(value)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

const REF_PATTERN =
	/^([1-3]\s*)?([a-zA-Z][a-zA-Z. ]*?)\s+(\d+)(?::(\d+))?(?:\s*[---]\s*(\d+)(?::(\d+))?)?$/;

/**
 * Parse and fully bounds-check one authored reference against the KJV text.
 * Mirrors `parseAtlasRef` in src/lib/bible/atlas-core.ts, but goes further:
 * it opens the chapter and checks the verse numbers really exist.
 */
function resolveRef(raw) {
	const match = String(raw).trim().match(REF_PATTERN);
	if (!match) return { error: "is not a reference this app can parse" };

	const [, leadingDigit, namePart, chapterPart, versePart, endPart, endVersePart] = match;
	const name = `${leadingDigit ? `${leadingDigit.trim()} ` : ""}${namePart}`;
	const book = bookByName.get(normalize(name));
	if (!book) return { error: `names no book of the KJV ("${name.trim()}")` };

	const chapter = Number.parseInt(chapterPart, 10);
	if (chapter < 1 || chapter > book.chapters) {
		return { error: `has no chapter ${chapter} (${book.name} has ${book.chapters})` };
	}

	const verses = kjvChapter(book.order, chapter);
	if (!verses) return { error: `has no chapter ${chapter} in the bundled text` };

	// Whole chapter.
	if (versePart === undefined && endPart === undefined) {
		return { order: book.order, book: book.name, chapter, endChapter: chapter };
	}

	// Chapter range.
	if (versePart === undefined) {
		if (endVersePart !== undefined) return { error: "mixes a chapter range with a verse" };
		const endChapter = Number.parseInt(endPart, 10);
		if (endChapter <= chapter || endChapter > book.chapters) {
			return { error: `has no chapter range ${chapter}-${endChapter}` };
		}
		return { order: book.order, book: book.name, chapter, endChapter };
	}

	const verse = Number.parseInt(versePart, 10);
	if (verse < 1 || verse > verses.length) {
		return { error: `has no verse ${verse} (${book.name} ${chapter} has ${verses.length})` };
	}

	if (endPart === undefined) {
		return { order: book.order, book: book.name, chapter, verse, endChapter: chapter, endVerse: verse };
	}

	const endFirst = Number.parseInt(endPart, 10);
	if (endVersePart === undefined) {
		if (endFirst <= verse) return { error: `has a backwards verse range ${verse}-${endFirst}` };
		if (endFirst > verses.length) {
			return { error: `has no verse ${endFirst} (${book.name} ${chapter} has ${verses.length})` };
		}
		return {
			order: book.order,
			book: book.name,
			chapter,
			verse,
			endChapter: chapter,
			endVerse: endFirst,
		};
	}

	const endVerse = Number.parseInt(endVersePart, 10);
	if (endFirst < chapter || endFirst > book.chapters) {
		return { error: `has no chapter ${endFirst}` };
	}
	if (endFirst === chapter && endVerse <= verse) {
		return { error: `has a backwards verse range` };
	}
	const endVerses = kjvChapter(book.order, endFirst);
	if (!endVerses || endVerse > endVerses.length) {
		return { error: `has no verse ${endFirst}:${endVerse}` };
	}
	return { order: book.order, book: book.name, chapter, verse, endChapter: endFirst, endVerse };
}

/** Every verse of text a resolved reference covers, joined into one string. */
function refText(ref) {
	const parts = [];
	for (let chapter = ref.chapter; chapter <= ref.endChapter; chapter++) {
		const verses = kjvChapter(ref.order, chapter);
		if (!verses) continue;
		const from = chapter === ref.chapter && ref.verse ? ref.verse : 1;
		const to =
			chapter === ref.endChapter && ref.endVerse !== undefined ? ref.endVerse : verses.length;
		for (let verse = from; verse <= to; verse++) {
			if (verses[verse - 1]) parts.push(verses[verse - 1]);
		}
	}
	return parts.join(" ");
}

/** Whole-word/phrase containment on normalized text: "beer sheba" in "…". */
function mentions(text, name) {
	const haystack = ` ${normalize(text)} `;
	const needle = normalize(name);
	return needle.length > 0 && haystack.includes(` ${needle} `);
}

/* ----------------------------------------------------------- the checking */

function checkRefs(label, refs) {
	const resolved = [];
	if (!Array.isArray(refs) || refs.length === 0) {
		fail(`${label}: needs at least one reference`);
		return resolved;
	}
	for (const raw of refs) {
		if (typeof raw !== "string" || !raw.trim()) {
			fail(`${label}: has an empty reference`);
			continue;
		}
		const ref = resolveRef(raw);
		if (ref.error) fail(`${label}: "${raw}" ${ref.error}`);
		else resolved.push(ref);
	}
	return resolved;
}

function checkText(label, field, value, { min = 1, max = 400 } = {}) {
	if (typeof value !== "string" || value.trim().length < min) {
		fail(`${label}: ${field} is missing`);
		return;
	}
	if (value.length > max) fail(`${label}: ${field} is longer than ${max} characters`);
}

function checkIds(label, kind, ids, known) {
	if (!Array.isArray(ids)) {
		fail(`${label}: ${kind} must be a list`);
		return;
	}
	for (const id of ids) {
		if (!known.has(id)) fail(`${label}: ${kind} names "${id}", which does not exist`);
	}
	if (new Set(ids).size !== ids.length) fail(`${label}: ${kind} lists the same id twice`);
}

const events = readJson(path.join(dataDir, "events.json"));
const people = readJson(path.join(dataDir, "people.json"));
const places = readJson(path.join(dataDir, "places.json"));
const relationsPath = path.join(dataDir, "relations.json");
const relations = fs.existsSync(relationsPath) ? readJson(relationsPath) : [];

const personIds = new Set();
const placeIds = new Set();
const eventIds = new Set();
const relationIds = new Set();

for (const [list, ids, kind] of [
	[events, eventIds, "event"],
	[people, personIds, "person"],
	[places, placeIds, "place"],
]) {
	if (!Array.isArray(list)) {
		fail(`${kind}s: the file is not a list`);
		continue;
	}
	for (const entry of list) {
		const id = entry?.id;
		if (typeof id !== "string" || !ID_PATTERN.test(id)) {
			fail(`${kind} "${id}": ids must be kebab-case`);
			continue;
		}
		if (ids.has(id)) fail(`${kind} "${id}": duplicate id`);
		ids.add(id);
	}
}

// Relations are reviewed edges between atlas entities. Keep this validation
// optional until a checkout has adopted relations.json, but strict when it is
// present so graph helpers never receive a dangling or malformed edge.
const entityIds = new Set([...personIds, ...placeIds]);
const relationTypes = new Set([
	"parent",
	"spouse",
	"sibling",
	"mentor",
	"disciple",
	"companion",
	"associated-place",
	"associated",
]);
const relationCertainties = new Set(["explicit", "inferred", "disputed"]);
if (!Array.isArray(relations)) {
	fail("relations: the file is not a list");
} else {
	for (const relation of relations) {
		const label = `relation "${relation?.id}"`;
		if (typeof relation?.id !== "string" || !ID_PATTERN.test(relation.id)) {
			fail(`${label}: ids must be kebab-case`);
		} else if (relationIds.has(relation.id)) {
			fail(`${label}: duplicate id`);
		} else {
			relationIds.add(relation.id);
		}
		if (!entityIds.has(relation?.from)) fail(`${label}: from names a missing entity "${relation?.from}"`);
		if (!entityIds.has(relation?.to)) fail(`${label}: to names a missing entity "${relation?.to}"`);
		if (!relationTypes.has(relation?.type)) fail(`${label}: type "${relation?.type}" is not supported`);
		if (!relationCertainties.has(relation?.certainty)) {
			fail(`${label}: certainty "${relation?.certainty}" is not supported`);
		}
		checkRefs(label, relation?.refs);
		if (relation?.from === relation?.to) fail(`${label}: relates an entity to itself`);
	}
}

// People and places: names must be real, and the Scripture cited must name them.
for (const [list, kind] of [
	[people, "person"],
	[places, "place"],
]) {
	for (const entry of list) {
		const label = `${kind} "${entry.id}"`;
		checkText(label, "name", entry.name, { max: 60 });
		checkText(label, "description", entry.description, { min: 20, max: 400 });
		if (entry.alsoCalled !== undefined && !Array.isArray(entry.alsoCalled)) {
			fail(`${label}: alsoCalled must be a list`);
		}
		if (kind === "person") {
			if (!ERAS.includes(entry.era)) fail(`${label}: era "${entry.era}" is not one of the nine`);
			if (entry.disambiguator !== undefined) {
				checkText(label, "disambiguator", entry.disambiguator, { max: 80 });
			}
			checkIds(label, "related", entry.related, new Set([...personIds, ...placeIds]));
			if (entry.related.includes(entry.id)) fail(`${label}: is related to itself`);
		} else if (entry.modernRegion !== undefined && typeof entry.modernRegion !== "string") {
			fail(`${label}: modernRegion must be a string when present`);
		}

		const resolved = checkRefs(label, entry.refs);
		if (resolved.length === 0) continue;

		const names = [entry.name, ...(entry.alsoCalled ?? [])];
		const named = resolved.some((ref) => {
			const text = refText(ref);
			return names.some((name) => mentions(text, name));
		});
		if (!named) {
			fail(
				`${label}: none of its verses actually contain "${names.join('" / "')}" - ` +
					`either the references are wrong or the name needs an alsoCalled the KJV uses`
			);
		}
	}
}

// People sharing a visible name must explain the difference wherever they are
// listed or searched. Distinct disambiguators keep the client from guessing.
const peopleByName = new Map();
for (const person of people) {
	const key = normalize(person.name);
	peopleByName.set(key, [...(peopleByName.get(key) ?? []), person]);
}
for (const sameName of peopleByName.values()) {
	if (sameName.length < 2) continue;
	const labels = sameName.map((person) => normalize(person.disambiguator ?? ""));
	if (labels.some((label) => !label)) {
		fail(`people named "${sameName[0].name}": every duplicate needs a disambiguator`);
	}
	if (new Set(labels).size !== labels.length) {
		fail(`people named "${sameName[0].name}": disambiguators must be distinct`);
	}
}

// Events: valid era, valid references, and every entity it names must exist.
let lastEra = -1;
for (const event of events) {
	const label = `event "${event.id}"`;
	checkText(label, "title", event.title, { max: 90 });
	checkText(label, "summary", event.summary, { min: 20, max: 400 });
	checkText(label, "yearLabel", event.yearLabel, { max: 40 });
	const era = ERAS.indexOf(event.era);
	if (era === -1) {
		fail(`${label}: era "${event.era}" is not one of the nine`);
	} else if (era < lastEra) {
		fail(`${label}: is filed under ${event.era} but comes after a later era - keep events in order`);
	} else {
		lastEra = era;
	}
	checkRefs(label, event.refs);
	checkIds(label, "people", event.people, personIds);
	checkIds(label, "places", event.places, placeIds);
}

// Anything nothing points at is dead weight, not an error - but say so.
const usedPeople = new Set(events.flatMap((event) => event.people));
const usedPlaces = new Set(events.flatMap((event) => event.places));
const orphanPeople = [...personIds].filter((id) => !usedPeople.has(id));
const orphanPlaces = [...placeIds].filter((id) => !usedPlaces.has(id));

/* ------------------------------------------------------------------ write */

if (errors.length > 0) {
	console.error(`\nThe Bible atlas is not valid (${errors.length} problem(s)):\n`);
	for (const message of errors) console.error(`  - ${message}`);
	console.error("");
	process.exit(1);
}

fs.mkdirSync(mobileDataDir, { recursive: true });
fs.mkdirSync(path.dirname(mobileCorePath), { recursive: true });
for (const file of ["events.json", "people.json", "places.json"]) {
	fs.copyFileSync(path.join(dataDir, file), path.join(mobileDataDir, file));
}
if (fs.existsSync(relationsPath)) fs.copyFileSync(relationsPath, path.join(mobileDataDir, "relations.json"));

const banner = `// GENERATED FILE - do not edit.
// Copied from src/lib/bible/atlas-core.ts by scripts/build-bible-atlas.mjs so
// the phone and the server rank, group and resolve the atlas identically.
// Edit the source file and re-run: node scripts/build-bible-atlas.mjs
`;
fs.writeFileSync(mobileCorePath, `${banner}${fs.readFileSync(corePath, "utf8")}`, "utf8");

const refCount =
	events.reduce((total, event) => total + event.refs.length, 0) +
	people.reduce((total, person) => total + person.refs.length, 0) +
	places.reduce((total, place) => total + place.refs.length, 0);

console.log(
	`Bible atlas OK: ${events.length} events, ${people.length} people, ${places.length} places, ` +
		`${relations.length} relations, ${refCount} references all resolved against the KJV.`
);
if (orphanPeople.length > 0) {
	console.log(`  note: ${orphanPeople.length} people are in no event (${orphanPeople.join(", ")})`);
}
if (orphanPlaces.length > 0) {
	console.log(`  note: ${orphanPlaces.length} places are in no event (${orphanPlaces.join(", ")})`);
}
console.log(`  mirrored to ${path.relative(root, mobileDataDir)} and ${path.relative(root, mobileCorePath)}`);

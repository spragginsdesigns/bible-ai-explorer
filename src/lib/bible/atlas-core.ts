/**
 * Pure logic for the Bible atlas (timeline, people and places).
 *
 * This module deliberately has NO imports at all. Three things depend on that:
 *   - `scripts/build-bible-atlas.mjs` copies it verbatim to
 *     `mobile/src/features/atlas/atlasCore.ts`, so the phone and the server
 *     rank, group and resolve identically instead of drifting apart;
 *   - `tests/bible-atlas.test.mjs` imports it straight from node;
 *   - `src/lib/bible/atlas.ts` wraps it with the lazily-loaded JSON.
 *
 * Everything here takes its data as arguments. Nothing here reads Scripture -
 * counting verses that name someone lives in `atlas.ts`, which has the KJV.
 */

/** The nine spans the timeline is divided into, in chronological order. */
export const ATLAS_ERAS = [
	"Creation & the Patriarchs",
	"Egypt & the Exodus",
	"Conquest & Judges",
	"United Kingdom",
	"Divided Kingdom",
	"Exile & Return",
	"Between the Testaments",
	"Life of Christ",
	"The Early Church",
] as const;

export type AtlasEra = (typeof ATLAS_ERAS)[number];

/** One dated event, as authored in `src/data/bible-atlas/events.json`. */
export interface AtlasEvent {
	id: string;
	title: string;
	era: AtlasEra;
	/** Ussher's traditional dating, e.g. "c. 4004 BC". See the data README. */
	yearLabel: string;
	summary: string;
	refs: string[];
	people: string[];
	places: string[];
}

export interface AtlasPerson {
	id: string;
	name: string;
	alsoCalled?: string[];
	description: string;
	era: AtlasEra;
	refs: string[];
	related: string[];
}

export interface AtlasPlace {
	id: string;
	name: string;
	alsoCalled?: string[];
	description: string;
	refs: string[];
	modernRegion?: string;
}

export interface AtlasData {
	events: AtlasEvent[];
	people: AtlasPerson[];
	places: AtlasPlace[];
}

/** The book fields ref parsing needs; both clients' Book type satisfies it. */
export interface AtlasBook {
	order: number;
	name: string;
	abbr: string;
	chapters: number;
}

/** A parsed "Genesis 6:9-22" / "Genesis 6-9" / "Genesis 6" reference. */
export interface AtlasRef {
	/** The reference exactly as it was authored, for display. */
	label: string;
	order: number;
	book: string;
	chapter: number;
	/** Absent for a whole-chapter reference. */
	verse?: number;
	endChapter: number;
	endVerse?: number;
}

export type AtlasEntityKind = "person" | "place";

/** An entity reduced to what a chip needs. */
export interface AtlasEntityRef {
	id: string;
	kind: AtlasEntityKind;
	name: string;
}

/** An event with its people and places resolved into chips. */
export interface AtlasEventView {
	id: string;
	title: string;
	era: AtlasEra;
	yearLabel: string;
	summary: string;
	refs: string[];
	people: AtlasEntityRef[];
	places: AtlasEntityRef[];
}

/** A person or place with everything the detail screen shows. */
export interface AtlasEntityView {
	id: string;
	kind: AtlasEntityKind;
	name: string;
	alsoCalled: string[];
	description: string;
	/** People only - a place is not tied to one era. */
	era: AtlasEra | null;
	/** Places only, and only where Scripture makes it certain. */
	modernRegion: string | null;
	refs: string[];
	related: AtlasEntityRef[];
	events: { id: string; title: string; era: AtlasEra; yearLabel: string }[];
}

export type AtlasHitKind = AtlasEntityKind | "event";

export interface AtlasSearchHit {
	id: string;
	kind: AtlasHitKind;
	name: string;
	description: string;
	era: AtlasEra | null;
	yearLabel: string | null;
	refs: string[];
	score: number;
}

export interface AtlasChapterView {
	people: AtlasEntityRef[];
	places: AtlasEntityRef[];
	events: AtlasEventView[];
}

/* ------------------------------------------------------------------ names */

/** Lowercase, strip punctuation, collapse whitespace: "Beer-sheba" → "beer sheba". */
export function normalizeAtlasName(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

function tokens(value: string): string[] {
	const normalized = normalizeAtlasName(value);
	return normalized ? normalized.split(" ") : [];
}

/** True when every word of `query` appears as a word of `candidate`. */
function coversTokens(candidate: string, query: string): boolean {
	const candidateTokens = new Set(tokens(candidate));
	const queryTokens = tokens(query);
	if (queryTokens.length === 0) return false;
	return queryTokens.every((token) => candidateTokens.has(token));
}

/* ------------------------------------------------------------- references */

const REF_PATTERN =
	/^([1-3]\s*)?([a-zA-Z][a-zA-Z. ]*?)\s+(\d+)(?::(\d+))?(?:\s*[---]\s*(\d+)(?::(\d+))?)?$/;

/** Extra book aliases the atlas data may use, matching `books.ts`. */
const BOOK_ALIASES: Record<string, string> = {
	psalm: "Psalms",
	"song of songs": "Song of Solomon",
	"canticles": "Song of Solomon",
};

function buildBookIndex(books: readonly AtlasBook[]): Map<string, AtlasBook> {
	const index = new Map<string, AtlasBook>();
	for (const book of books) {
		index.set(normalizeAtlasName(book.name), book);
		index.set(normalizeAtlasName(book.abbr), book);
	}
	for (const [alias, name] of Object.entries(BOOK_ALIASES)) {
		const book = books.find((candidate) => candidate.name === name);
		if (book) index.set(normalizeAtlasName(alias), book);
	}
	return index;
}

const bookIndexCache = new WeakMap<readonly AtlasBook[], Map<string, AtlasBook>>();

function bookIndex(books: readonly AtlasBook[]): Map<string, AtlasBook> {
	const cached = bookIndexCache.get(books);
	if (cached) return cached;
	const built = buildBookIndex(books);
	bookIndexCache.set(books, built);
	return built;
}

/**
 * Parse one authored reference. Four shapes are accepted, and nothing else:
 * "Genesis 1" (whole chapter), "Genesis 1:1" (one verse), "Genesis 1:1-5"
 * (verses within a chapter) and "Genesis 6-9" (whole chapters).
 *
 * Chapter bounds are checked here; verse bounds need the text itself and are
 * checked by `scripts/build-bible-atlas.mjs`, which is what keeps the data
 * honest. Returns null when the reference cannot be resolved.
 */
export function parseAtlasRef(books: readonly AtlasBook[], input: string): AtlasRef | null {
	const label = input.trim();
	const match = label.match(REF_PATTERN);
	if (!match) return null;

	const [, leadingDigit, namePart, chapterPart, versePart, endPart, endVersePart] = match;
	const name = `${leadingDigit ? `${leadingDigit.trim()} ` : ""}${namePart}`;
	const book = bookIndex(books).get(normalizeAtlasName(name));
	if (!book) return null;

	const chapter = Number.parseInt(chapterPart, 10);
	if (!Number.isInteger(chapter) || chapter < 1 || chapter > book.chapters) return null;

	// "Genesis 1" - the whole chapter.
	if (versePart === undefined && endPart === undefined) {
		return { label, order: book.order, book: book.name, chapter, endChapter: chapter };
	}

	// "Genesis 6-9" - a run of whole chapters.
	if (versePart === undefined) {
		const endChapter = Number.parseInt(endPart as string, 10);
		if (endVersePart !== undefined) return null;
		if (!Number.isInteger(endChapter) || endChapter <= chapter || endChapter > book.chapters) {
			return null;
		}
		return { label, order: book.order, book: book.name, chapter, endChapter };
	}

	const verse = Number.parseInt(versePart, 10);
	if (!Number.isInteger(verse) || verse < 1) return null;

	// "Genesis 1:1" - one verse.
	if (endPart === undefined) {
		return {
			label,
			order: book.order,
			book: book.name,
			chapter,
			verse,
			endChapter: chapter,
			endVerse: verse,
		};
	}

	// "Genesis 1:1-5" (same chapter) or "Genesis 1:1-2:3" (across chapters).
	const endFirst = Number.parseInt(endPart, 10);
	if (!Number.isInteger(endFirst)) return null;
	if (endVersePart === undefined) {
		if (endFirst <= verse) return null;
		return {
			label,
			order: book.order,
			book: book.name,
			chapter,
			verse,
			endChapter: chapter,
			endVerse: endFirst,
		};
	}
	const endVerse = Number.parseInt(endVersePart, 10);
	if (!Number.isInteger(endVerse) || endVerse < 1) return null;
	if (endFirst < chapter || endFirst > book.chapters) return null;
	if (endFirst === chapter && endVerse <= verse) return null;
	return {
		label,
		order: book.order,
		book: book.name,
		chapter,
		verse,
		endChapter: endFirst,
		endVerse,
	};
}

/** Does a parsed reference cover any part of this chapter? */
export function refTouchesChapter(ref: AtlasRef, order: number, chapter: number): boolean {
	if (ref.order !== order) return false;
	return chapter >= ref.chapter && chapter <= ref.endChapter;
}

/** The chapter a reference opens at, for "open this in the reader" chips. */
export function refOpensAt(ref: AtlasRef): { order: number; chapter: number; verse: number | null } {
	return { order: ref.order, chapter: ref.chapter, verse: ref.verse ?? null };
}

/* ------------------------------------------------------------------ views */

function personRef(person: AtlasPerson): AtlasEntityRef {
	return { id: person.id, kind: "person", name: person.name };
}

function placeRef(place: AtlasPlace): AtlasEntityRef {
	return { id: place.id, kind: "place", name: place.name };
}

/** Resolve an event's people/place ids into chips, dropping any that vanished. */
export function toEventView(data: AtlasData, event: AtlasEvent): AtlasEventView {
	const people = event.people.flatMap((id) => {
		const person = data.people.find((candidate) => candidate.id === id);
		return person ? [personRef(person)] : [];
	});
	const places = event.places.flatMap((id) => {
		const place = data.places.find((candidate) => candidate.id === id);
		return place ? [placeRef(place)] : [];
	});
	return {
		id: event.id,
		title: event.title,
		era: event.era,
		yearLabel: event.yearLabel,
		summary: event.summary,
		refs: event.refs,
		people,
		places,
	};
}

/** A person or place with its related entities and the events it appears in. */
export function getEntityView(data: AtlasData, id: string): AtlasEntityView | null {
	const person = data.people.find((candidate) => candidate.id === id);
	const place = person ? null : data.places.find((candidate) => candidate.id === id);
	if (!person && !place) return null;

	const events = data.events
		.filter((event) => (person ? event.people.includes(id) : event.places.includes(id)))
		.map((event) => ({
			id: event.id,
			title: event.title,
			era: event.era,
			yearLabel: event.yearLabel,
		}));

	if (person) {
		const related = person.related.flatMap((relatedId): AtlasEntityRef[] => {
			const other = data.people.find((candidate) => candidate.id === relatedId);
			if (other) return [personRef(other)];
			const otherPlace = data.places.find((candidate) => candidate.id === relatedId);
			return otherPlace ? [placeRef(otherPlace)] : [];
		});
		return {
			id: person.id,
			kind: "person",
			name: person.name,
			alsoCalled: person.alsoCalled ?? [],
			description: person.description,
			era: person.era,
			modernRegion: null,
			refs: person.refs,
			related,
			events,
		};
	}

	const found = place as AtlasPlace;
	return {
		id: found.id,
		kind: "place",
		name: found.name,
		alsoCalled: found.alsoCalled ?? [],
		description: found.description,
		era: null,
		modernRegion: found.modernRegion ?? null,
		refs: found.refs,
		related: [],
		events,
	};
}

/* ----------------------------------------------------------------- search */

interface Candidate {
	value: string;
	primary: boolean;
}

/** Best score any of an entry's names earns against the query, or 0 for none. */
function scoreNames(candidates: Candidate[], query: string): number {
	const normalizedQuery = normalizeAtlasName(query);
	if (!normalizedQuery) return 0;
	let best = 0;
	for (const candidate of candidates) {
		const normalized = normalizeAtlasName(candidate.value);
		if (!normalized) continue;
		let score = 0;
		if (normalized === normalizedQuery) score = candidate.primary ? 100 : 92;
		else if (normalized.startsWith(`${normalizedQuery} `)) score = candidate.primary ? 80 : 72;
		else if (normalized.startsWith(normalizedQuery)) score = candidate.primary ? 74 : 66;
		else if (normalized.includes(normalizedQuery)) score = candidate.primary ? 60 : 52;
		else if (coversTokens(normalized, normalizedQuery)) score = candidate.primary ? 45 : 38;
		if (score > best) best = score;
	}
	return best;
}

/**
 * Rank people, places and events by how well their name, alias or title
 * matches the query. People edge out places and places edge out events at the
 * same score, because "who is X" is what the query nearly always means.
 * Ties break on the shorter name, then on id, so results never reshuffle.
 */
export function searchAtlasData(data: AtlasData, query: string, limit = 10): AtlasSearchHit[] {
	const trimmed = query.trim();
	if (!trimmed) return [];

	const hits: AtlasSearchHit[] = [];

	for (const person of data.people) {
		const score = scoreNames(
			[
				{ value: person.name, primary: true },
				...(person.alsoCalled ?? []).map((value) => ({ value, primary: false })),
			],
			trimmed
		);
		if (score > 0) {
			hits.push({
				id: person.id,
				kind: "person",
				name: person.name,
				description: person.description,
				era: person.era,
				yearLabel: null,
				refs: person.refs,
				score: score + 2,
			});
		}
	}

	for (const place of data.places) {
		const score = scoreNames(
			[
				{ value: place.name, primary: true },
				...(place.alsoCalled ?? []).map((value) => ({ value, primary: false })),
			],
			trimmed
		);
		if (score > 0) {
			hits.push({
				id: place.id,
				kind: "place",
				name: place.name,
				description: place.description,
				era: null,
				yearLabel: null,
				refs: place.refs,
				score: score + 1,
			});
		}
	}

	for (const event of data.events) {
		const score = scoreNames([{ value: event.title, primary: true }], trimmed);
		if (score > 0) {
			hits.push({
				id: event.id,
				kind: "event",
				name: event.title,
				description: event.summary,
				era: event.era,
				yearLabel: event.yearLabel,
				refs: event.refs,
				score,
			});
		}
	}

	hits.sort(
		(a, b) =>
			b.score - a.score || a.name.length - b.name.length || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
	);
	return hits.slice(0, Math.max(1, limit));
}

/* --------------------------------------------------------------- timeline */

/** Where an era sits on the timeline, or -1 for a value that is not an era. */
export function eraIndex(era: string): number {
	return (ATLAS_ERAS as readonly string[]).indexOf(era);
}

export interface AtlasEraGroup {
	era: AtlasEra;
	events: AtlasEventView[];
}

/**
 * Group events into their eras, in chronological order, keeping the order the
 * data file authored them in inside each era. Empty eras are dropped.
 */
export function groupEventsByEra(
	data: AtlasData,
	events: readonly AtlasEvent[]
): AtlasEraGroup[] {
	const groups: AtlasEraGroup[] = [];
	for (const era of ATLAS_ERAS) {
		const inEra = events.filter((event) => event.era === era);
		if (inEra.length === 0) continue;
		groups.push({ era, events: inEra.map((event) => toEventView(data, event)) });
	}
	return groups;
}

export interface TimelineQuery {
	era?: string;
	/** Book order 1-66; with `chapter`, narrows to events touching it. */
	book?: number;
	chapter?: number;
	/** Only events this person takes part in. */
	personId?: string;
}

/**
 * The events a timeline request asks for, in chronological (file) order. An
 * empty query is the whole timeline. A book without a chapter means every
 * event whose references fall anywhere in that book.
 */
export function selectTimelineEvents(
	data: AtlasData,
	books: readonly AtlasBook[],
	query: TimelineQuery
): AtlasEvent[] {
	return data.events.filter((event) => {
		if (query.era && event.era !== query.era) return false;
		if (query.personId && !event.people.includes(query.personId)) return false;
		if (query.book) {
			const touches = event.refs.some((raw) => {
				const ref = parseAtlasRef(books, raw);
				if (!ref || ref.order !== query.book) return false;
				if (!query.chapter) return true;
				return refTouchesChapter(ref, query.book, query.chapter);
			});
			if (!touches) return false;
		}
		return true;
	});
}

/**
 * Who and where a chapter is about: every person and place one of whose key
 * references falls inside the chapter, plus the events that touch it.
 */
export function whoIsInChapter(
	data: AtlasData,
	books: readonly AtlasBook[],
	order: number,
	chapter: number
): AtlasChapterView {
	const inChapter = (refs: readonly string[]): boolean =>
		refs.some((raw) => {
			const ref = parseAtlasRef(books, raw);
			return ref ? refTouchesChapter(ref, order, chapter) : false;
		});

	const events = selectTimelineEvents(data, books, { book: order, chapter });
	const fromEvents = new Set<string>();
	for (const event of events) {
		for (const id of event.people) fromEvents.add(id);
		for (const id of event.places) fromEvents.add(id);
	}

	const people = data.people
		.filter((person) => inChapter(person.refs) || fromEvents.has(person.id))
		.map(personRef);
	const places = data.places
		.filter((place) => inChapter(place.refs) || fromEvents.has(place.id))
		.map(placeRef);

	return { people, places, events: events.map((event) => toEventView(data, event)) };
}

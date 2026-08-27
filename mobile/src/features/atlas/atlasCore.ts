// GENERATED FILE - do not edit.
// Copied from src/lib/bible/atlas-core.ts by scripts/build-bible-atlas.mjs so
// the phone and the server rank, group and resolve the atlas identically.
// Edit the source file and re-run: node scripts/build-bible-atlas.mjs
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

export type AtlasDateProvenance =
	| "traditional-ussher"
	| "scripture-explicit"
	| "undated";

/** A display label plus an optional signed year range (BC is negative). */
export interface AtlasEventDate {
	label: string;
	startYear?: number;
	endYear?: number;
	provenance: AtlasDateProvenance;
}

export type AtlasRelationType =
	| "parent"
	| "spouse"
	| "sibling"
	| "mentor"
	| "disciple"
	| "companion"
	| "associated-place"
	| "associated";

export type AtlasRelationCertainty = "explicit" | "inferred" | "disputed";

/** A reviewed edge in the atlas graph. `from` and `to` are atlas entity ids. */
export interface AtlasRelation {
	id: string;
	from: string;
	to: string;
	type: AtlasRelationType;
	refs: string[];
	certainty: AtlasRelationCertainty;
}

/** One dated event, as authored in `src/data/bible-atlas/events.json`. */
export interface AtlasEvent {
	id: string;
	title: string;
	era: AtlasEra;
	/** Ussher's traditional dating, e.g. "c. 4004 BC". See the data README. */
	yearLabel: string;
	/** Optional structured date; old event data is upgraded from `yearLabel`. */
	date?: AtlasEventDate;
	summary: string;
	refs: string[];
	people: string[];
	places: string[];
}

export interface AtlasPerson {
	id: string;
	name: string;
	disambiguator?: string;
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
	relations: AtlasRelation[];
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
	disambiguator?: string;
}

/** Stable, list-friendly representation of a person or place. */
export interface AtlasEntitySummary {
	id: string;
	kind: AtlasEntityKind;
	name: string;
	disambiguator?: string;
	description: string;
	alsoCalled: string[];
	era: AtlasEra | null;
	modernRegion: string | null;
}

/** An event with its people and places resolved into chips. */
export interface AtlasEventView {
	id: string;
	title: string;
	era: AtlasEra;
	yearLabel: string;
	date: AtlasEventDate;
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
	disambiguator: string | null;
	alsoCalled: string[];
	description: string;
	/** People only - a place is not tied to one era. */
	era: AtlasEra | null;
	/** Places only, and only where Scripture makes it certain. */
	modernRegion: string | null;
	refs: string[];
	related: AtlasEntityRef[];
	/** Typed graph edges. `related` remains for older clients. */
	relations: AtlasRelation[];
	/** Typed edges with the opposite endpoint and a perspective-aware label. */
	relationDetails: AtlasNeighborhoodEntry[];
	events: { id: string; title: string; era: AtlasEra; yearLabel: string }[];
}

export type AtlasHitKind = AtlasEntityKind | "event";

export interface AtlasSearchHit {
	id: string;
	kind: AtlasHitKind;
	name: string;
	disambiguator: string | null;
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

/** Locale-independent ordering shared by the web and Android bundles. */
function compareAtlasText(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Turn the legacy authored label into the structured date used by clients.
 * Numeric years are signed so BC sorts before AD, while an undated label has
 * no invented chronology. The label is always retained verbatim.
 */
export function eventDateFromLabel(label: string): AtlasEventDate {
	const value = String(label ?? "").trim();
	const normalized = value.toLowerCase();
	if (!value || /\b(?:undated|unknown|not\s+given|n\/a)\b/.test(normalized)) {
		return { label: value, provenance: "undated" };
	}

	// A suffix applies to both sides of a range: "c. 1635 - 1491 BC".
	const match = normalized.match(
		/(\d{1,5})(?:\s*(?:-|\u2013|\u2014|to)\s*(\d{1,5}))?\s*(bc|bce|ad|ce)?/i
	);
	if (!match) return { label: value, provenance: "undated" };
	const [, first, second, era] = match;
	const sign = era && /bc|bce/i.test(era) ? -1 : 1;
	const startYear = sign * Number.parseInt(first, 10);
	const endYear = second === undefined ? startYear : sign * Number.parseInt(second, 10);
	return {
		label: value,
		startYear,
		endYear,
		provenance: "traditional-ussher",
	};
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
	return {
		id: person.id,
		kind: "person",
		name: person.name,
		...(person.disambiguator !== undefined ? { disambiguator: person.disambiguator } : {}),
	};
}

function placeRef(place: AtlasPlace): AtlasEntityRef {
	return { id: place.id, kind: "place", name: place.name };
}

function summaryForPerson(person: AtlasPerson): AtlasEntitySummary {
	return {
		id: person.id,
		kind: "person",
		name: person.name,
		...(person.disambiguator !== undefined ? { disambiguator: person.disambiguator } : {}),
		description: person.description,
		alsoCalled: person.alsoCalled ?? [],
		era: person.era,
		modernRegion: null,
	};
}

function summaryForPlace(place: AtlasPlace): AtlasEntitySummary {
	return {
		id: place.id,
		kind: "place",
		name: place.name,
		description: place.description,
		alsoCalled: place.alsoCalled ?? [],
		era: null,
		modernRegion: place.modernRegion ?? null,
	};
}

function summaryForId(data: AtlasData, id: string): AtlasEntitySummary | null {
	const person = data.people.find((candidate) => candidate.id === id);
	if (person) return summaryForPerson(person);
	const place = data.places.find((candidate) => candidate.id === id);
	return place ? summaryForPlace(place) : null;
}

function atlasRelations(data: AtlasData): readonly AtlasRelation[] {
	return data.relations ?? [];
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
		date: event.date ?? eventDateFromLabel(event.yearLabel),
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
	const relationDetails = getRelationshipNeighborhood(data, id);
	const relations = relationDetails.map((entry) => entry.relation);

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
			disambiguator: person.disambiguator ?? null,
			alsoCalled: person.alsoCalled ?? [],
			description: person.description,
			era: person.era,
			modernRegion: null,
			refs: person.refs,
			related,
			relations,
			relationDetails,
			events,
		};
	}

	const found = place as AtlasPlace;
	return {
		id: found.id,
		kind: "place",
		name: found.name,
		disambiguator: null,
		alsoCalled: found.alsoCalled ?? [],
		description: found.description,
		era: null,
		modernRegion: found.modernRegion ?? null,
		refs: found.refs,
		related: [],
		relations,
		relationDetails,
		events,
	};
}

/* ----------------------------------------------------------- entities/graph */

export interface AtlasEntityListQuery {
	kind?: AtlasEntityKind;
	era?: AtlasEra | string;
	cursor?: string;
	limit?: number;
}

export interface AtlasEntityListResult {
	items: AtlasEntitySummary[];
	nextCursor: string | null;
	total: number;
}

/**
 * List entities in a deterministic order. The cursor is an opaque offset into
 * that order, so changing a page size never changes which entity follows it.
 */
export function listEntities(data: AtlasData, query: AtlasEntityListQuery = {}): AtlasEntityListResult {
	const all: AtlasEntitySummary[] = [
		...data.people.map(summaryForPerson),
		...data.places.map(summaryForPlace),
	].filter((entity) => {
		if (query.kind && entity.kind !== query.kind) return false;
		return !query.era || entity.era === query.era;
	});
	all.sort(
		(a, b) =>
			compareAtlasText(normalizeAtlasName(a.name), normalizeAtlasName(b.name)) ||
			compareAtlasText(a.id, b.id)
	);

	const parsedCursor = query.cursor === undefined ? 0 : Number.parseInt(query.cursor, 10);
	const start = Number.isInteger(parsedCursor) && parsedCursor >= 0 ? parsedCursor : 0;
	const requested = query.limit ?? 24;
	const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), 100) : 24;
	const items = all.slice(start, start + limit);
	return {
		items,
		nextCursor: start + items.length < all.length ? String(start + items.length) : null,
		total: all.length,
	};
}

export interface AtlasNeighborhoodEntry extends AtlasEntitySummary {
	relation: AtlasRelation;
	entity: AtlasEntitySummary;
	direction: "outgoing" | "incoming";
	label: string;
}

/**
 * Human-facing relationship text from one endpoint's perspective. Relation
 * direction is retained in the data, but labels describe the other person or
 * place so "parent" becomes "Child" when viewed from the parent.
 */
export function relationLabelFor(relation: AtlasRelation, perspectiveId: string): string {
	const from = relation.from === perspectiveId;
	const to = relation.to === perspectiveId;
	if (!from && !to) return "Related";
	switch (relation.type) {
		case "parent":
			return from ? "Child" : "Parent";
		case "spouse":
			return "Spouse";
		case "sibling":
			return "Sibling";
		case "mentor":
			return from ? "Disciple" : "Mentor";
		case "disciple":
			return from ? "Disciple" : "Mentor";
		case "companion":
			return "Companion";
		case "associated-place":
			return from ? "Associated place" : "Associated person";
		case "associated":
			return "Associated";
	}
}

/** Every reviewed edge touching an entity, with the other endpoint resolved. */
export function getRelationshipNeighborhood(data: AtlasData, id: string): AtlasNeighborhoodEntry[] {
	return atlasRelations(data)
		.filter((relation) => relation.from === id || relation.to === id)
		.flatMap((relation) => {
			const outgoing = relation.from === id;
			const other = summaryForId(data, outgoing ? relation.to : relation.from);
			return other
				? [
					{
						...other,
						relation,
						entity: other,
						direction: outgoing ? ("outgoing" as const) : ("incoming" as const),
						label: relationLabelFor(relation, id),
					},
				]
				: [];
		})
		.sort(
			(a, b) =>
				compareAtlasText(normalizeAtlasName(a.entity.name), normalizeAtlasName(b.entity.name)) ||
				compareAtlasText(a.entity.id, b.entity.id) ||
				compareAtlasText(a.relation.id, b.relation.id)
		);
}

/** A compact neighbor-only form for clients that do not need edge metadata. */
export function relationshipNeighborhood(data: AtlasData, id: string): AtlasEntitySummary[] {
	return getRelationshipNeighborhood(data, id).map((entry) => entry.entity);
}

const FAMILY_RELATION_TYPES = new Set<AtlasRelationType>(["parent", "spouse", "sibling"]);

/** The family neighborhood, excluding mentors, companions and places. */
export function getFamily(data: AtlasData, id: string): AtlasEntitySummary[] {
	return getRelationshipNeighborhood(data, id)
		.filter((entry) => FAMILY_RELATION_TYPES.has(entry.relation.type))
		.map((entry) => entry.entity);
}

export const familyNeighborhood = getFamily;

export interface AtlasPersonConnectionPath {
	ids: string[];
	entities: AtlasEntitySummary[];
	relations: AtlasRelation[];
}

/**
 * Find the shortest deterministic path between two people. Relations are
 * traversable in either direction: a parent or mentor edge still connects
 * the two people when the question is "how are these people connected?".
 */
export function shortestPersonConnectionPath(
	data: AtlasData,
	fromId: string,
	toId: string
): AtlasPersonConnectionPath | null {
	const people = new Set(data.people.map((person) => person.id));
	if (!people.has(fromId) || !people.has(toId)) return null;
	if (fromId === toId) {
		const entity = summaryForId(data, fromId) as AtlasEntitySummary;
		return { ids: [fromId], entities: [entity], relations: [] };
	}

	const adjacency = new Map<string, { id: string; relation: AtlasRelation }[]>();
	for (const relation of atlasRelations(data)) {
		if (!people.has(relation.from) || !people.has(relation.to)) continue;
		adjacency.get(relation.from)?.push({ id: relation.to, relation }) ??
			adjacency.set(relation.from, [{ id: relation.to, relation }]);
		adjacency.get(relation.to)?.push({ id: relation.from, relation }) ??
			adjacency.set(relation.to, [{ id: relation.from, relation }]);
	}
	for (const edges of adjacency.values()) {
		edges.sort((a, b) => compareAtlasText(a.id, b.id) || compareAtlasText(a.relation.id, b.relation.id));
	}

	const queue = [fromId];
	const previous = new Map<string, { id: string; relation: AtlasRelation }>();
	const visited = new Set([fromId]);
	while (queue.length > 0) {
		const current = queue.shift() as string;
		for (const edge of adjacency.get(current) ?? []) {
			if (visited.has(edge.id)) continue;
			visited.add(edge.id);
			previous.set(edge.id, { id: current, relation: edge.relation });
			if (edge.id === toId) {
				queue.length = 0;
				break;
			}
			queue.push(edge.id);
		}
	}
	if (!visited.has(toId)) return null;

	const ids = [toId];
	const relations: AtlasRelation[] = [];
	for (let current = toId; current !== fromId; ) {
		const step = previous.get(current);
		if (!step) return null;
		relations.push(step.relation);
		ids.push(step.id);
		current = step.id;
	}
	ids.reverse();
	relations.reverse();
	return {
		ids,
		entities: ids.map((id) => summaryForId(data, id) as AtlasEntitySummary),
		relations,
	};
}

export const tracePersonConnection = shortestPersonConnectionPath;
export const findShortestPersonPath = shortestPersonConnectionPath;

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
export function searchAtlasData(data: AtlasData, query: string, limit = 12): AtlasSearchHit[] {
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
				disambiguator: person.disambiguator ?? null,
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
				disambiguator: null,
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
				disambiguator: null,
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

export interface AtlasSearchCounts {
	total: number;
	person: number;
	place: number;
	event: number;
}

export interface AtlasSearchResults {
	query: string;
	results: AtlasSearchHit[];
	counts: AtlasSearchCounts;
}

/** Search plus untruncated per-kind counts for result headers and filters. */
export function searchAtlasDataWithCounts(
	data: AtlasData,
	query: string,
	limit = 12
): AtlasSearchResults {
	const results = searchAtlasData(data, query, limit);
	const all = searchAtlasData(data, query, Number.MAX_SAFE_INTEGER);
	const counts: AtlasSearchCounts = {
		total: all.length,
		person: all.filter((hit) => hit.kind === "person").length,
		place: all.filter((hit) => hit.kind === "place").length,
		event: all.filter((hit) => hit.kind === "event").length,
	};
	return { query, results, counts };
}

export const searchAtlasWithCounts = searchAtlasDataWithCounts;

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

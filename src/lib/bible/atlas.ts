/**
 * Server-side access to the Bible atlas: the timeline, the people and the
 * places, plus a count of how often the KJV actually names someone.
 *
 * The data (data/bible-atlas/*.json) is hand-authored and validated by
 * `scripts/build-bible-atlas.mjs`; all the ranking, grouping and reference
 * parsing lives in `atlas-core.ts`, which the Android app runs verbatim. This
 * module is only the loading, the KJV lookups, and the shapes the API and the
 * chat tools hand out. Loaded lazily and cached for the session, like
 * `crossRefs.ts`.
 */
import { BOOKS, bookByOrder } from "./books";
import { getKjvBook } from "./kjv";
import {
	getEntityView,
	groupEventsByEra,
	normalizeAtlasName,
	parseAtlasRef,
	refTouchesChapter,
	searchAtlasData,
	selectTimelineEvents,
	toEventView,
	whoIsInChapter,
	type AtlasData,
	type AtlasEntityView,
	type AtlasEraGroup,
	type AtlasEvent,
	type AtlasEventView,
	type AtlasPerson,
	type AtlasPlace,
	type AtlasSearchHit,
	type TimelineQuery,
} from "./atlas-core";

export {
	ATLAS_ERAS,
	parseAtlasRef,
	refOpensAt,
	type AtlasEntityRef,
	type AtlasEntityView,
	type AtlasEra,
	type AtlasEraGroup,
	type AtlasEvent,
	type AtlasEventView,
	type AtlasSearchHit,
} from "./atlas-core";

let cache: AtlasData | null = null;
let inFlight: Promise<AtlasData> | null = null;

/** The whole atlas, parsed once per server process. */
export async function getAtlas(): Promise<AtlasData> {
	if (cache) return cache;
	inFlight ??= (async () => {
		const [events, people, places] = await Promise.all([
			import("@/data/bible-atlas/events.json"),
			import("@/data/bible-atlas/people.json"),
			import("@/data/bible-atlas/places.json"),
		]);
		cache = {
			events: events.default as AtlasEvent[],
			people: people.default as AtlasPerson[],
			places: places.default as AtlasPlace[],
		};
		return cache;
	})();
	return inFlight;
}

/** Name/alias/title search across people, places and events, best first. */
export async function searchAtlas(query: string, limit = 10): Promise<AtlasSearchHit[]> {
	return searchAtlasData(await getAtlas(), query, limit);
}

export async function getPerson(id: string): Promise<AtlasEntityView | null> {
	const view = getEntityView(await getAtlas(), id);
	return view && view.kind === "person" ? view : null;
}

export async function getPlace(id: string): Promise<AtlasEntityView | null> {
	const view = getEntityView(await getAtlas(), id);
	return view && view.kind === "place" ? view : null;
}

/** A person or a place, whichever the id belongs to. */
export async function getEntity(id: string): Promise<AtlasEntityView | null> {
	return getEntityView(await getAtlas(), id);
}

export async function getEvent(id: string): Promise<AtlasEventView | null> {
	const atlas = await getAtlas();
	const event = atlas.events.find((candidate) => candidate.id === id);
	return event ? toEventView(atlas, event) : null;
}

export interface TimelineView {
	/** Only the eras that actually have events in this result. */
	eras: AtlasEraGroup[];
	/** The same events flat and in order, for clients that render one rail. */
	events: AtlasEventView[];
}

/**
 * The timeline, optionally narrowed to an era, a book/chapter the events touch,
 * or the events one person takes part in.
 */
export async function getTimeline(query: TimelineQuery = {}): Promise<TimelineView> {
	const atlas = await getAtlas();
	const events = selectTimelineEvents(atlas, BOOKS, query);
	return {
		eras: groupEventsByEra(atlas, events),
		events: events.map((event) => toEventView(atlas, event)),
	};
}

/** Who and where a chapter is about, for the reader's "Who's in this chapter". */
export async function whoIsIn(order: number, chapter: number) {
	return whoIsInChapter(await getAtlas(), BOOKS, order, chapter);
}

export interface AtlasOccurrence {
	reference: string;
	text: string;
}

export interface OccurrencesResult {
	name: string;
	/** How many KJV verses name them in total. */
	total: number;
	/** The first few, in canonical order. */
	verses: AtlasOccurrence[];
}

/**
 * Count and list the KJV verses that name someone or somewhere, by exact
 * word match (case-insensitive, punctuation-insensitive, so "Beer-sheba"
 * matches "Beersheba" and "Abimelech's" matches "Abimelech").
 *
 * A plain scan of the bundled text rather than the IDF search in
 * `kjv.ts`: a name is one exact word, and an exact answer ("Moses is named in
 * 803 verses") is worth more here than a ranked one. The first call parses
 * every book, which the keyword search does anyway; both share that cache.
 */
export async function findOccurrences(name: string, limit = 8): Promise<OccurrencesResult> {
	const needle = normalizeAtlasName(name);
	const verses: AtlasOccurrence[] = [];
	let total = 0;
	if (!needle) return { name, total, verses };

	for (const book of BOOKS) {
		const chapters = await getKjvBook(book.order);
		for (let chapterIndex = 0; chapterIndex < chapters.length; chapterIndex++) {
			const chapterVerses = chapters[chapterIndex];
			for (let verseIndex = 0; verseIndex < chapterVerses.length; verseIndex++) {
				const text = chapterVerses[verseIndex];
				if (!` ${normalizeAtlasName(text)} `.includes(` ${needle} `)) continue;
				total += 1;
				if (verses.length < limit) {
					verses.push({
						reference: `${book.name} ${chapterIndex + 1}:${verseIndex + 1}`,
						text,
					});
				}
			}
		}
	}
	return { name, total, verses };
}

/**
 * Resolve an authored reference into the location the reader should open at.
 * Returns null for anything the parser does not accept - which the validator
 * makes impossible for data in the repo, but not for a model-supplied string.
 */
export function resolveAtlasRef(input: string): {
	order: number;
	book: string;
	chapter: number;
	verse: number | null;
} | null {
	const ref = parseAtlasRef(BOOKS, input);
	if (!ref) return null;
	const meta = bookByOrder(ref.order);
	return {
		order: ref.order,
		book: meta?.name ?? ref.book,
		chapter: ref.chapter,
		verse: ref.verse ?? null,
	};
}

/** Does this authored reference fall inside the given chapter? */
export function atlasRefTouches(input: string, order: number, chapter: number): boolean {
	const ref = parseAtlasRef(BOOKS, input);
	return ref ? refTouchesChapter(ref, order, chapter) : false;
}

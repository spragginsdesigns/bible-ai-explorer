/**
 * The Bible atlas on the phone: the timeline, the people and the places.
 *
 * The data is bundled (src/data/bible-atlas/*.json, mirrored from the web app
 * by scripts/build-bible-atlas.mjs), so this screen works with no network at
 * all, exactly like the Bible reader. All the ranking, grouping and reference
 * parsing comes from `atlasCore.ts`, which is a verbatim copy of the server's
 * `src/lib/bible/atlas-core.ts` - neither file is hand-edited.
 */
import { BOOKS, type Book } from "@/features/bible/books";
import eventsJson from "@/data/bible-atlas/events.json";
import peopleJson from "@/data/bible-atlas/people.json";
import placesJson from "@/data/bible-atlas/places.json";
import {
	getEntityView,
	groupEventsByEra,
	parseAtlasRef,
	searchAtlasData,
	selectTimelineEvents,
	whoIsInChapter,
	type AtlasBook,
	type AtlasData,
	type AtlasEntityView,
	type AtlasEraGroup,
	type AtlasEvent,
	type AtlasEventView,
	type AtlasPerson,
	type AtlasPlace,
	type AtlasSearchHit,
	type TimelineQuery,
} from "./atlasCore";

export {
	ATLAS_ERAS,
	type AtlasEntityRef,
	type AtlasEntityView,
	type AtlasEra,
	type AtlasEraGroup,
	type AtlasEventView,
	type AtlasSearchHit,
} from "./atlasCore";

/** The bundled atlas. The JSON is validated at build time, so this cast is safe. */
export const ATLAS: AtlasData = {
	events: eventsJson as unknown as AtlasEvent[],
	people: peopleJson as unknown as AtlasPerson[],
	places: placesJson as unknown as AtlasPlace[],
};

/** `Book` already has everything reference parsing needs. */
const ATLAS_BOOKS: AtlasBook[] = BOOKS;

export function searchAtlas(query: string, limit = 12): AtlasSearchHit[] {
	return searchAtlasData(ATLAS, query, limit);
}

export function getAtlasEntity(id: string): AtlasEntityView | null {
	return getEntityView(ATLAS, id);
}

export function getAtlasEvent(id: string): AtlasEventView | null {
	const event = ATLAS.events.find((candidate) => candidate.id === id);
	return event ? { ...groupOne(event) } : null;
}

function groupOne(event: AtlasEvent): AtlasEventView {
	return groupEventsByEra(ATLAS, [event])[0].events[0];
}

/** The timeline for a filter, grouped into eras in chronological order. */
export function getTimeline(query: TimelineQuery = {}): AtlasEraGroup[] {
	return groupEventsByEra(ATLAS, selectTimelineEvents(ATLAS, ATLAS_BOOKS, query));
}

export function whoIsIn(order: number, chapter: number) {
	return whoIsInChapter(ATLAS, ATLAS_BOOKS, order, chapter);
}

/** Where a reference chip should open the reader, or null if it cannot. */
export function openLocationFor(
	reference: string
): { book: Book; chapter: number; verse: number | null } | null {
	const ref = parseAtlasRef(ATLAS_BOOKS, reference);
	if (!ref) return null;
	const book = BOOKS.find((candidate) => candidate.order === ref.order);
	return book ? { book, chapter: ref.chapter, verse: ref.verse ?? null } : null;
}

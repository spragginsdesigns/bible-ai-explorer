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
import relationsJson from "@/data/bible-atlas/relations.json";
import {
	getFamily,
	getEntityView,
	getRelationshipNeighborhood,
	groupEventsByEra,
	parseAtlasRef,
	relationLabelFor,
	searchAtlasData,
	selectTimelineEvents,
	shortestPersonConnectionPath,
	listEntities,
	whoIsInChapter,
	type AtlasBook,
	type AtlasData,
	type AtlasEntityListQuery,
	type AtlasEntityListResult,
	type AtlasEntityView,
	type AtlasEra,
	type AtlasEraGroup,
	type AtlasEvent,
	type AtlasEventView,
	type AtlasPerson,
	type AtlasPlace,
	type AtlasSearchHit,
	type AtlasEntitySummary,
	type AtlasNeighborhoodEntry,
	type AtlasPersonConnectionPath,
	type AtlasRelation,
	type TimelineQuery,
} from "./atlasCore";

export {
	ATLAS_ERAS,
	type AtlasChapterView,
	type AtlasEntityRef,
	type AtlasEntityView,
	type AtlasEra,
	type AtlasEraGroup,
	type AtlasEventView,
	type AtlasSearchHit,
	type AtlasEntitySummary,
	type AtlasRelation,
	type AtlasNeighborhoodEntry,
	type AtlasPersonConnectionPath,
	type AtlasEventDate,
	type AtlasRelationType,
	type AtlasRelationCertainty,
} from "./atlasCore";

/** The bundled atlas. The JSON is validated at build time, so this cast is safe. */
export const ATLAS: AtlasData = {
	events: eventsJson as unknown as AtlasEvent[],
	people: peopleJson as unknown as AtlasPerson[],
	places: placesJson as unknown as AtlasPlace[],
	relations: relationsJson as unknown as AtlasRelation[],
};

/** `Book` already has everything reference parsing needs. */
const ATLAS_BOOKS: AtlasBook[] = BOOKS;

export function searchAtlas(query: string, limit = 12): AtlasSearchHit[] {
	return searchAtlasData(ATLAS, query, limit);
}

export function searchAtlasGlobal(
	query: string,
	era?: AtlasEra | null,
	limit = 12,
): { results: AtlasSearchHit[]; counts: AtlasSearchCounts } {
	const all = searchAtlasData(ATLAS, query, Number.MAX_SAFE_INTEGER).filter(
		(hit) => !era || hit.kind === "place" || hit.era === era,
	);
	const counts: AtlasSearchCounts = { person: 0, place: 0, event: 0 };
	for (const hit of all) counts[hit.kind] += 1;
	return { results: all.slice(0, Math.max(1, limit)), counts };
}

export type AtlasMode = "timeline" | "people" | "places";
export type AtlasSearchCounts = Record<AtlasSearchHit["kind"], number>;

/** Search results scoped to the active directory mode, with grouped totals.
 * The atlas stays local and the visible result set is intentionally capped at
 * twelve; totals come from the same deterministic core ranking without that
 * presentation cap.
 */
export function searchAtlasScoped(
	query: string,
	mode: AtlasMode,
	era?: AtlasEra | null,
	limit = 12,
): { results: AtlasSearchHit[]; counts: AtlasSearchCounts } {
	const all = searchAtlasData(ATLAS, query, Number.MAX_SAFE_INTEGER);
	const counts: AtlasSearchCounts = { person: 0, place: 0, event: 0 };
	for (const hit of all) {
		counts[hit.kind] += 1;
	}
	const kind =
		mode === "timeline" ? "event" : mode === "people" ? "person" : "place";
	const results = all
		.filter((hit) => {
			if (hit.kind !== kind) return false;
			return !era || hit.era === era;
		})
		.slice(0, Math.max(1, limit));
	return { results, counts };
}

export function getAtlasEntity(id: string): AtlasEntityView | null {
	return getEntityView(ATLAS, id);
}

export function listAtlasEntities(
	query: AtlasEntityListQuery = {},
): AtlasEntityListResult {
	const first = listEntities(ATLAS, query);
	// Directory screens ask for the maximum page and should not silently stop
	// after the first hundred bundled entries. Keep explicit cursors and small
	// page requests paginated for callers that need incremental loading.
	if (
		query.cursor !== undefined ||
		(query.limit ?? 24) < 100 ||
		!first.nextCursor
	)
		return first;
	const items = [...first.items];
	let cursor: string | null = first.nextCursor;
	while (cursor) {
		const page = listEntities(ATLAS, { ...query, cursor, limit: query.limit });
		items.push(...page.items);
		cursor = page.nextCursor;
	}
	return { items, nextCursor: null, total: first.total };
}

export function atlasNeighborhood(id: string): AtlasNeighborhoodEntry[] {
	return getRelationshipNeighborhood(ATLAS, id);
}

export { relationLabelFor };

export function atlasFamily(id: string): AtlasEntitySummary[] {
	return getFamily(ATLAS, id);
}

export function traceAtlasPeople(
	fromId: string,
	toId: string,
): AtlasPersonConnectionPath | null {
	return shortestPersonConnectionPath(ATLAS, fromId, toId);
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
	return groupEventsByEra(
		ATLAS,
		selectTimelineEvents(ATLAS, ATLAS_BOOKS, query),
	);
}

export function whoIsIn(order: number, chapter: number) {
	return whoIsInChapter(ATLAS, ATLAS_BOOKS, order, chapter);
}

/** Where a reference chip should open the reader, or null if it cannot. */
export function openLocationFor(
	reference: string,
): { book: Book; chapter: number; verse: number | null } | null {
	const ref = parseAtlasRef(ATLAS_BOOKS, reference);
	if (!ref) return null;
	const book = BOOKS.find((candidate) => candidate.order === ref.order);
	return book ? { book, chapter: ref.chapter, verse: ref.verse ?? null } : null;
}

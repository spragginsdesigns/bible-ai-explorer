import "server-only";

import { getAtlas, getEntity, getEvent } from "@/lib/bible/atlas";
import { eventDateFromLabel, parseAtlasRef, type AtlasData, type AtlasPlace } from "@/lib/bible/atlas-core";
import { BOOKS } from "@/lib/bible/books";
import { getKjvBook } from "@/lib/bible/kjv";
import { readerHrefFor } from "@/components/atlas/atlasLinks";
import { formatYearSpan, placesNamedIn, projectLonLat } from "./atlas-rules";
import { BETA_JOURNEYS } from "./journeys";
import { BETA_ERA_SPANS, BETA_TIMELINE_LANES } from "./lanes";
import { BETA_ATLAS_GEO, BETA_ATLAS_SAME_SITE, BETA_ATLAS_UNMAPPED, BETA_ATLAS_WAYPOINTS } from "./places";
import type {
	AtlasEventCard,
	AtlasJourneyView,
	AtlasMapPlace,
	AtlasPassage,
	AtlasPlaceCard,
	AtlasTimelineEvent,
	BetaAtlasIndex,
} from "./types";

/**
 * Server side of SureWord Beta's Atlas & Timeline (LC-17655,
 * docs/beta/atlas.md). Everything here reads the shared atlas corpus through
 * `src/lib/bible/atlas.ts` and the bundled KJV through `src/lib/bible/kjv.ts`,
 * adding only the beta's map layer (places.ts), journeys and timeline lanes.
 * Read-only over bundled data: no database, no AI, no network.
 */

/** Verses shown per reference before "read on in the reader". */
const VERSES_PER_PASSAGE = 6;
/** References resolved into text per card. */
const PASSAGES_PER_CARD = 4;

const waypointById = new Map(BETA_ATLAS_WAYPOINTS.map((place) => [place.id, place]));

function placeLookup(atlas: AtlasData): Map<string, AtlasPlace & { source: "corpus" | "beta" }> {
	const out = new Map<string, AtlasPlace & { source: "corpus" | "beta" }>();
	for (const place of atlas.places) out.set(place.id, { ...place, source: "corpus" });
	for (const place of BETA_ATLAS_WAYPOINTS) out.set(place.id, { ...place, source: "beta" });
	return out;
}

function eventYears(event: AtlasData["events"][number]): { dated: boolean; start: number; end: number } {
	const date = event.date ?? eventDateFromLabel(event.yearLabel);
	if (date.provenance === "undated" || date.startYear === undefined) return { dated: false, start: 0, end: 0 };
	return { dated: true, start: date.startYear, end: date.endYear ?? date.startYear };
}

/** Everything the page needs up front: markers, journeys, the timeline and its lanes. */
export async function getBetaAtlasIndex(): Promise<BetaAtlasIndex> {
	const atlas = await getAtlas();
	const places = placeLookup(atlas);
	const eventById = new Map(atlas.events.map((event) => [event.id, event]));
	const personName = new Map(atlas.people.map((person) => [person.id, person.name]));

	const alsoHere = new Map<string, { id: string; name: string }[]>();
	for (const [id, entry] of Object.entries(BETA_ATLAS_SAME_SITE)) {
		const place = places.get(id);
		if (!place) continue;
		alsoHere.set(entry.at, [...(alsoHere.get(entry.at) ?? []), { id, name: place.name }]);
	}

	const importance = new Map<string, number>();
	const bump = (id: string) => importance.set(BETA_ATLAS_SAME_SITE[id]?.at ?? id, (importance.get(BETA_ATLAS_SAME_SITE[id]?.at ?? id) ?? 0) + 1);
	for (const event of atlas.events) event.places.forEach(bump);
	for (const journey of BETA_JOURNEYS) journey.stops.forEach((stop) => bump(stop.place));

	const mapPlaces: AtlasMapPlace[] = [];
	for (const [id, geo] of Object.entries(BETA_ATLAS_GEO)) {
		const place = places.get(id);
		if (!place) continue;
		const { x, y } = projectLonLat(geo.lon, geo.lat);
		mapPlaces.push({
			id,
			name: place.name,
			aliases: place.alsoCalled ?? [],
			x: Math.round(x * 10) / 10,
			y: Math.round(y * 10) / 10,
			certainty: geo.certainty,
			feature: geo.feature,
			rank: geo.rank,
			importance: importance.get(id) ?? 0,
			alsoHere: alsoHere.get(id) ?? [],
		});
	}

	const journeys: AtlasJourneyView[] = BETA_JOURNEYS.map((journey) => {
		const from = eventById.get(journey.when.from);
		const to = eventById.get(journey.when.to);
		const start = from ? eventYears(from).start : 0;
		const end = to ? eventYears(to).end : 0;
		return {
			id: journey.id,
			title: journey.title,
			short: journey.short,
			summary: journey.summary,
			when: formatYearSpan(start, end),
			people: journey.people.flatMap((id) => (personName.has(id) ? [{ id, name: personName.get(id) as string }] : [])),
			stops: journey.stops.map((stop) => {
				const event = stop.event ? eventById.get(stop.event) : undefined;
				return {
					place: stop.place,
					name: places.get(stop.place)?.name ?? stop.place,
					refs: [...stop.refs],
					note: stop.note,
					by: stop.by ?? null,
					event: event ? { id: event.id, title: event.title } : null,
				};
			}),
		};
	});

	const events: AtlasTimelineEvent[] = atlas.events.map((event) => {
		const years = eventYears(event);
		return {
			id: event.id,
			title: event.title,
			era: event.era,
			label: event.yearLabel,
			dated: years.dated,
			start: years.start,
			end: years.end,
			places: event.places.map((id) => BETA_ATLAS_SAME_SITE[id]?.at ?? id).filter((id) => BETA_ATLAS_GEO[id]),
		};
	});

	return {
		places: mapPlaces,
		journeys,
		events,
		eras: BETA_ERA_SPANS.map((era, index) => ({
			era: era.era,
			start: era.start,
			end: era.end,
			scaleStart: index === 0 ? era.start : BETA_ERA_SPANS[index - 1].scaleEnd,
			scaleEnd: era.scaleEnd,
			weight: era.weight,
		})),
		lanes: BETA_TIMELINE_LANES.map((lane) => ({
			id: lane.id,
			title: lane.title,
			short: lane.short,
			gap: lane.gap ?? null,
			after: lane.after ?? null,
			spans: lane.spans.map((span) => ({
				id: span.id,
				label: span.label,
				start: span.start,
				end: span.end,
				when: formatYearSpan(span.start, span.end),
				refs: [...span.refs],
				source: span.source,
				note: span.note ?? null,
				journey: span.journey ?? null,
			})),
			events: [...(lane.events ?? [])],
			undated: (lane.undated ?? []).map((entry) => ({ label: entry.label, refs: [...entry.refs] })),
		})),
		sameSite: Object.fromEntries(Object.entries(BETA_ATLAS_SAME_SITE).map(([id, entry]) => [id, entry.at])),
	};
}

/* --------------------------------------------------------------- passages */

/**
 * The KJV text of authored references, from the bundled text. A whole chapter
 * or a long range shows its first verses and says there is more; the reader
 * link opens the full passage.
 */
export async function getPassages(refs: readonly string[], perPassage = VERSES_PER_PASSAGE): Promise<AtlasPassage[]> {
	const out: AtlasPassage[] = [];
	for (const raw of refs) {
		const ref = parseAtlasRef(BOOKS, raw);
		if (!ref) continue;
		const chapter = (await getKjvBook(ref.order))[ref.chapter - 1];
		if (!chapter) continue;
		const first = ref.verse ?? 1;
		const last = ref.verse === undefined ? chapter.length : ref.endChapter === ref.chapter ? (ref.endVerse ?? first) : chapter.length;
		const shownLast = Math.min(last, first + perPassage - 1, chapter.length);
		const verses = [];
		for (let verse = first; verse <= shownLast; verse++) verses.push({ verse, text: chapter[verse - 1] });
		out.push({
			ref: ref.label,
			href: readerHrefFor(raw),
			verses,
			more: shownLast < last || ref.endChapter > ref.chapter,
		});
	}
	return out;
}

/** Every stop's verses for one journey, in order, or null for an unknown id. */
export async function getJourneyPassages(id: string): Promise<{ journey: string; stops: AtlasPassage[][] } | null> {
	const journey = BETA_JOURNEYS.find((entry) => entry.id === id);
	if (!journey) return null;
	const stops = [];
	for (const stop of journey.stops) stops.push(await getPassages(stop.refs));
	return { journey: journey.id, stops };
}

/* ------------------------------------------------------------------ cards */

function journeysThrough(placeId: string): { id: string; title: string; stops: number[] }[] {
	return BETA_JOURNEYS.flatMap((journey) => {
		const stops = journey.stops.flatMap((stop, index) => (stop.place === placeId ? [index] : []));
		return stops.length ? [{ id: journey.id, title: journey.title, stops }] : [];
	});
}

/** A place's card: the corpus entry (or the beta waypoint), where it is, its passages, events and journeys. */
export async function getPlaceCard(id: string): Promise<AtlasPlaceCard | null> {
	const atlas = await getAtlas();
	const waypoint = waypointById.get(id);
	const corpus = waypoint ? null : await getEntity(id);
	if (!waypoint && (!corpus || corpus.kind !== "place")) return null;

	const sameSite = BETA_ATLAS_SAME_SITE[id];
	const marker = BETA_ATLAS_GEO[id] ? id : sameSite?.at ?? null;
	const geo = marker ? BETA_ATLAS_GEO[marker] : undefined;
	const refs = waypoint ? [...waypoint.refs] : (corpus?.refs ?? []);
	const events = atlas.events
		.filter((event) => event.places.includes(id))
		.map((event) => ({ id: event.id, title: event.title, label: event.yearLabel }));

	return {
		kind: "place",
		id,
		name: waypoint?.name ?? corpus?.name ?? id,
		alsoCalled: waypoint?.alsoCalled ?? corpus?.alsoCalled ?? [],
		description: waypoint?.description ?? corpus?.description ?? "",
		modernRegion: waypoint?.modernRegion ?? corpus?.modernRegion ?? null,
		source: waypoint ? "beta" : "corpus",
		marker,
		certainty: geo?.certainty ?? null,
		feature: geo?.feature ?? null,
		siteNote: sameSite?.note ?? BETA_ATLAS_UNMAPPED[id] ?? null,
		refs,
		passages: await getPassages(refs.slice(0, PASSAGES_PER_CARD)),
		events,
		journeys: journeysThrough(id),
	};
}

/** An event's card: the corpus event, its passages, and where it is on the map. */
export async function getEventCard(id: string): Promise<AtlasEventCard | null> {
	const event = await getEvent(id);
	if (!event) return null;
	return {
		kind: "event",
		id: event.id,
		title: event.title,
		era: event.era,
		label: event.yearLabel,
		dated: event.date.provenance !== "undated",
		summary: event.summary,
		refs: event.refs,
		passages: await getPassages(event.refs.slice(0, PASSAGES_PER_CARD)),
		places: event.places.map((place) => ({
			id: place.id,
			name: place.name,
			marker: BETA_ATLAS_GEO[place.id] ? place.id : BETA_ATLAS_SAME_SITE[place.id]?.at ?? null,
		})),
		people: event.people.map((person) => ({ id: person.id, name: person.name })),
		journeys: BETA_JOURNEYS.flatMap((journey) => {
			const stop = journey.stops.findIndex((entry) => entry.event === id);
			return stop === -1 ? [] : [{ id: journey.id, title: journey.title, stop }];
		}),
	};
}

/* ------------------------------------------------------- the reader's link */

/** Places whose names would mislead in a verse (Dan is far more often the tribe than the city). */
const NOT_FROM_VERSES = new Set(["dan"]);

/**
 * The atlas places a passage of the KJV names, for the reader's "In the atlas"
 * row. Matching is on the KJV text whatever translation is on screen, so a
 * place is found by where it is in Scripture, not by how one translation
 * spells it. Returns at most `limit` places, in the order they appear.
 */
export async function placesInVerses(order: number, chapter: number, verse: number, endVerse = verse, limit = 6) {
	const book = await getKjvBook(order).catch(() => null);
	const verses = book?.[chapter - 1];
	if (!verses || verse < 1 || verse > verses.length) return null;
	const last = Math.min(Math.max(endVerse, verse), verses.length, verse + 30);
	const text = verses.slice(verse - 1, last).join(" ");
	const atlas = await getAtlas();
	const places = placeLookup(atlas);
	const candidates = [...places.values()]
		.filter((place) => !NOT_FROM_VERSES.has(place.id) && (BETA_ATLAS_GEO[place.id] || BETA_ATLAS_SAME_SITE[place.id]))
		.map((place) => ({ id: place.id, names: [place.name, ...(place.alsoCalled ?? [])] }));
	return placesNamedIn(text, candidates)
		.slice(0, limit)
		.map((id) => ({ id, name: places.get(id)?.name ?? id }));
}

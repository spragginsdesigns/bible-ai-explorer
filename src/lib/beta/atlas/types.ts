/**
 * The shapes SureWord Beta's Atlas & Timeline hands from the server to the
 * page and its API (LC-17655, docs/beta/atlas.md). Types only.
 */
import type { BetaAtlasCertainty, BetaAtlasFeature } from "./places";
import type { BetaLaneSource } from "./lanes";

export interface AtlasMapPlace {
	id: string;
	name: string;
	/** The other names Scripture uses, for search. */
	aliases: string[];
	/** Projected map units (atlas-rules.ts `projectLonLat`). */
	x: number;
	y: number;
	certainty: BetaAtlasCertainty;
	feature: BetaAtlasFeature;
	rank: 1 | 2 | 3;
	/** Corpus events and journey stops here: breaks ties when two markers collide. */
	importance: number;
	/** Corpus places drawn at this marker too (Horeb at Sinai). */
	alsoHere: { id: string; name: string }[];
}

export interface AtlasJourneyStopView {
	place: string;
	name: string;
	refs: string[];
	note: string;
	by: "sea" | null;
	event: { id: string; title: string } | null;
}

export interface AtlasJourneyView {
	id: string;
	title: string;
	short: string;
	summary: string;
	/** The corpus dating, "c. AD 45 - 48". */
	when: string;
	people: { id: string; name: string }[];
	stops: AtlasJourneyStopView[];
}

export interface AtlasTimelineEvent {
	id: string;
	title: string;
	era: string;
	/** The corpus label, verbatim ("c. 1491 BC", "date not given"). */
	label: string;
	dated: boolean;
	start: number;
	end: number;
	places: string[];
}

export interface AtlasEraView {
	era: string;
	start: number;
	end: number;
	scaleStart: number;
	scaleEnd: number;
	weight: number;
}

export interface AtlasLaneSpanView {
	id: string;
	label: string;
	start: number;
	end: number;
	when: string;
	refs: string[];
	source: BetaLaneSource;
	note: string | null;
	journey: string | null;
}

export interface AtlasLaneView {
	id: string;
	title: string;
	short: string;
	gap: string | null;
	after: string | null;
	spans: AtlasLaneSpanView[];
	/** Corpus event ids drawn as points in this lane. */
	events: string[];
	undated: { label: string; refs: string[] }[];
}

export interface BetaAtlasIndex {
	places: AtlasMapPlace[];
	journeys: AtlasJourneyView[];
	events: AtlasTimelineEvent[];
	eras: AtlasEraView[];
	lanes: AtlasLaneView[];
	/** Corpus places drawn at another place's marker: id -> marker id. */
	sameSite: Record<string, string>;
}

export interface AtlasPassage {
	ref: string;
	href: string | null;
	verses: { verse: number; text: string }[];
	/** True when the reference runs on past what is shown. */
	more: boolean;
}

export interface AtlasPlaceCard {
	kind: "place";
	id: string;
	name: string;
	alsoCalled: string[];
	description: string;
	modernRegion: string | null;
	source: "corpus" | "beta";
	/** The marker this place is drawn at, or null when it is not on the map. */
	marker: string | null;
	certainty: BetaAtlasCertainty | null;
	feature: BetaAtlasFeature | null;
	/** Why it shares a marker, or why it has none. */
	siteNote: string | null;
	refs: string[];
	passages: AtlasPassage[];
	events: { id: string; title: string; label: string }[];
	journeys: { id: string; title: string; stops: number[] }[];
}

export interface AtlasEventCard {
	kind: "event";
	id: string;
	title: string;
	era: string;
	label: string;
	dated: boolean;
	summary: string;
	refs: string[];
	passages: AtlasPassage[];
	places: { id: string; name: string; marker: string | null }[];
	people: { id: string; name: string }[];
	journeys: { id: string; title: string; stop: number }[];
}

export type AtlasCard = AtlasPlaceCard | AtlasEventCard;

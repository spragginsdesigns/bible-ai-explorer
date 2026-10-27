/**
 * Pure rules for SureWord Beta's Atlas & Timeline (LC-17655,
 * docs/beta/atlas.md): the map projection and camera, the timeline's scale
 * and what is happening at a year, and finding places named in a verse.
 *
 * No imports on purpose: `tests/beta-atlas.test.mjs` loads this file with
 * Node's type stripping, and the client bundles it without pulling in data.
 */

/* ------------------------------------------------------------- projection */

/**
 * The basemap's projection. `scripts/beta-atlas-basemap.mjs` draws the land
 * with the same numbers, and a test fails if the two ever disagree.
 */
export const BASEMAP_PROJECTION = {
	lonMin: 8,
	lonMax: 52,
	latMin: 21,
	latMax: 45,
	unitsPerDegree: 500,
	/** cos 34°, so a degree of longitude is drawn its true width mid-map. */
	xScale: Math.cos((34 * Math.PI) / 180),
} as const;

export interface MapPoint {
	x: number;
	y: number;
}

export function projectLonLat(lon: number, lat: number): MapPoint {
	const p = BASEMAP_PROJECTION;
	return { x: (lon - p.lonMin) * p.unitsPerDegree * p.xScale, y: (p.latMax - lat) * p.unitsPerDegree };
}

export const MAP_WIDTH = (BASEMAP_PROJECTION.lonMax - BASEMAP_PROJECTION.lonMin) * BASEMAP_PROJECTION.unitsPerDegree * BASEMAP_PROJECTION.xScale;
export const MAP_HEIGHT = (BASEMAP_PROJECTION.latMax - BASEMAP_PROJECTION.latMin) * BASEMAP_PROJECTION.unitsPerDegree;

/* ----------------------------------------------------------------- camera */

/** What the map shows: its centre in map units and how many screen pixels a map unit takes. */
export interface Camera {
	cx: number;
	cy: number;
	scale: number;
}

export interface Viewport {
	width: number;
	height: number;
}

/** About 3 km across a phone screen: close enough to tell Golgotha from Gethsemane. */
export const MAX_SCALE = 0.75;

/**
 * The least zoom: the whole map fits inside the viewport. A tall phone or
 * sidebar pane can then still see Rome and Ur at once; the map is drawn as a
 * sheet, so the margin around it reads as the table it lies on.
 */
export function minScale(viewport: Viewport): number {
	return Math.min(viewport.width / MAP_WIDTH, viewport.height / MAP_HEIGHT);
}

/** Keep the camera on the map and within the zoom range; an axis the map does not fill is centred. */
export function clampCamera(camera: Camera, viewport: Viewport): Camera {
	const scale = Math.min(MAX_SCALE, Math.max(minScale(viewport), camera.scale));
	const halfW = viewport.width / 2 / scale;
	const halfH = viewport.height / 2 / scale;
	const cx = halfW * 2 >= MAP_WIDTH ? MAP_WIDTH / 2 : Math.min(MAP_WIDTH - halfW, Math.max(halfW, camera.cx));
	const cy = halfH * 2 >= MAP_HEIGHT ? MAP_HEIGHT / 2 : Math.min(MAP_HEIGHT - halfH, Math.max(halfH, camera.cy));
	return { cx, cy, scale };
}

export interface Padding {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

/**
 * The camera that shows every point with `padding` pixels to spare, never
 * closer than `maxScale`. Padding can differ per side: labels hang to the
 * right of their dots, and the zoom buttons sit top right.
 */
export function fitPoints(
	points: readonly MapPoint[],
	viewport: Viewport,
	padding: number | Padding = 48,
	maxScale = 0.12
): Camera {
	const pad = typeof padding === "number" ? { left: padding, top: padding, right: padding, bottom: padding } : padding;
	if (points.length === 0) return clampCamera({ cx: MAP_WIDTH / 2, cy: MAP_HEIGHT / 2, scale: 0 }, viewport);
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (const p of points) {
		if (p.x < minX) minX = p.x;
		if (p.x > maxX) maxX = p.x;
		if (p.y < minY) minY = p.y;
		if (p.y > maxY) maxY = p.y;
	}
	const usableW = Math.max(1, viewport.width - pad.left - pad.right);
	const usableH = Math.max(1, viewport.height - pad.top - pad.bottom);
	const spanW = Math.max(maxX - minX, 1);
	const spanH = Math.max(maxY - minY, 1);
	const scale = Math.min(maxScale, usableW / spanW, usableH / spanH);
	// Centre the points in the padded box, not the frame.
	const cx = (minX + maxX) / 2 + (pad.right - pad.left) / 2 / scale;
	const cy = (minY + maxY) / 2 + (pad.bottom - pad.top) / 2 / scale;
	return clampCamera({ cx, cy, scale }, viewport);
}

export function toScreen(point: MapPoint, camera: Camera, viewport: Viewport): MapPoint {
	return {
		x: (point.x - camera.cx) * camera.scale + viewport.width / 2,
		y: (point.y - camera.cy) * camera.scale + viewport.height / 2,
	};
}

export function toMap(screen: MapPoint, camera: Camera, viewport: Viewport): MapPoint {
	return {
		x: (screen.x - viewport.width / 2) / camera.scale + camera.cx,
		y: (screen.y - viewport.height / 2) / camera.scale + camera.cy,
	};
}

/** Zoom by `factor` keeping the map point under `anchor` (screen pixels) where it is. */
export function zoomAround(camera: Camera, viewport: Viewport, factor: number, anchor: MapPoint): Camera {
	const before = toMap(anchor, camera, viewport);
	const scale = Math.min(MAX_SCALE, Math.max(minScale(viewport), camera.scale * factor));
	const next = { cx: camera.cx, cy: camera.cy, scale };
	const after = toMap(anchor, next, viewport);
	return clampCamera({ cx: camera.cx + before.x - after.x, cy: camera.cy + before.y - after.y, scale }, viewport);
}

/** The SVG viewBox for a camera. */
export function viewBoxFor(camera: Camera, viewport: Viewport): string {
	const w = viewport.width / camera.scale;
	const h = viewport.height / camera.scale;
	return `${(camera.cx - w / 2).toFixed(2)} ${(camera.cy - h / 2).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)}`;
}

/** Ease between two cameras, zooming out a little mid-flight when they are far apart. */
export function interpolateCamera(from: Camera, to: Camera, t: number): Camera {
	const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
	const distance = Math.hypot(to.cx - from.cx, to.cy - from.cy);
	const reach = distance * Math.min(from.scale, to.scale);
	// A long hop pulls back to keep both ends in sight, like a globe fly-to.
	const dip = reach > 600 ? 1 - Math.sin(Math.PI * e) * Math.min(0.55, reach / 4000) : 1;
	const logScale = Math.log(from.scale) + (Math.log(to.scale) - Math.log(from.scale)) * e;
	return {
		cx: from.cx + (to.cx - from.cx) * e,
		cy: from.cy + (to.cy - from.cy) * e,
		scale: Math.exp(logScale) * dip,
	};
}

/* --------------------------------------------------------------- markers */

/** A marker's footprint around its point, in pixels: its dot and any label it writes. */
export interface MarkerBox {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

export interface DeclutterCandidate {
	id: string;
	x: number;
	y: number;
	/** Lower draws first and wins a collision. */
	priority: number;
	box?: MarkerBox;
}

/** Roughly how wide a label is, for collision purposes: names are short and the font is known. */
export function labelBox(name: string, kind: "point" | "area"): MarkerBox {
	if (kind === "area") {
		const half = (name.length * 9 + 8) / 2;
		return { left: -half, top: -10, right: half, bottom: 10 };
	}
	return { left: -12, top: -12, right: 12 + name.length * 7.4, bottom: 12 };
}

const DOT_BOX: MarkerBox = { left: -12, top: -12, right: 12, bottom: 12 };

/**
 * Which markers to draw so no two tap targets, and no two labels, sit on top
 * of each other: candidates are taken in priority order, and one whose centre
 * is closer than `minDistance` pixels to a marker already taken, or whose
 * footprint overlaps one, is skipped. Off-screen markers are skipped.
 */
export function declutter(
	candidates: readonly DeclutterCandidate[],
	viewport: Viewport,
	minDistance = 30
): Set<string> {
	const taken: { x: number; y: number; l: number; t: number; r: number; b: number }[] = [];
	const shown = new Set<string>();
	const sorted = [...candidates].sort((a, b) => a.priority - b.priority || (a.id < b.id ? -1 : 1));
	const margin = 24;
	for (const c of sorted) {
		if (c.x < -margin || c.y < -margin || c.x > viewport.width + margin || c.y > viewport.height + margin) continue;
		const box = c.box ?? DOT_BOX;
		const rect = { x: c.x, y: c.y, l: c.x + box.left, t: c.y + box.top, r: c.x + box.right, b: c.y + box.bottom };
		const collides = taken.some(
			(t) => Math.hypot(t.x - c.x, t.y - c.y) < minDistance || (rect.l < t.r && rect.r > t.l && rect.t < t.b && rect.b > t.t)
		);
		if (collides) continue;
		taken.push(rect);
		shown.add(c.id);
	}
	return shown;
}

/* ------------------------------------------------------------------ dates */

/** "975 BC", "AD 30". Years are signed, BC negative, with no year zero. */
export function formatYear(year: number): string {
	return year < 0 ? `${-year} BC` : `AD ${year}`;
}

/** "c. 975 - 958 BC", "c. 4 BC - AD 30", "c. AD 45 - 48", "c. 520 BC". */
export function formatYearSpan(start: number, end: number): string {
	if (start === end) return `c. ${formatYear(start)}`;
	if (start < 0 && end < 0) return `c. ${-start} - ${-end} BC`;
	if (start > 0 && end > 0) return `c. AD ${start} - ${end}`;
	return `c. ${formatYear(start)} - ${formatYear(end)}`;
}

/* -------------------------------------------------------------- timeline */

export interface TimelineSegment {
	start: number;
	end: number;
	weight: number;
}

export interface TimelineScale {
	min: number;
	max: number;
	/** 0..1 across the track. */
	toPosition(year: number): number;
	/** The whole year at a 0..1 position. */
	toYear(position: number): number;
}

/**
 * A piecewise-linear scale: each segment (an era) gets track width in
 * proportion to its weight, so four centuries of silence do not take more
 * room than the thirty-three years of the Gospels.
 */
export function buildTimelineScale(segments: readonly TimelineSegment[]): TimelineScale {
	const sorted = [...segments].filter((s) => s.end > s.start && s.weight > 0).sort((a, b) => a.start - b.start);
	if (sorted.length === 0) {
		return { min: 0, max: 1, toPosition: () => 0, toYear: () => 0 };
	}
	const total = sorted.reduce((sum, s) => sum + s.weight, 0);
	const stops: { start: number; end: number; from: number; to: number }[] = [];
	let at = 0;
	for (const s of sorted) {
		const width = s.weight / total;
		stops.push({ start: s.start, end: s.end, from: at, to: at + width });
		at += width;
	}
	const min = sorted[0].start;
	const max = sorted[sorted.length - 1].end;
	return {
		min,
		max,
		toPosition(year) {
			if (year <= min) return 0;
			if (year >= max) return 1;
			const stop = stops.find((s) => year >= s.start && year <= s.end) ?? stops.find((s) => year < s.start);
			if (!stop) return 1;
			if (year < stop.start) return stop.from;
			return stop.from + ((year - stop.start) / (stop.end - stop.start)) * (stop.to - stop.from);
		},
		toYear(position) {
			const p = Math.min(1, Math.max(0, position));
			const stop = stops.find((s) => p >= s.from && p <= s.to) ?? stops[stops.length - 1];
			const span = stop.to - stop.from;
			const year = span === 0 ? stop.start : stop.start + ((p - stop.from) / span) * (stop.end - stop.start);
			const rounded = Math.round(year);
			// There is no year zero between 1 BC and AD 1.
			return rounded === 0 ? (year < 0 ? -1 : 1) : rounded;
		},
	};
}

/** True when a span is happening in `year`; a span that starts and ends in one year covers that year. */
export function spanCovers(span: { start: number; end: number }, year: number): boolean {
	return year >= span.start && year <= span.end;
}

/** The spans of a lane happening in `year`. */
export function activeSpans<T extends { start: number; end: number }>(spans: readonly T[], year: number): T[] {
	return spans.filter((span) => spanCovers(span, year));
}

export interface DatedItem {
	id: string;
	start: number;
	end: number;
}

/** The `count` dated items closest to `year`, nearest first; an item covering the year counts as distance 0. */
export function nearestDated<T extends DatedItem>(items: readonly T[], year: number, count: number): T[] {
	const distance = (item: T) => (spanCovers(item, year) ? 0 : Math.min(Math.abs(item.start - year), Math.abs(item.end - year)));
	return [...items]
		.map((item, index) => ({ item, index, d: distance(item) }))
		.sort((a, b) => a.d - b.d || a.index - b.index)
		.slice(0, count)
		.map((entry) => entry.item);
}

/** The previous or next distinct year on which something starts, for stepping the scrubber. */
export function stepToNext(years: readonly number[], year: number, direction: 1 | -1): number {
	const sorted = [...new Set(years)].sort((a, b) => a - b);
	if (direction > 0) return sorted.find((y) => y > year) ?? year;
	for (let i = sorted.length - 1; i >= 0; i--) if (sorted[i] < year) return sorted[i];
	return year;
}

/* ------------------------------------------------------- names in verses */

/**
 * Lowercase words with punctuation dropped, like `normalizeAtlasName`, except
 * that a hyphen inside a word joins it: the KJV prints "Beth-el",
 * "Ezion-gaber" and "Pi-hahiroth" where the atlas writes Bethel, Eziongaber
 * and Pihahiroth.
 */
export function nameTokens(value: string): string[] {
	const normalized = value
		.toLowerCase()
		.replace(/([a-z])-(?=[a-z])/g, "$1")
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
	return normalized ? normalized.split(" ") : [];
}

export interface NamedPlace {
	id: string;
	names: readonly string[];
}

/**
 * The places a verse names, in the order they first appear. A longer name
 * wins over a shorter one at the same words, so "Antioch in Pisidia" is not
 * also read as Antioch, and "Caesarea Philippi" not as Caesarea.
 */
export function placesNamedIn(text: string, places: readonly NamedPlace[]): string[] {
	const words = nameTokens(text);
	const patterns = places
		.flatMap((place) => place.names.map((name) => ({ id: place.id, tokens: nameTokens(name) })))
		.filter((p) => p.tokens.length > 0)
		.sort((a, b) => b.tokens.length - a.tokens.length);
	const found: string[] = [];
	let i = 0;
	while (i < words.length) {
		const match = patterns.find((p) => p.tokens.every((token, k) => words[i + k] === token));
		if (match) {
			if (!found.includes(match.id)) found.push(match.id);
			i += match.tokens.length;
		} else {
			i += 1;
		}
	}
	return found;
}

/* ------------------------------------------------------------------ people */

/** A reference reduced to the chapters it covers (atlas-core's `AtlasRef` satisfies it). */
export interface ChapterSpan {
	order: number;
	book: string;
	chapter: number;
	endChapter: number;
}

export interface LifeChapter {
	/** The Vault's chapter key, "9.17". */
	key: string;
	/** "1 Samuel 17". */
	label: string;
	/** The life events (by index) with a reference in this chapter. */
	events: number[];
}

/**
 * Every chapter a person's life touches (LC-17725): each event's references
 * in life order, then the person's own, each chapter once. The Vault's
 * passage search runs once per chapter, so a study on any of them is found.
 */
export function lifeChapters(events: readonly (readonly ChapterSpan[])[], own: readonly ChapterSpan[]): LifeChapter[] {
	const chapters = new Map<string, LifeChapter>();
	const add = (ref: ChapterSpan, event: number | null) => {
		for (let chapter = ref.chapter; chapter <= ref.endChapter; chapter++) {
			const key = `${ref.order}.${chapter}`;
			const entry = chapters.get(key) ?? { key, label: `${ref.book} ${chapter}`, events: [] };
			if (event !== null && !entry.events.includes(event)) entry.events.push(event);
			chapters.set(key, entry);
		}
	};
	events.forEach((refs, index) => refs.forEach((ref) => add(ref, index)));
	own.forEach((ref) => add(ref, null));
	return [...chapters.values()];
}

/* ---------------------------------------------------------------- the URL */

export type AtlasMode = "journeys" | "timeline" | "places" | "people";

/** "Divided Kingdom" -> "divided-kingdom", for the `era` query parameter. */
export function eraSlug(era: string): string {
	return nameTokens(era).join("-");
}

export interface AtlasUrlState {
	mode: AtlasMode;
	journey: string;
	/** Zero-based; the URL carries it one-based. */
	stop: number;
	year: number;
	era: string | null;
	region: string | null;
	/** People mode (LC-17725): the person whose life is open, or null for the search. */
	person: string | null;
	/** Zero-based event in that life; the URL carries it one-based. */
	step: number;
	selection: { kind: "place" | "event"; id: string } | null;
}

export interface AtlasUrlKnown {
	journeys: readonly { id: string; stops: number }[];
	eras: readonly string[];
	regions: readonly string[];
	places: ReadonlySet<string>;
	events: ReadonlyMap<string, number | null>;
	/** Each person's id and how many events their life has. */
	people: ReadonlyMap<string, number>;
	defaultJourney: string;
	defaultYear: number;
}

const YEAR_MIN = -4004;
const YEAR_MAX = 96;

/**
 * Read the atlas's query string, trusting nothing: an unknown journey, stop,
 * era, region, place or event falls back to the default rather than erroring,
 * so an old or hand-typed link still opens something sensible.
 */
export function parseAtlasUrl(params: Readonly<Record<string, string | string[] | undefined>>, known: AtlasUrlKnown): AtlasUrlState {
	const one = (key: string): string | null => {
		const value = params[key];
		const text = Array.isArray(value) ? value[0] : value;
		return typeof text === "string" && text.length <= 80 ? text : null;
	};
	const journeyParam = one("journey");
	const journey = known.journeys.find((entry) => entry.id === journeyParam) ?? known.journeys.find((entry) => entry.id === known.defaultJourney) ?? known.journeys[0];
	const stopParam = Number.parseInt(one("stop") ?? "", 10);
	const stop = Number.isInteger(stopParam) && stopParam >= 1 && stopParam <= journey.stops ? stopParam - 1 : 0;
	const eraParam = one("era");
	const era = known.eras.find((name) => eraSlug(name) === eraParam) ?? null;
	const regionParam = one("region");
	const region = known.regions.includes(regionParam ?? "") ? regionParam : null;
	const placeParam = one("place");
	const eventParam = one("event");
	const selection =
		placeParam && known.places.has(placeParam)
			? { kind: "place" as const, id: placeParam }
			: eventParam && known.events.has(eventParam)
				? { kind: "event" as const, id: eventParam }
				: null;
	const yearParam = Number.parseInt(one("year") ?? "", 10);
	const eventYear = selection?.kind === "event" ? known.events.get(selection.id) ?? null : null;
	const year = Number.isInteger(yearParam) && yearParam !== 0 && yearParam >= YEAR_MIN && yearParam <= YEAR_MAX ? yearParam : eventYear ?? known.defaultYear;
	const personParam = one("person");
	const lifeLength = personParam ? known.people.get(personParam) : undefined;
	const person = lifeLength === undefined ? null : personParam;
	const stepParam = Number.parseInt(one("step") ?? "", 10);
	const step = lifeLength !== undefined && Number.isInteger(stepParam) && stepParam >= 1 && stepParam <= lifeLength ? stepParam - 1 : 0;
	const modeParam = one("mode");
	const mode: AtlasMode =
		modeParam === "journeys" || modeParam === "timeline" || modeParam === "places" || modeParam === "people"
			? modeParam
			: person
				? "people"
				: selection?.kind === "event"
					? "timeline"
					: selection?.kind === "place"
						? "places"
						: "journeys";
	return { mode, journey: journey.id, stop, year, era, region, person: mode === "people" ? person : null, step: mode === "people" && person ? step : 0, selection };
}

/** The query string for a state, carrying only what that mode uses. */
export function atlasUrlQuery(state: AtlasUrlState): string {
	const params = new URLSearchParams();
	params.set("mode", state.mode);
	if (state.mode === "journeys") {
		params.set("journey", state.journey);
		if (state.stop > 0) params.set("stop", String(state.stop + 1));
	}
	if (state.mode === "timeline") {
		params.set("year", String(state.year));
		if (state.era) params.set("era", eraSlug(state.era));
	}
	if (state.mode === "places" && state.region) params.set("region", state.region);
	if (state.mode === "people" && state.person) {
		params.set("person", state.person);
		if (state.step > 0) params.set("step", String(state.step + 1));
	}
	if (state.selection) params.set(state.selection.kind, state.selection.id);
	return params.toString();
}

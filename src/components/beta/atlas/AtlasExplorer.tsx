"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CalendarRange, MapPinned, Route } from "lucide-react";
import { atlasUrlQuery, nearestDated, type AtlasMode, type AtlasUrlState, type MapPoint } from "@/lib/beta/atlas/atlas-rules";
import type { BetaAtlasIndex } from "@/lib/beta/atlas/types";
import AtlasMap, { type AtlasFocus, type AtlasRoute } from "./AtlasMap";
import AtlasCardView from "./AtlasCardView";
import JourneyPanel from "./JourneyPanel";
import PlacesPanel from "./PlacesPanel";
import { ATLAS_REGIONS } from "@/lib/beta/atlas/regions";
import TimelinePanel from "./TimelinePanel";
import type { AtlasSelection } from "./useAtlasData";
import { atlasHeading } from "./atlasUi";

/** How long a playing journey stays on each stop. */
const STOP_MS = 8000;
/** Closest the map comes when following a journey: the Gospels are walked in a small land. */
const FOLLOW_SCALE: Record<string, number> = { gospels: 0.3, abraham: 0.09, exodus: 0.12 };

const MODES: readonly { id: AtlasMode; label: string; Icon: typeof Route }[] = [
	{ id: "journeys", label: "Journeys", Icon: Route },
	{ id: "timeline", label: "Timeline", Icon: CalendarRange },
	{ id: "places", label: "Places", Icon: MapPinned },
];

/**
 * SureWord Beta's Atlas & Timeline (LC-17655, docs/beta/atlas.md): one map,
 * and three ways through it. Journeys play stop by stop with the map
 * following, the timeline scrubs the centuries with the two kingdoms side by
 * side, and Places explores every site. Any place or event opens a card with
 * its passages from the bundled KJV and a way into the reader.
 *
 * The state lives in the URL (replaceState, no navigation), so a refresh,
 * Back, or a link from the reader returns to the same study.
 */
export default function AtlasExplorer({ index, initial }: { index: BetaAtlasIndex; initial: AtlasUrlState }) {
	const [mode, setMode] = useState<AtlasMode>(initial.mode);
	const [journeyId, setJourneyId] = useState(initial.journey);
	const [stop, setStop] = useState(initial.stop);
	const [playing, setPlaying] = useState(false);
	const [year, setYear] = useState(initial.year);
	const [era, setEra] = useState<string | null>(initial.era);
	const [region, setRegion] = useState<string | null>(initial.region);
	const [selection, setSelection] = useState<AtlasSelection | null>(initial.selection);
	// Bumped whenever something asks the map to fly, so it flies even to the same place again.
	const [focusNonce, setFocusNonce] = useState(0);

	const placeById = useMemo(() => new Map(index.places.map((place) => [place.id, place])), [index.places]);
	const eventById = useMemo(() => new Map(index.events.map((event) => [event.id, event])), [index.events]);
	const journey = index.journeys.find((entry) => entry.id === journeyId) ?? index.journeys[0];
	const markerFor = useCallback((id: string) => (placeById.has(id) ? id : index.sameSite[id] ?? null), [placeById, index.sameSite]);
	const pointOf = useCallback(
		(id: string): MapPoint[] => {
			const place = placeById.get(markerFor(id) ?? "");
			return place ? [{ x: place.x, y: place.y }] : [];
		},
		[placeById, markerFor]
	);

	/* --------------------------------------------------------- the URL */
	useEffect(() => {
		const query = atlasUrlQuery({ mode, journey: journey.id, stop, year, era, region, selection });
		const next = `${window.location.pathname}?${query}`;
		if (`${window.location.pathname}${window.location.search}` === next) return;
		/* A scrub changes the year on every pointermove and WebKit throws past ~100 replaceState calls in 30 s,
		   so write the settled state only. Null state is Next's documented form: it keeps its router in step. */
		const timer = window.setTimeout(() => {
			try {
				window.history.replaceState(null, "", next);
			} catch {
				/* The address is a convenience; a refused write must not take the atlas down. */
			}
		}, 250);
		return () => window.clearTimeout(timer);
	}, [mode, journey.id, stop, year, era, region, selection]);

	/* -------------------------------------------------------- playing */
	useEffect(() => {
		if (!playing || mode !== "journeys") return;
		if (stop >= journey.stops.length - 1) {
			setPlaying(false);
			return;
		}
		const timer = window.setTimeout(() => setStop((current) => Math.min(current + 1, journey.stops.length - 1)), STOP_MS);
		return () => window.clearTimeout(timer);
	}, [playing, stop, mode, journey.stops.length]);

	const open = useCallback((next: AtlasSelection) => {
		setPlaying(false);
		setSelection(next);
		setFocusNonce((n) => n + 1);
	}, []);

	const playJourney = useCallback((id: string, at = 0) => {
		setMode("journeys");
		setJourneyId(id);
		setStop(at);
		setSelection(null);
		setPlaying(false);
		setFocusNonce((n) => n + 1);
	}, []);

	/* ------------------------------------------------- what the map shows */
	const nearby = useMemo(() => nearestDated(index.events.filter((event) => event.dated), year, 4), [index.events, year]);

	const emphasis = useMemo(() => {
		if (mode === "journeys") return new Set(journey.stops.map((entry) => entry.place));
		if (mode === "timeline") return new Set(nearby.flatMap((event) => event.places));
		return new Set<string>();
	}, [mode, journey, nearby]);

	const selectedMarker = selection?.kind === "place" ? markerFor(selection.id) : null;
	const current = selectedMarker ?? (mode === "journeys" ? journey.stops[stop].place : null);

	const route: AtlasRoute | null = useMemo(() => {
		if (mode !== "journeys") return null;
		const points = journey.stops.map((entry) => pointOf(entry.place)[0]).filter(Boolean);
		return { points, sea: journey.stops.slice(1).map((entry) => entry.by === "sea"), reached: stop };
	}, [mode, journey, stop, pointOf]);

	const focus: AtlasFocus | null = useMemo(() => {
		if (selection?.kind === "place") {
			return { key: `place:${selection.id}:${focusNonce}`, points: pointOf(selection.id), maxScale: mode === "journeys" ? FOLLOW_SCALE[journey.id] ?? 0.14 : 0.18 };
		}
		if (selection?.kind === "event") {
			const points = (eventById.get(selection.id)?.places ?? []).flatMap((id) => pointOf(id));
			if (points.length) return { key: `event:${selection.id}:${focusNonce}`, points, maxScale: 0.18 };
		}
		if (mode === "journeys") {
			const here = pointOf(journey.stops[stop].place);
			const before = stop > 0 ? pointOf(journey.stops[stop - 1].place) : [];
			// The first stop shows the whole journey; after that the leg just walked.
			return stop === 0 && !playing
				? { key: `journey:${journey.id}:${focusNonce}`, points: journey.stops.flatMap((entry) => pointOf(entry.place)) }
				: { key: `stop:${journey.id}:${stop}:${focusNonce}`, points: [...before, ...here], maxScale: FOLLOW_SCALE[journey.id] ?? 0.12 };
		}
		if (mode === "places") {
			const preset = ATLAS_REGIONS.find((entry) => entry.id === (region ?? "world")) ?? ATLAS_REGIONS[0];
			return { key: `region:${preset.id}:${focusNonce}`, points: preset.places.flatMap((id) => pointOf(id)), maxScale: preset.maxScale ?? 0.2 };
		}
		if (mode === "timeline" && era) {
			const points = index.events.filter((event) => event.era === era).flatMap((event) => event.places.flatMap((id) => pointOf(id)));
			return { key: `era:${era}:${focusNonce}`, points };
		}
		return null;
	}, [selection, mode, journey, stop, playing, region, era, focusNonce, pointOf, eventById, index.events]);

	const onMapSelect = (id: string) => open({ kind: "place", id });

	return (
		<main className="mx-auto w-full max-w-7xl px-5 pb-[calc(var(--sureword-mobile-tab-clearance)+24px)] pt-3 lg:px-8 lg:pb-16 lg:pt-6">
			<div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_440px] lg:gap-6">
				<header className="lg:col-start-2 lg:row-start-1">
					<Link href="/beta/bible" className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-bold text-neutral-600 hover:bg-black/5 dark:text-[#bbb3a7] dark:hover:bg-white/5">
						<ArrowLeft size={18} aria-hidden /> Bible
					</Link>
					<h1 className={`${atlasHeading} mt-1 text-[clamp(2.2rem,8vw,2.8rem)]`}>Atlas &amp; Timeline</h1>
					<div role="group" aria-label="View" className="mt-3 grid grid-cols-3 gap-1 rounded-full border border-black/10 bg-white/40 p-1 dark:border-white/10 dark:bg-white/[.03]">
						{MODES.map(({ id, label, Icon }) => (
							<button
								key={id}
								type="button"
								aria-pressed={mode === id}
								onClick={() => {
									setMode(id);
									setSelection(null);
									setPlaying(false);
								}}
								className={`flex min-h-11 items-center justify-center gap-1.5 rounded-full text-sm font-bold transition-colors ${mode === id ? "bg-[#24281f] text-[#f6f2e9] dark:bg-[#e5b664] dark:text-[#1c2118]" : "text-neutral-700 hover:bg-black/5 dark:text-[#d9d1c3] dark:hover:bg-white/5"}`}
							>
								<Icon size={16} aria-hidden /> {label}
							</button>
						))}
					</div>
				</header>

				<div className="h-[46dvh] min-h-[300px] overflow-hidden rounded-[22px] border border-black/[.09] dark:border-white/[.09] lg:sticky lg:top-6 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:h-[calc(100dvh-3rem)] lg:self-start">
					<AtlasMap
						places={index.places}
						emphasis={emphasis}
						current={current}
						route={route}
						focus={focus}
						onSelect={onMapSelect}
						label={mode === "journeys" ? `Map of ${journey.title}` : mode === "timeline" ? "Map of the events nearest the year" : "Map of the places of the Bible"}
					/>
				</div>

				<div className="flex min-w-0 flex-col gap-5 lg:col-start-2 lg:row-start-2">
					{selection ? (
						<AtlasCardView
							key={`${selection.kind}:${selection.id}`}
							selection={selection}
							onClose={() => setSelection(null)}
							onOpen={open}
							onPlayJourney={playJourney}
						/>
					) : null}

					{mode === "journeys" ? (
						<JourneyPanel
							journeys={index.journeys}
							journey={journey}
							stop={stop}
							playing={playing}
							places={placeById}
							onJourney={(id) => playJourney(id, 0)}
							onStop={(next) => {
								setSelection(null);
								setStop(next);
							}}
							onPlaying={setPlaying}
							onOpen={open}
						/>
					) : mode === "timeline" ? (
						<TimelinePanel
							eras={index.eras}
							lanes={index.lanes}
							events={index.events}
							year={year}
							era={era}
							onYear={setYear}
							onEra={(next) => {
								setEra(next);
								const span = next ? index.eras.find((entry) => entry.era === next) : null;
								if (span && (year < span.start || year > span.end)) setYear(span.start);
								setFocusNonce((n) => n + 1);
							}}
							onOpen={open}
							onJourney={(id) => playJourney(id, 0)}
						/>
					) : (
						<PlacesPanel
							places={index.places}
							region={region}
							onRegion={(id) => {
								setRegion(id);
								setSelection(null);
								setFocusNonce((n) => n + 1);
							}}
							onOpen={open}
						/>
					)}
				</div>
			</div>
		</main>
	);
}

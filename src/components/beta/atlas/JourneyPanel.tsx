"use client";

import { ChevronLeft, ChevronRight, MapPin, Pause, Play, Ship } from "lucide-react";
import type { AtlasJourneyView, AtlasMapPlace } from "@/lib/beta/atlas/types";
import { useJourneyPassages, type AtlasSelection } from "./useAtlasData";
import { AskLink, CertaintyChip, Passages, ReaderLink, atlasCard, atlasChip, atlasChipOn, atlasEyebrow, atlasHeading } from "./atlasUi";

interface JourneyPanelProps {
	journeys: readonly AtlasJourneyView[];
	journey: AtlasJourneyView;
	stop: number;
	playing: boolean;
	places: ReadonlyMap<string, AtlasMapPlace>;
	onJourney: (id: string) => void;
	onStop: (index: number) => void;
	onPlaying: (playing: boolean) => void;
	onOpen: (selection: AtlasSelection) => void;
}

/**
 * Journeys played stop by stop (LC-17655): pick a journey, then step or play
 * through its stops while the map follows. Each stop shows its verses from the
 * bundled KJV, fetched once for the whole journey, and a short note that says
 * only what those verses say.
 */
export default function JourneyPanel({ journeys, journey, stop, playing, places, onJourney, onStop, onPlaying, onOpen }: JourneyPanelProps) {
	const passages = useJourneyPassages(journey.id);
	const current = journey.stops[stop];
	const event = current.event;
	const place = places.get(current.place);
	const last = journey.stops.length - 1;

	return (
		<div className="flex flex-col gap-5">
			<div role="group" aria-label="Journeys" className="flex flex-wrap gap-2">
				{journeys.map((entry) => (
					<button key={entry.id} type="button" aria-pressed={entry.id === journey.id} onClick={() => onJourney(entry.id)} className={entry.id === journey.id ? atlasChipOn : atlasChip}>
						{entry.short}
					</button>
				))}
			</div>

			<header>
				<p className={atlasEyebrow}>
					{journey.when} · {journey.stops.length} stops
				</p>
				<h2 className={`${atlasHeading} mt-1 text-[2.1rem]`}>{journey.title}</h2>
				<p className="mt-2 text-[15px] leading-6 text-neutral-700 dark:text-[#d9d1c3]">{journey.summary}</p>
				{journey.people.length ? <p className="mt-2 text-sm text-neutral-600 dark:text-[#bbb3a7]">With {journey.people.map((person) => person.name).join(", ")}</p> : null}
			</header>

			<div className={`${atlasCard} p-4`}>
				<div className="flex items-center gap-2">
					<button type="button" onClick={() => onStop(Math.max(0, stop - 1))} disabled={stop === 0} aria-label="Previous stop" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-black/10 disabled:opacity-35 dark:border-white/10">
						<ChevronLeft size={22} aria-hidden />
					</button>
					<button
						type="button"
						onClick={() => {
							if (!playing && stop === last) onStop(0);
							onPlaying(!playing);
						}}
						aria-label={playing ? "Pause the journey" : stop === last ? "Play the journey again from the start" : "Play the journey"}
						className="flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-full bg-[#24281f] px-4 text-[15px] font-bold text-[#f6f2e9] dark:bg-[#e5b664] dark:text-[#1c2118]"
					>
						{playing ? <Pause size={18} aria-hidden /> : <Play size={18} aria-hidden />}
						{playing ? "Pause" : stop === last ? "Play again" : stop === 0 ? "Play journey" : "Play on"}
					</button>
					<button type="button" onClick={() => onStop(Math.min(last, stop + 1))} disabled={stop === last} aria-label="Next stop" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-black/10 disabled:opacity-35 dark:border-white/10">
						<ChevronRight size={22} aria-hidden />
					</button>
				</div>
				<div className="mt-3 flex gap-[3px]" aria-hidden>
					{journey.stops.map((_, index) => (
						<span key={index} className={`h-1.5 flex-1 rounded-full ${index <= stop ? "bg-[#a86f12] dark:bg-[#e5b664]" : "bg-black/10 dark:bg-white/10"}`} />
					))}
				</div>
			</div>

			<article aria-live="polite" aria-label={`Stop ${stop + 1} of ${journey.stops.length}: ${current.name}`} className={`${atlasCard} p-5`}>
				<p className={atlasEyebrow}>
					Stop {stop + 1} of {journey.stops.length}
					{current.by === "sea" ? (
						<span className="ml-2 inline-flex items-center gap-1 normal-case tracking-normal">
							<Ship size={13} aria-hidden /> by sea
						</span>
					) : null}
				</p>
				<h3 className={`${atlasHeading} mt-1 text-[1.9rem]`}>{current.name}</h3>
				{place ? (
					<div className="mt-2 flex flex-wrap items-center gap-2">
						<CertaintyChip certainty={place.certainty} />
					</div>
				) : null}
				<p className="mt-3 text-[15.5px] leading-7">{current.note}</p>
				<p className="mt-1 text-xs text-neutral-500 dark:text-[#9d9686]">A short summary of the verses below; the verses are the authority.</p>
				<div className="mt-4">
					{!passages || passages.status === "loading" ? (
						<p className="text-sm text-neutral-600 dark:text-[#bbb3a7]">Opening the verses…</p>
					) : passages.status === "error" ? (
						<p role="alert" className="text-sm">{passages.message}</p>
					) : (
						<Passages passages={passages.data[stop] ?? []} />
					)}
				</div>
				<div className="mt-5 flex flex-wrap gap-2">
					<ReaderLink refText={current.refs[0]} />
					<button type="button" onClick={() => onOpen({ kind: "place", id: current.place })} className={atlasChip}>
						<MapPin size={15} aria-hidden /> About {current.name}
					</button>
					{event ? (
						<button type="button" onClick={() => onOpen({ kind: "event", id: event.id })} className={atlasChip}>
							{event.title}
						</button>
					) : null}
					<AskLink prompt={`What happened at ${current.name} on ${journey.title}, from the KJV?`} />
				</div>
			</article>

			<section aria-label="All stops">
				<h3 className={atlasEyebrow}>The stops</h3>
				<ol className="mt-3 space-y-1">
					{journey.stops.map((entry, index) => (
						<li key={`${entry.place}-${index}`}>
							<button
								type="button"
								onClick={() => onStop(index)}
								aria-current={index === stop ? "step" : undefined}
								className={`flex min-h-11 w-full items-center gap-3 rounded-[14px] px-3 py-2 text-left transition-colors ${index === stop ? "bg-amber-500/15 dark:bg-amber-300/10" : "hover:bg-black/[.04] dark:hover:bg-white/[.04]"}`}
							>
								<span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${index <= stop ? "bg-[#a86f12] text-white dark:bg-[#e5b664] dark:text-[#1c2118]" : "border border-black/15 text-neutral-600 dark:border-white/15 dark:text-[#bbb3a7]"}`}>{index + 1}</span>
								<span className="min-w-0 flex-1">
									<span className="block font-semibold">{entry.name}</span>
									<span className="block truncate text-xs text-neutral-600 dark:text-[#9d9686]">
										{entry.by === "sea" ? "By sea · " : ""}
										{entry.refs.join("; ")}
									</span>
								</span>
							</button>
						</li>
					))}
				</ol>
			</section>
		</div>
	);
}

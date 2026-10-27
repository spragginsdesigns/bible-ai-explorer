"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronLeft, ChevronRight, MapPin, Pause, Play, Search, UserRound } from "lucide-react";
import { searchAtlasData, type AtlasData, type AtlasEra } from "@/lib/bible/atlas-core";
import type { AtlasLifeEvent, AtlasPersonEntry, AtlasPersonLife } from "@/lib/beta/atlas/types";
import VaultEntryCard from "@/components/beta/vault/VaultEntryCard";
import { usePersonLife, usePersonStudies, type AtlasSelection } from "./useAtlasData";
import { AskLink, Passages, ReaderLink, RefChips, SourceChip, atlasCard, atlasChip, atlasEyebrow, atlasHeading } from "./atlasUi";

interface PeoplePanelProps {
	people: readonly AtlasPersonEntry[];
	person: string | null;
	step: number;
	playing: boolean;
	onPerson: (id: string | null) => void;
	onStep: (index: number) => void;
	onPlaying: (playing: boolean) => void;
	onOpen: (selection: AtlasSelection) => void;
}

/** Studies shown before "Show all". */
const STUDIES_FIRST = 2;

/** How the corpus tells two people apart: its `disambiguator` is a whole label ("Saul, first king of Israel"). */
function fullName(entry: AtlasPersonEntry): string {
	return entry.disambiguator ?? entry.name;
}

/** The disambiguator under the name, without repeating it: "First king of Israel". */
function whichOne(entry: AtlasPersonEntry): string | null {
	const label = entry.disambiguator;
	if (!label || label === entry.name) return null;
	const rest = label.startsWith(`${entry.name}, `) ? label.slice(entry.name.length + 2) : label;
	return rest.charAt(0).toUpperCase() + rest.slice(1);
}

/**
 * People (LC-17725): find a person by any name Scripture uses, then play
 * their life event by event while the map follows, each event with its
 * places and its verses from the bundled KJV. The person's card lists the
 * founder's own studies on those passages, found by the Knowledge Vault.
 */
export default function PeoplePanel({ people, person, step, playing, onPerson, onStep, onPlaying, onOpen }: PeoplePanelProps) {
	const entry = person ? people.find((candidate) => candidate.id === person) ?? null : null;
	if (!entry) return <PeopleSearch people={people} onPerson={onPerson} />;
	return <PersonLife key={entry.id} entry={entry} step={step} playing={playing} onPerson={onPerson} onStep={onStep} onPlaying={onPlaying} onOpen={onOpen} />;
}

/* ---------------------------------------------------------------- search */

function PeopleSearch({ people, onPerson }: { people: readonly AtlasPersonEntry[]; onPerson: (id: string) => void }) {
	const [query, setQuery] = useState("");
	// The corpus's own ranking (name, then the other names Scripture uses), people only.
	const data = useMemo<AtlasData>(
		() => ({
			people: people.map((entry) => ({
				id: entry.id,
				name: entry.name,
				disambiguator: entry.disambiguator ?? undefined,
				alsoCalled: entry.alsoCalled,
				description: "",
				era: entry.era as AtlasEra,
				refs: [],
				related: [],
			})),
			places: [],
			events: [],
			relations: [],
		}),
		[people]
	);
	const byId = useMemo(() => new Map(people.map((entry) => [entry.id, entry])), [people]);
	const results = useMemo(() => {
		if (!query.trim()) return [...people].sort((a, b) => b.events.length - a.events.length || a.name.localeCompare(b.name)).slice(0, 24);
		return searchAtlasData(data, query, 40).flatMap((hit) => byId.get(hit.id) ?? []);
	}, [people, data, byId, query]);

	return (
		<div className="flex flex-col gap-5">
			<header>
				<p className={atlasEyebrow}>{people.length} people</p>
				<h2 className={`${atlasHeading} mt-1 text-[2.1rem]`}>A life in order</h2>
				<p className="mt-2 text-[15px] leading-6 text-neutral-700 dark:text-[#d9d1c3]">
					Choose a person and walk through their life event by event, each with its places on the map and its verses from the KJV.
				</p>
			</header>

			<div>
				<label htmlFor="atlas-person-search" className={atlasEyebrow}>
					Find a person
				</label>
				<div className="mt-2 flex items-center gap-2 rounded-2xl border border-black/10 bg-white/70 px-3 focus-within:border-amber-700/40 dark:border-white/10 dark:bg-white/[.04] dark:focus-within:border-amber-300/40">
					<Search size={18} className="shrink-0 text-neutral-500" aria-hidden />
					<input
						id="atlas-person-search"
						type="search"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="David, Elias, Cephas…"
						autoComplete="off"
						className="min-h-11 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-neutral-500"
					/>
				</div>
			</div>

			<section aria-label={query.trim() ? "People found" : "Lives to explore"}>
				<h3 className={atlasEyebrow}>{query.trim() ? `${results.length} found` : "Lives to explore"}</h3>
				{results.length === 0 ? (
					<p className="mt-3 text-sm text-neutral-600 dark:text-[#bbb3a7]">No one in the atlas goes by that name.</p>
				) : (
					<ul className="mt-3 grid gap-2 sm:grid-cols-2">
						{results.map((entry) => (
							<li key={entry.id}>
								<button type="button" onClick={() => onPerson(entry.id)} className={`${atlasCard} flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left hover:border-amber-700/30 dark:hover:border-amber-300/30`}>
									<UserRound size={17} className="shrink-0 text-amber-800 dark:text-[#e5b664]" aria-hidden />
									<span className="min-w-0 flex-1">
										<span className="block font-semibold">{fullName(entry)}</span>
										<span className="block text-xs text-neutral-600 dark:text-[#9d9686]">
											{entry.era} · {entry.events.length} {entry.events.length === 1 ? "event" : "events"}
											{entry.alsoCalled.length ? ` · also ${entry.alsoCalled.join(", ")}` : ""}
										</span>
									</span>
								</button>
							</li>
						))}
					</ul>
				)}
			</section>
		</div>
	);
}

/* ------------------------------------------------------------------ a life */

interface PersonLifeProps extends Omit<PeoplePanelProps, "people" | "person"> {
	entry: AtlasPersonEntry;
}

function PersonLife({ entry, step, playing, onPerson, onStep, onPlaying, onOpen }: PersonLifeProps) {
	const life = usePersonLife(entry.id);
	const count = entry.events.length;
	const last = count - 1;
	const current = life?.status === "ready" ? life.data.events[step] ?? null : null;

	return (
		<div className="flex flex-col gap-5">
			<button type="button" onClick={() => onPerson(null)} className={`${atlasChip} self-start`}>
				<ArrowLeft size={16} aria-hidden /> All people
			</button>

			<PersonCard entry={entry} life={life?.status === "ready" ? life.data : null} onStep={onStep} />

			{life?.status === "error" ? (
				<p role="alert" className="text-sm">
					{life.message}
				</p>
			) : null}

			{count > 1 ? (
				<div className={`${atlasCard} p-4`}>
					<div className="flex items-center gap-2">
						<button type="button" onClick={() => onStep(Math.max(0, step - 1))} disabled={step === 0} aria-label="Previous event" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-black/10 disabled:opacity-35 dark:border-white/10">
							<ChevronLeft size={22} aria-hidden />
						</button>
						<button
							type="button"
							onClick={() => {
								if (!playing && step === last) onStep(0);
								onPlaying(!playing);
							}}
							aria-label={playing ? "Pause the life" : step === last ? "Play the life again from the start" : "Play the life"}
							className="flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-full bg-[#24281f] px-4 text-[15px] font-bold text-[#f6f2e9] dark:bg-[#e5b664] dark:text-[#1c2118]"
						>
							{playing ? <Pause size={18} aria-hidden /> : <Play size={18} aria-hidden />}
							{playing ? "Pause" : step === last ? "Play again" : step === 0 ? "Play the life" : "Play on"}
						</button>
						<button type="button" onClick={() => onStep(Math.min(last, step + 1))} disabled={step === last} aria-label="Next event" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-black/10 disabled:opacity-35 dark:border-white/10">
							<ChevronRight size={22} aria-hidden />
						</button>
					</div>
					<div className="mt-3 flex gap-[3px]" aria-hidden>
						{entry.events.map((id, index) => (
							<span key={id} className={`h-1.5 flex-1 rounded-full ${index <= step ? "bg-[#a86f12] dark:bg-[#e5b664]" : "bg-black/10 dark:bg-white/10"}`} />
						))}
					</div>
				</div>
			) : null}

			{!life || life.status === "loading" ? (
				<p className="text-sm text-neutral-600 dark:text-[#bbb3a7]">Opening {entry.name}&rsquo;s life…</p>
			) : current ? (
				<LifeEvent event={current} index={step} count={count} personName={fullName(entry)} onPerson={onPerson} onOpen={onOpen} />
			) : null}

			{life?.status === "ready" && life.data.events.length ? (
				<section aria-label={`${fullName(entry)}: the life in order`}>
					<h3 className={atlasEyebrow}>The life in order</h3>
					<ol className="mt-3 space-y-1">
						{life.data.events.map((event, index) => (
							<li key={event.id}>
								<button
									type="button"
									onClick={() => onStep(index)}
									aria-current={index === step ? "step" : undefined}
									className={`flex min-h-11 w-full items-center gap-3 rounded-[14px] px-3 py-2 text-left transition-colors ${index === step ? "bg-amber-500/15 dark:bg-amber-300/10" : "hover:bg-black/[.04] dark:hover:bg-white/[.04]"}`}
								>
									<span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${index <= step ? "bg-[#a86f12] text-white dark:bg-[#e5b664] dark:text-[#1c2118]" : "border border-black/15 text-neutral-600 dark:border-white/15 dark:text-[#bbb3a7]"}`}>{index + 1}</span>
									<span className="min-w-0 flex-1">
										<span className="block font-semibold">{event.title}</span>
										<span className="block truncate text-xs text-neutral-600 dark:text-[#9d9686]">
											{event.label} · {event.refs.join("; ")}
										</span>
									</span>
								</button>
							</li>
						))}
					</ol>
				</section>
			) : null}
		</div>
	);
}

/* ------------------------------------------------------------ the person */

function PersonCard({ entry, life, onStep }: { entry: AtlasPersonEntry; life: AtlasPersonLife | null; onStep: (index: number) => void }) {
	return (
		<section aria-label={`About ${entry.name}`} className={`${atlasCard} p-5`}>
			<p className={atlasEyebrow}>
				{entry.era} · {entry.events.length} {entry.events.length === 1 ? "event" : "events"}
			</p>
			<h2 className={`${atlasHeading} mt-1 text-[2.1rem]`}>{entry.name}</h2>
			{whichOne(entry) ? <p className="text-sm font-semibold text-neutral-700 dark:text-[#d9d1c3]">{whichOne(entry)}</p> : null}
			{entry.alsoCalled.length ? <p className="mt-1 text-sm text-neutral-600 dark:text-[#bbb3a7]">Also called {entry.alsoCalled.join(", ")}</p> : null}
			{life ? (
				<>
					<p className="mt-3 text-[15.5px] leading-7">{life.description}</p>
					{life.refs.length ? (
						<div className="mt-3">
							<RefChips refs={life.refs} />
						</div>
					) : null}
				</>
			) : null}
			<div className="mt-4 flex flex-wrap gap-2">
				<AskLink prompt={`Walk me through the life of ${fullName(entry)}${fullName(entry).includes(",") ? "," : ""} in order, from the KJV.`} />
			</div>
			<PersonStudies entry={entry} onStep={onStep} />
		</section>
	);
}

function PersonStudies({ entry, onStep }: { entry: AtlasPersonEntry; onStep: (index: number) => void }) {
	const router = useRouter();
	const studies = usePersonStudies(entry.id);
	const [all, setAll] = useState(false);
	const stepOf = useMemo(() => new Map(entry.events.map((id, index) => [id, index])), [entry.events]);

	return (
		<div className="mt-6 border-t border-black/[.08] pt-5 dark:border-white/[.08]">
			<h3 className={atlasEyebrow}>Your studies on these passages</h3>
			{!studies || studies.status === "loading" ? (
				<p className="mt-3 text-sm text-neutral-600 dark:text-[#bbb3a7]">Looking through your Knowledge Vault…</p>
			) : studies.status === "error" ? (
				<p role="alert" className="mt-3 text-sm">
					Your studies could not be read just now.
				</p>
			) : studies.data.studies.length === 0 ? (
				<p className="mt-3 text-sm leading-6 text-neutral-600 dark:text-[#bbb3a7]">
					Nothing in your Knowledge Vault touches {entry.name}&rsquo;s passages yet. Notes, highlights, chats, verses you are learning and beta studies on any of these chapters will appear here.
				</p>
			) : (
				<>
					<p className="mt-2 text-sm text-neutral-600 dark:text-[#bbb3a7]">
						{studies.data.more ? `The newest ${studies.data.studies.length}` : studies.data.studies.length} of your studies touch the chapters of this life.
					</p>
					<ul className="mt-3 space-y-3">
						{(all ? studies.data.studies : studies.data.studies.slice(0, STUDIES_FIRST)).map(({ entry: study, events }) => (
							<li key={study.id}>
								<VaultEntryCard entry={study} onPassage={(passage) => router.push(`/beta/library/vault?passage=${encodeURIComponent(passage)}`)} />
								{events.length ? (
									<div className="mt-1.5 flex flex-wrap items-center gap-x-1 px-1 text-sm text-neutral-600 dark:text-[#bbb3a7]">
										<span>In this life:</span>
										{events.map((event, index) => (
											<button key={event.id} type="button" onClick={() => onStep(stepOf.get(event.id) ?? 0)} className="inline-flex min-h-11 items-center rounded px-1 font-semibold text-amber-800 hover:underline dark:text-[#e5b664]">
												{event.title}
												{index < events.length - 1 ? "," : ""}
											</button>
										))}
									</div>
								) : null}
							</li>
						))}
					</ul>
					{studies.data.studies.length > STUDIES_FIRST ? (
						<button type="button" onClick={() => setAll((open) => !open)} aria-expanded={all} className={`${atlasChip} mt-3`}>
							{all ? "Show fewer" : `Show all ${studies.data.studies.length}`}
						</button>
					) : null}
				</>
			)}
		</div>
	);
}

/* --------------------------------------------------------- one event of it */

function LifeEvent({
	event,
	index,
	count,
	personName,
	onPerson,
	onOpen,
}: {
	event: AtlasLifeEvent;
	index: number;
	count: number;
	personName: string;
	onPerson: (id: string) => void;
	onOpen: (selection: AtlasSelection) => void;
}) {
	return (
		<article aria-live="polite" aria-label={`Event ${index + 1} of ${count}: ${event.title}`} className={`${atlasCard} p-5`}>
			<p className={atlasEyebrow}>
				Event {index + 1} of {count} · {event.label}
			</p>
			<h3 className={`${atlasHeading} mt-1 text-[1.9rem]`}>{event.title}</h3>
			<div className="mt-2 flex flex-wrap items-center gap-2">
				<span className="text-xs font-bold text-neutral-600 dark:text-[#bbb3a7]">{event.era}</span>
				{event.dated ? <SourceChip source="corpus" /> : null}
			</div>
			{event.places.length ? (
				<ul className="mt-3 flex flex-wrap gap-2" aria-label="Where">
					{event.places.map((place) => (
						<li key={place.id}>
							<button type="button" onClick={() => onOpen({ kind: "place", id: place.id })} className={atlasChip}>
								<MapPin size={15} aria-hidden /> {place.name}
								{place.marker ? null : <span className="font-normal text-neutral-500 dark:text-[#9d9686]">(not mapped)</span>}
							</button>
						</li>
					))}
				</ul>
			) : (
				<p className="mt-3 text-sm text-neutral-600 dark:text-[#bbb3a7]">Scripture names no place for this event.</p>
			)}
			<p className="mt-3 text-[15.5px] leading-7">{event.summary}</p>
			<p className="mt-1 text-xs text-neutral-500 dark:text-[#9d9686]">A short summary of the verses below; the verses are the authority.</p>
			<div className="mt-4">
				<Passages passages={event.passages} />
			</div>
			{event.refs.length > event.passages.length ? (
				<div className="mt-3">
					<RefChips refs={event.refs.slice(event.passages.length)} />
				</div>
			) : null}
			{event.people.length ? (
				<div className="mt-4">
					<p className="text-sm text-neutral-700 dark:text-[#d9d1c3]">With</p>
					<ul className="mt-2 flex flex-wrap gap-2">
						{event.people.map((other) => (
							<li key={other.id}>
								<button type="button" onClick={() => onPerson(other.id)} className={atlasChip} aria-label={`${other.name}'s life`}>
									<UserRound size={15} aria-hidden /> {other.name}
								</button>
							</li>
						))}
					</ul>
				</div>
			) : null}
			<div className="mt-5 flex flex-wrap gap-2">
				{event.refs[0] ? <ReaderLink refText={event.refs[0]} /> : null}
				<button type="button" onClick={() => onOpen({ kind: "event", id: event.id })} className={atlasChip}>
					About this event
				</button>
				<AskLink prompt={`Tell me about "${event.title}" in the life of ${personName}, from the KJV.`} />
			</div>
		</article>
	);
}

"use client";

import { MapPin, Route, X } from "lucide-react";
import type { AtlasCard } from "@/lib/beta/atlas/types";
import { useAtlasCard, type AtlasSelection } from "./useAtlasData";
import { AskLink, CertaintyChip, CERTAINTY_HINT, EVENT_DATE_NOTE, Passages, ReaderLink, RefChips, atlasCard, atlasChip, atlasEyebrow, atlasHeading } from "./atlasUi";

interface AtlasCardViewProps {
	selection: AtlasSelection;
	onClose: () => void;
	onOpen: (selection: AtlasSelection) => void;
	onPlayJourney: (journeyId: string, stop: number) => void;
}

/**
 * The card a place or event opens in the atlas (LC-17655): what the corpus
 * says, how sure the site is, its passages from the bundled KJV, and the ways
 * on (the reader, chat, its events, the journeys through it).
 */
export default function AtlasCardView({ selection, onClose, onOpen, onPlayJourney }: AtlasCardViewProps) {
	const card = useAtlasCard(selection);
	return (
		<section aria-label={selection.kind === "place" ? "Place" : "Event"} aria-live="polite" className={`${atlasCard} relative p-5`}>
			<button type="button" onClick={onClose} aria-label="Close" className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-full text-neutral-600 hover:bg-black/5 dark:text-[#bbb3a7] dark:hover:bg-white/5">
				<X size={19} aria-hidden />
			</button>
			{!card || card.status === "loading" ? (
				<p className="py-6 text-sm text-neutral-600 dark:text-[#bbb3a7]">Opening…</p>
			) : card.status === "error" ? (
				<p role="alert" className="py-6 pr-10 text-sm text-neutral-700 dark:text-[#d9d1c3]">
					{card.message}
				</p>
			) : (
				<CardBody card={card.data} onOpen={onOpen} onPlayJourney={onPlayJourney} />
			)}
		</section>
	);
}

function CardBody({ card, onOpen, onPlayJourney }: { card: AtlasCard; onOpen: AtlasCardViewProps["onOpen"]; onPlayJourney: AtlasCardViewProps["onPlayJourney"] }) {
	const firstRef = card.refs[0];
	const moreRefs = card.refs.slice(card.passages.length);
	if (card.kind === "place") {
		return (
			<>
				<p className={atlasEyebrow}>
					<MapPin size={13} className="-mt-0.5 mr-1 inline" aria-hidden />
					{card.source === "beta" ? "Place on a journey" : "Place"}
				</p>
				<h2 className={`${atlasHeading} mt-1 pr-10 text-[2rem]`}>{card.name}</h2>
				{card.alsoCalled.length ? <p className="mt-1 text-sm text-neutral-600 dark:text-[#bbb3a7]">Also called {card.alsoCalled.join(", ")}</p> : null}
				<div className="mt-3 flex flex-wrap items-center gap-2">
					{card.certainty ? <CertaintyChip certainty={card.certainty} /> : null}
					{card.modernRegion ? <span className="text-xs font-bold text-neutral-600 dark:text-[#bbb3a7]">Today: {card.modernRegion}</span> : null}
				</div>
				<p className="mt-3 text-[15.5px] leading-7">{card.description}</p>
				{card.certainty && card.certainty !== "known" ? <p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-[#bbb3a7]">{CERTAINTY_HINT[card.certainty]}</p> : null}
				{card.siteNote ? <p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-[#bbb3a7]">{card.siteNote}</p> : null}

				<h3 className={`${atlasEyebrow} mt-6`}>In Scripture</h3>
				<div className="mt-3">
					<Passages passages={card.passages} />
				</div>
				{moreRefs.length ? (
					<div className="mt-3">
						<RefChips refs={moreRefs} />
					</div>
				) : null}

				{card.events.length ? (
					<>
						<h3 className={`${atlasEyebrow} mt-6`}>What happened here</h3>
						<ul className="mt-3 flex flex-wrap gap-2">
							{card.events.map((event) => (
								<li key={event.id}>
									<button type="button" onClick={() => onOpen({ kind: "event", id: event.id })} className={atlasChip}>
										{event.title} <span className="font-normal text-neutral-500 dark:text-[#9d9686]">{event.label}</span>
									</button>
								</li>
							))}
						</ul>
					</>
				) : null}

				{card.journeys.length ? (
					<>
						<h3 className={`${atlasEyebrow} mt-6`}>On a journey</h3>
						<ul className="mt-3 flex flex-wrap gap-2">
							{card.journeys.map((journey) => (
								<li key={journey.id}>
									<button type="button" onClick={() => onPlayJourney(journey.id, journey.stops[0])} className={atlasChip}>
										<Route size={15} aria-hidden /> {journey.title}, stop {journey.stops.map((stop) => stop + 1).join(" & ")}
									</button>
								</li>
							))}
						</ul>
					</>
				) : null}

				<div className="mt-6 flex flex-wrap gap-2">
					{firstRef ? <ReaderLink refText={firstRef} /> : null}
					<AskLink prompt={`What happened at ${card.name} in the Bible?`} />
				</div>
			</>
		);
	}

	return (
		<>
			<p className={atlasEyebrow}>
				{card.era} · {card.label}
			</p>
			<h2 className={`${atlasHeading} mt-1 pr-10 text-[2rem]`}>{card.title}</h2>
			<p className="mt-3 text-[15.5px] leading-7">{card.summary}</p>
			{card.dated ? <p className="mt-2 text-xs leading-5 text-neutral-600 dark:text-[#bbb3a7]">{EVENT_DATE_NOTE}</p> : null}

			<h3 className={`${atlasEyebrow} mt-6`}>In Scripture</h3>
			<div className="mt-3">
				<Passages passages={card.passages} />
			</div>
			{moreRefs.length ? (
				<div className="mt-3">
					<RefChips refs={moreRefs} />
				</div>
			) : null}

			{card.places.length ? (
				<>
					<h3 className={`${atlasEyebrow} mt-6`}>Where</h3>
					<ul className="mt-3 flex flex-wrap gap-2">
						{card.places.map((place) => (
							<li key={place.id}>
								<button type="button" onClick={() => onOpen({ kind: "place", id: place.id })} className={atlasChip}>
									<MapPin size={15} aria-hidden /> {place.name}
									{place.marker ? null : <span className="font-normal text-neutral-500 dark:text-[#9d9686]">(not mapped)</span>}
								</button>
							</li>
						))}
					</ul>
				</>
			) : null}
			{card.people.length ? <p className="mt-4 text-sm text-neutral-700 dark:text-[#d9d1c3]">Who: {card.people.map((person) => person.name).join(", ")}</p> : null}

			{card.journeys.length ? (
				<ul className="mt-4 flex flex-wrap gap-2">
					{card.journeys.map((journey) => (
						<li key={journey.id}>
							<button type="button" onClick={() => onPlayJourney(journey.id, journey.stop)} className={atlasChip}>
								<Route size={15} aria-hidden /> {journey.title}, stop {journey.stop + 1}
							</button>
						</li>
					))}
				</ul>
			) : null}

			<div className="mt-6 flex flex-wrap gap-2">
				{firstRef ? <ReaderLink refText={firstRef} /> : null}
				<AskLink prompt={`Tell me about ${card.title} (${card.label}) from the KJV.`} />
			</div>
		</>
	);
}

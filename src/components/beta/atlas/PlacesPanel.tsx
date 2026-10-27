"use client";

import { useMemo, useState } from "react";
import { MapPin, Search } from "lucide-react";
import { nameTokens } from "@/lib/beta/atlas/atlas-rules";
import { ATLAS_REGIONS } from "@/lib/beta/atlas/regions";
import type { AtlasMapPlace } from "@/lib/beta/atlas/types";
import type { AtlasSelection } from "./useAtlasData";
import { CERTAINTY_LABEL, atlasCard, atlasChip, atlasChipOn, atlasEyebrow, atlasHeading } from "./atlasUi";


interface PlacesPanelProps {
	places: readonly AtlasMapPlace[];
	region: string | null;
	onRegion: (id: string) => void;
	onOpen: (selection: AtlasSelection) => void;
}

/**
 * Explore every place on the map (LC-17655): fly to a region, or search the
 * atlas's places by any name Scripture uses for them.
 */
export default function PlacesPanel({ places, region, onRegion, onOpen }: PlacesPanelProps) {
	const [query, setQuery] = useState("");
	const results = useMemo(() => {
		const words = nameTokens(query);
		const sorted = [...places].sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
		if (words.length === 0) return sorted.filter((place) => place.rank === 1);
		return sorted.filter((place) => {
			const haystack = nameTokens([place.name, ...place.aliases, ...place.alsoHere.map((entry) => entry.name)].join(" ")).join(" ");
			return words.every((word) => haystack.includes(word));
		});
	}, [places, query]);

	return (
		<div className="flex flex-col gap-5">
			<header>
				<p className={atlasEyebrow}>{places.length} places on the map</p>
				<h2 className={`${atlasHeading} mt-1 text-[2.1rem]`}>Explore the places</h2>
				<p className="mt-2 text-[15px] leading-6 text-neutral-700 dark:text-[#d9d1c3]">
					Tap any place for the passages that name it. Solid dots are sites not in doubt, ringed dots the traditional site, and dashed rings places whose exact spot no one knows.
				</p>
			</header>

			<div role="group" aria-label="Regions" className="flex flex-wrap gap-2">
				{ATLAS_REGIONS.map((entry) => (
					<button key={entry.id} type="button" aria-pressed={region === entry.id} onClick={() => onRegion(entry.id)} className={region === entry.id ? atlasChipOn : atlasChip}>
						{entry.label}
					</button>
				))}
			</div>

			<div>
				<label htmlFor="atlas-place-search" className={atlasEyebrow}>
					Find a place
				</label>
				<div className="mt-2 flex items-center gap-2 rounded-2xl border border-black/10 bg-white/70 px-3 focus-within:border-amber-700/40 dark:border-white/10 dark:bg-white/[.04] dark:focus-within:border-amber-300/40">
					<Search size={18} className="shrink-0 text-neutral-500" aria-hidden />
					<input
						id="atlas-place-search"
						type="search"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Ephesus, Sichem, Olivet…"
						autoComplete="off"
						className="min-h-11 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-neutral-500"
					/>
				</div>
			</div>

			<section aria-label={query.trim() ? "Places found" : "Major places"}>
				<h3 className={atlasEyebrow}>{query.trim() ? `${results.length} found` : "Major places"}</h3>
				{results.length === 0 ? (
					<p className="mt-3 text-sm text-neutral-600 dark:text-[#bbb3a7]">No place on the map goes by that name.</p>
				) : (
					<ul className="mt-3 grid gap-2 sm:grid-cols-2">
						{results.slice(0, 60).map((place) => (
							<li key={place.id}>
								<button type="button" onClick={() => onOpen({ kind: "place", id: place.id })} className={`${atlasCard} flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left hover:border-amber-700/30 dark:hover:border-amber-300/30`}>
									<MapPin size={17} className="shrink-0 text-amber-800 dark:text-[#e5b664]" aria-hidden />
									<span className="min-w-0 flex-1">
										<span className="block font-semibold">{place.name}</span>
										<span className="block text-xs text-neutral-600 dark:text-[#9d9686]">
											{CERTAINTY_LABEL[place.certainty]}
											{place.alsoHere.length ? ` · also ${place.alsoHere.map((entry) => entry.name).join(", ")}` : ""}
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

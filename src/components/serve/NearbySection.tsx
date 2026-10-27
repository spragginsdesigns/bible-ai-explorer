"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ExternalLink, Globe, Loader2, MapPin, Phone, Search } from "lucide-react";
import { MAX_LOCATION_LENGTH } from "@/lib/serve-rules";
import { searchNearby, type ServePlace } from "./serveClient";

export interface NearbySectionHandle {
	focus: () => void;
}

type SearchState =
	| { status: "idle" }
	| { status: "loading" }
	| { status: "ok"; results: ServePlace[] }
	| { status: "unavailable" }
	| { status: "error"; message: string };

const chip =
	"min-h-10 rounded-full border px-3 text-sm font-bold transition-colors focus-visible:outline-amber-600";

function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === "AbortError";
}

/**
 * Places near a city or ZIP the reader types. Never asks the browser for its
 * location: the reader says where, and nothing about the search is stored
 * (the route proxies Places so the key stays on the server).
 */
const NearbySection = forwardRef<NearbySectionHandle, { searches: { id: string; label: string }[] }>(
	function NearbySection({ searches }, ref) {
		const sectionRef = useRef<HTMLElement>(null);
		const inputRef = useRef<HTMLInputElement>(null);
		const controller = useRef<AbortController | null>(null);
		const [location, setLocation] = useState("");
		const [kind, setKind] = useState(searches[0]?.id ?? "food");
		const [state, setState] = useState<SearchState>({ status: "idle" });

		useImperativeHandle(ref, () => ({
			focus: () => {
				sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
				inputRef.current?.focus({ preventScroll: true });
			},
		}));

		useEffect(() => () => controller.current?.abort(), []);

		const run = (place: string, searchKind: string) => {
			const trimmed = place.trim();
			if (trimmed.length < 2) {
				setState({ status: "error", message: "Type a city or ZIP code first." });
				inputRef.current?.focus();
				return;
			}
			controller.current?.abort();
			const next = new AbortController();
			controller.current = next;
			setState({ status: "loading" });
			searchNearby(trimmed, searchKind, next.signal)
				.then((response) => {
					if (next.signal.aborted) return;
					setState(response.status === "ok" ? { status: "ok", results: response.results } : { status: "unavailable" });
				})
				.catch((error: unknown) => {
					if (isAbortError(error) || next.signal.aborted) return;
					setState({ status: "error", message: error instanceof Error ? error.message : "Search failed. Try again." });
				});
		};

		const chooseKind = (id: string) => {
			setKind(id);
			// Re-run only when a place was already searched, so a chip tap never
			// fires a search with an empty box.
			if (state.status !== "idle" && location.trim().length >= 2) run(location, id);
		};

		return (
			<section
				ref={sectionRef}
				id="nearby"
				aria-labelledby="serve-nearby-title"
				className="scroll-mt-20 rounded-[24px] border border-black/10 bg-white/25 p-5 dark:border-white/10 dark:bg-white/[.015]"
			>
				<h2 id="serve-nearby-title" className="text-lg font-bold">
					Near you
				</h2>
				<form
					className="mt-3 flex min-h-12 items-center gap-2 rounded-2xl border border-black/10 px-3 dark:border-white/10"
					onSubmit={(event) => {
						event.preventDefault();
						run(location, kind);
					}}
				>
					<MapPin size={19} className="shrink-0 text-neutral-500" aria-hidden />
					<input
						ref={inputRef}
						value={location}
						onChange={(event) => setLocation(event.target.value)}
						maxLength={MAX_LOCATION_LENGTH}
						aria-label="City or ZIP code"
						placeholder="City or ZIP code"
						autoComplete="postal-code"
						className="min-w-0 flex-1 bg-transparent py-3 text-base outline-none placeholder:text-neutral-500"
					/>
					<button
						type="submit"
						disabled={state.status === "loading"}
						className="flex min-h-11 items-center gap-1.5 px-2 text-sm font-bold text-amber-800 disabled:opacity-50 dark:text-[#e5b664]"
					>
						{state.status === "loading" ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <Search size={17} aria-hidden />}
						Search
					</button>
				</form>
				<div role="group" aria-label="What to look for" className="mt-3 flex flex-wrap gap-2">
					{searches.map((search) => (
						<button
							key={search.id}
							type="button"
							aria-pressed={kind === search.id}
							onClick={() => chooseKind(search.id)}
							className={`${chip} ${
								kind === search.id
									? "border-amber-600/50 bg-amber-500/15 text-amber-900 dark:border-[#e5b664]/50 dark:bg-[#e5b664]/15 dark:text-[#efc574]"
									: "border-black/10 text-neutral-700 hover:bg-black/5 dark:border-white/10 dark:text-neutral-300 dark:hover:bg-white/5"
							}`}
						>
							{search.label}
						</button>
					))}
				</div>

				<div aria-live="polite" className="mt-4">
					{state.status === "loading" ? (
						<p role="status" className="flex items-center gap-2 text-sm text-neutral-500">
							<Loader2 size={16} className="animate-spin" aria-hidden />
							Searching...
						</p>
					) : state.status === "error" ? (
						<p role="alert" className="text-sm text-red-700 dark:text-red-300">
							{state.message}
						</p>
					) : state.status === "unavailable" ? (
						<p className="text-sm text-neutral-600 dark:text-neutral-400">Nearby search isn&apos;t available right now.</p>
					) : state.status === "ok" && state.results.length === 0 ? (
						<p className="text-sm text-neutral-600 dark:text-neutral-400">Nothing turned up there. Try a nearby city or another kind of place.</p>
					) : state.status === "ok" ? (
						<ul className="flex flex-col gap-3">
							{state.results.map((place) => (
								<li key={place.placeId} className="rounded-2xl border border-black/10 px-4 py-3 dark:border-white/10">
									<p className="font-bold">{place.name}</p>
									<p className="mt-0.5 text-sm text-neutral-600 dark:text-neutral-400">{place.address}</p>
									<div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
										{place.mapsUrl ? (
											<a
												href={place.mapsUrl}
												target="_blank"
												rel="noopener noreferrer"
												className="inline-flex min-h-10 items-center gap-1.5 text-sm font-bold text-amber-800 dark:text-[#e5b664]"
											>
												<ExternalLink size={15} aria-hidden />
												Map
											</a>
										) : null}
										{place.website ? (
											<a
												href={place.website}
												target="_blank"
												rel="noopener noreferrer"
												className="inline-flex min-h-10 items-center gap-1.5 text-sm font-bold text-amber-800 dark:text-[#e5b664]"
											>
												<Globe size={15} aria-hidden />
												Website
											</a>
										) : null}
										{place.phone ? (
											<a
												href={`tel:${place.phone.replace(/[^\d+]/g, "")}`}
												className="inline-flex min-h-10 items-center gap-1.5 text-sm font-bold text-amber-800 dark:text-[#e5b664]"
											>
												<Phone size={15} aria-hidden />
												{place.phone}
											</a>
										) : null}
									</div>
								</li>
							))}
						</ul>
					) : null}
				</div>
			</section>
		);
	}
);

export default NearbySection;

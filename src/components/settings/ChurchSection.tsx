"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
	Church,
	ExternalLink,
	Globe,
	Loader2,
	MapPin,
	Phone,
	Search,
	Trash2,
} from "lucide-react";
import {
	CHURCH_SEARCH_DEBOUNCE_MS,
	MIN_CHURCH_QUERY_LENGTH,
	fetchChurch,
	hostnameOf,
	removeChurch,
	saveChurch,
	searchChurches,
	type ChurchProfile,
	type ChurchSearchResult,
} from "@/lib/church-client";
import { cn } from "@/lib/utils";

type LoadState = "loading" | "unavailable" | "ready" | "failed";

/** Mission text longer than this gets clamped behind a "Show more" toggle. */
const MISSION_CLAMP_CHARS = 400;
const MISSION_CLAMP_LINES = 6;

const CARD_CLASS = "glass-card gradient-border rounded-2xl p-4 flex flex-col gap-3";
const FIELD_CLASS =
	"w-full rounded-lg border border-black/[0.1] dark:border-white/[0.08] bg-white dark:bg-neutral-900 pl-9 pr-9 py-2 text-sm text-neutral-800 dark:text-neutral-200 outline-none focus:border-amber-500/50 disabled:opacity-50";

function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === "AbortError";
}

/**
 * Settings -> MY CHURCH: search Google Places for the user's home church, save
 * the pick, and show what SureWord knows about it (photo, address, phone,
 * website, mission statement read from the church's own site). The saved
 * church is injected into every chat, so this is "what the AI knows about you"
 * and sits beside Memory. Mirrors the Android settings screen.
 *
 * When the server has no Places key the routes answer
 * `{ status: "unavailable" }` and this component renders nothing at all, so an
 * unconfigured deploy shows no half-working section.
 */
const ChurchSection: React.FC = () => {
	const [state, setState] = useState<LoadState>("loading");
	const [church, setChurch] = useState<ChurchProfile | null>(null);

	const [searchOpen, setSearchOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<ChurchSearchResult[]>([]);
	const [searchPending, setSearchPending] = useState(false);
	const [searchError, setSearchError] = useState<string | null>(null);

	const [savingPlaceId, setSavingPlaceId] = useState<string | null>(null);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [removePending, setRemovePending] = useState(false);
	const [removeError, setRemoveError] = useState<string | null>(null);

	const [missionExpanded, setMissionExpanded] = useState(false);
	const [failedPhotoUrl, setFailedPhotoUrl] = useState<string | null>(null);


	const load = useCallback(async () => {
		setState("loading");
		try {
			const data = await fetchChurch();
			if (data.status === "unavailable") {
				setState("unavailable");
				return;
			}
			setChurch(data.church);
			setSearchOpen(data.church === null);
			setState("ready");
		} catch {
			setState("failed");
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	// Debounced search. Every keystroke cancels the in-flight request, so a slow
	// response for "grace" can never overwrite the results for "grace chapel".
	useEffect(() => {
		if (!searchOpen) return;
		const trimmed = query.trim();
		if (trimmed.length < MIN_CHURCH_QUERY_LENGTH) {
			setResults([]);
			setSearchPending(false);
			setSearchError(null);
			return;
		}
		setSearchPending(true);
		const controller = new AbortController();
		const timer = setTimeout(() => {
			searchChurches(trimmed, controller.signal)
				.then((data) => {
					if (controller.signal.aborted) return;
					if (data.status === "unavailable") {
						setState("unavailable");
						return;
					}
					setResults(data.results);
					setSearchError(null);
					setSearchPending(false);
				})
				.catch((error: unknown) => {
					if (controller.signal.aborted || isAbortError(error)) return;
					setResults([]);
					setSearchError(
						error instanceof Error ? error.message : "Couldn't search for churches."
					);
					setSearchPending(false);
				});
		}, CHURCH_SEARCH_DEBOUNCE_MS);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	}, [query, searchOpen]);

	const pick = async (placeId: string) => {
		if (savingPlaceId !== null) return;
		setSavingPlaceId(placeId);
		setSaveError(null);
		try {
			const saved = await saveChurch(placeId);
			setChurch(saved);
			setSearchOpen(false);
			setQuery("");
			setResults([]);
			setMissionExpanded(false);
			setFailedPhotoUrl(null);
		} catch (error) {
			setSaveError(
				error instanceof Error ? error.message : "Couldn't load that church, try another result."
			);
		} finally {
			setSavingPlaceId(null);
		}
	};

	const remove = async () => {
		if (removePending) return;
		setRemovePending(true);
		setRemoveError(null);
		try {
			await removeChurch();
			setChurch(null);
			setSearchOpen(true);
			setQuery("");
			setResults([]);
			setMissionExpanded(false);
		} catch (error) {
			setRemoveError(
				error instanceof Error ? error.message : "Couldn't remove your church."
			);
		} finally {
			setRemovePending(false);
		}
	};

	// Nothing visible is rendered until we know the feature exists, so an
	// unconfigured deploy never flashes an empty "MY CHURCH" heading. The empty
	// anchor still has to exist, or the sidebar's "My church" jump link is dead
	// while this is loading and on deploys without a Places key.
	if (state === "loading" || state === "unavailable") {
		return <section id="church" aria-hidden="true" />;
	}

	const saving = savingPlaceId !== null;
	const trimmedQuery = query.trim();
	const missionSourceHost = church?.missionSource ? hostnameOf(church.missionSource) : null;
	const mission = church?.mission ?? null;
	const missionIsLong =
		mission !== null &&
		(mission.length > MISSION_CLAMP_CHARS || mission.split("\n").length > MISSION_CLAMP_LINES);
	const showPhoto = church?.photoUrl != null && failedPhotoUrl !== church.photoUrl;

	return (
		<section id="church" className="flex flex-col gap-2 scroll-mt-20 lg:scroll-mt-6">
			<h2 className="text-metadata font-bold tracking-[0.15em] text-neutral-500 dark:text-neutral-500 px-1">
				MY CHURCH
			</h2>
			<div className={CARD_CLASS}>
				<div className="flex items-center gap-3">
					<span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border border-black/[0.1] dark:border-white/[0.08] bg-black/[0.03] dark:bg-white/[0.03] text-amber-600 dark:text-amber-400">
						<Church className="w-5 h-5" />
					</span>
					<div className="min-w-0 flex-1">
						<p className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
							My church
						</p>
						<p className="text-[13px] text-neutral-400 dark:text-neutral-500">
							Pick your home church so SureWord knows the congregation you belong to.
							Its mission statement is read from the church&apos;s public website.
						</p>
					</div>
				</div>

				{state === "failed" ? (
					<div className="flex items-center justify-between gap-3">
						<p className="text-xs text-neutral-400 dark:text-neutral-500">
							Couldn&apos;t load your church.
						</p>
						<button
							type="button"
							onClick={() => void load()}
							className="text-xs font-bold text-amber-600 dark:text-amber-400"
						>
							Retry
						</button>
					</div>
				) : (
					<>
						{church && (
							<div className="rounded-xl border border-black/[0.1] dark:border-white/[0.08] bg-black/[0.03] dark:bg-white/[0.03] p-3.5 flex flex-col gap-3">
								<div className="flex items-start gap-3">
									{showPhoto && church.photoUrl ? (
										// eslint-disable-next-line @next/next/no-img-element -- church logos and Places photos come from unknown hosts
										<img
											src={church.photoUrl}
											alt=""
											onError={() => setFailedPhotoUrl(church.photoUrl)}
											className="h-16 w-16 flex-shrink-0 rounded-xl border border-black/[0.1] dark:border-white/[0.08] bg-white object-cover dark:bg-neutral-900"
										/>
									) : (
										<span className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-xl border border-black/[0.1] dark:border-white/[0.08] bg-black/[0.03] text-amber-600 dark:bg-white/[0.03] dark:text-amber-400">
											<Church className="h-7 w-7" />
										</span>
									)}
									<div className="min-w-0 flex-1">
										<p className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
											{church.name}
										</p>
										<p className="mt-0.5 flex items-start gap-1.5 text-[13px] text-neutral-400 dark:text-neutral-500">
											<MapPin className="mt-0.5 h-3 w-3 flex-shrink-0" />
											<span className="min-w-0">{church.address}</span>
										</p>
										{church.phone && (
											<a
												href={`tel:${church.phone.replace(/[^\d+]/g, "")}`}
												className="mt-0.5 flex items-center gap-1.5 text-[13px] text-neutral-500 hover:text-amber-600 dark:text-neutral-400 dark:hover:text-amber-400 transition-colors"
											>
												<Phone className="h-3 w-3 flex-shrink-0" />
												{church.phone}
											</a>
										)}
									</div>
								</div>

								{(church.website || church.mapsUrl) && (
									<div className="flex flex-wrap items-center gap-2">
										{church.website && (
											<a
												href={church.website}
												target="_blank"
												rel="noopener noreferrer"
												className="flex items-center gap-1.5 rounded-lg border border-black/[0.1] dark:border-white/[0.08] px-3 py-1.5 text-xs font-bold text-neutral-600 dark:text-neutral-300 hover:bg-black/[0.06] dark:hover:bg-white/[0.06] transition-colors"
											>
												<Globe className="h-3 w-3" />
												{hostnameOf(church.website) ?? "Website"}
											</a>
										)}
										{church.mapsUrl && (
											<a
												href={church.mapsUrl}
												target="_blank"
												rel="noopener noreferrer"
												className="flex items-center gap-1.5 rounded-lg border border-black/[0.1] dark:border-white/[0.08] px-3 py-1.5 text-xs font-bold text-neutral-600 dark:text-neutral-300 hover:bg-black/[0.06] dark:hover:bg-white/[0.06] transition-colors"
											>
												<MapPin className="h-3 w-3" />
												Open in Google Maps
												<ExternalLink className="h-3 w-3 opacity-60" />
											</a>
										)}
									</div>
								)}

								{mission && (
									<div className="flex flex-col gap-1 border-t border-black/[0.06] dark:border-white/[0.06] pt-3">
										<p className="text-metadata font-bold tracking-[0.12em] text-neutral-500 dark:text-neutral-500">
											MISSION
										</p>
										<p
											className={cn(
												"whitespace-pre-line text-[13px] leading-5 text-neutral-600 dark:text-neutral-300",
												missionIsLong && !missionExpanded && "line-clamp-6"
											)}
										>
											{mission}
										</p>
										<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
											{missionIsLong && (
												<button
													type="button"
													onClick={() => setMissionExpanded((open) => !open)}
													className="text-xs font-bold text-amber-600 dark:text-amber-400"
												>
													{missionExpanded ? "Show less" : "Show more"}
												</button>
											)}
											{church.missionSource && missionSourceHost && (
												<a
													href={church.missionSource}
													target="_blank"
													rel="noopener noreferrer"
													className="text-xs text-neutral-400 dark:text-neutral-500 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
												>
													From {missionSourceHost}
												</a>
											)}
										</div>
									</div>
								)}

								{church.about && (
									<div className="flex flex-col gap-1 border-t border-black/[0.06] dark:border-white/[0.06] pt-3">
										<p className="text-metadata font-bold tracking-[0.12em] text-neutral-500 dark:text-neutral-500">
											ABOUT
										</p>
										<p className="whitespace-pre-line text-[13px] leading-5 text-neutral-600 dark:text-neutral-300">
											{church.about}
										</p>
									</div>
								)}

								<div className="flex flex-wrap items-center gap-2 border-t border-black/[0.06] dark:border-white/[0.06] pt-3">
									<button
										type="button"
										disabled={removePending || saving}
										onClick={() => {
											setSearchOpen((open) => !open);
											setSaveError(null);
										}}
										className="rounded-lg border border-black/[0.1] dark:border-white/[0.08] px-3 py-1.5 text-xs font-bold text-neutral-600 dark:text-neutral-300 hover:bg-black/[0.06] dark:hover:bg-white/[0.06] disabled:opacity-40 transition-colors"
									>
										{searchOpen ? "Cancel" : "Change church"}
									</button>
									<button
										type="button"
										disabled={removePending || saving}
										onClick={() => void remove()}
										className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-neutral-500 hover:text-red-500 dark:text-neutral-400 disabled:opacity-40 transition-colors"
									>
										{removePending ? (
											<Loader2 className="h-3 w-3 animate-spin" />
										) : (
											<Trash2 className="h-3 w-3" />
										)}
										Remove
									</button>
								</div>
								{removeError && (
									<p className="text-xs text-red-600 dark:text-red-400">{removeError}</p>
								)}
							</div>
						)}

						{searchOpen && (
							<div className="flex flex-col gap-2">
								<label htmlFor="church-search" className="sr-only">
									Search for your church by name or city
								</label>
								<div className="relative">
									<Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400 dark:text-neutral-500" />
									<input
										id="church-search"
										type="text"
										// Focus only when the user deliberately opened search from a saved
										// church; on first load with no church it must not steal the page.
										autoFocus={church !== null}
										value={query}
										disabled={saving}
										onChange={(event) => setQuery(event.target.value)}
										onKeyDown={(event) => {
											if (event.key === "Enter" && results.length > 0 && !saving) {
												event.preventDefault();
												void pick(results[0].placeId);
											}
										}}
										placeholder="Church name or city"
										autoComplete="off"
										autoCorrect="off"
										spellCheck={false}
										role="combobox"
										aria-expanded={results.length > 0}
										aria-autocomplete="list"
										aria-controls="church-search-results"
										className={FIELD_CLASS}
									/>
									{searchPending && (
										<Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-neutral-400 dark:text-neutral-500" />
									)}
								</div>

								{saving ? (
									<p className="flex items-center gap-2 text-[13px] text-neutral-500 dark:text-neutral-400">
										<Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-amber-600 dark:text-amber-400" />
										Looking up your church and reading its website…
									</p>
								) : (
									<>
										{trimmedQuery.length > 0 &&
											trimmedQuery.length < MIN_CHURCH_QUERY_LENGTH && (
												<p className="text-xs text-neutral-400 dark:text-neutral-500">
													Keep typing, at least {MIN_CHURCH_QUERY_LENGTH} letters.
												</p>
											)}
										{searchError && (
											<p className="text-xs text-red-600 dark:text-red-400">{searchError}</p>
										)}
										{!searchError &&
											!searchPending &&
											trimmedQuery.length >= MIN_CHURCH_QUERY_LENGTH &&
											results.length === 0 && (
												<p className="text-xs text-neutral-400 dark:text-neutral-500">
													No churches matched. Try the church name with its city.
												</p>
											)}
									</>
								)}

								<ul
									id="church-search-results"
									role="listbox"
									aria-label="Church search results"
									aria-busy={searchPending}
									className={cn(
										"flex flex-col gap-1.5",
										results.length === 0 && "hidden"
									)}
								>
									{results.map((result, index) => (
										<li key={result.placeId} role="presentation">
											<button
												type="button"
												role="option"
												aria-selected={index === 0}
												disabled={saving}
												onClick={() => void pick(result.placeId)}
												className="flex w-full items-center gap-3 rounded-xl border border-black/[0.1] dark:border-white/[0.08] bg-black/[0.03] dark:bg-white/[0.03] px-3.5 py-2.5 text-left hover:bg-black/[0.06] dark:hover:bg-white/[0.06] disabled:opacity-40 transition-colors"
											>
												<span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-black/[0.1] dark:border-white/[0.08] text-amber-600 dark:text-amber-400">
													{savingPlaceId === result.placeId ? (
														<Loader2 className="h-4 w-4 animate-spin" />
													) : (
														<Church className="h-4 w-4" />
													)}
												</span>
												<span className="min-w-0 flex-1">
													<span className="block truncate text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
														{result.name}
													</span>
													<span className="block text-[13px] text-neutral-400 dark:text-neutral-500">
														{result.address}
													</span>
												</span>
											</button>
										</li>
									))}
								</ul>

								{results.length > 0 && !saving && (
									<p className="text-xs text-neutral-400 dark:text-neutral-500">
										Press Enter to choose the first result.
									</p>
								)}
								{saveError && (
									<p className="text-xs text-red-600 dark:text-red-400">{saveError}</p>
								)}
							</div>
						)}
					</>
				)}
			</div>
		</section>
	);
};

export default ChurchSection;

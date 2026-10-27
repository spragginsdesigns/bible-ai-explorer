"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ChevronDown, LoaderCircle, Search, X } from "lucide-react";
import { VAULT_KINDS, VAULT_KIND_PLURAL, type VaultEntry, type VaultKind } from "@/lib/beta/vault/vault-rules";
import type { IndexStatus } from "@/lib/beta/vault/meaning";
import VaultEntryCard from "./VaultEntryCard";
import { card, chip, chipOff, chipOn, daysAgo, muted, vaultFetch, type SearchResponse } from "./vaultUi";

export type Period = "" | "30d" | "6m" | "1y" | "custom";

export interface LibraryFilters {
	q: string;
	kinds: VaultKind[];
	period: Period;
	from: string;
	to: string;
	passage: string;
	topic: string;
}

export interface Facets {
	counts: Record<VaultKind, number>;
	topics: { label: string; count: number }[];
}

const PERIODS: { id: Period; label: string }[] = [
	{ id: "", label: "Any time" },
	{ id: "30d", label: "Past month" },
	{ id: "6m", label: "Past 6 months" },
	{ id: "1y", label: "Past year" },
	{ id: "custom", label: "Choose dates" },
];

function apiQuery(filters: LibraryFilters, before?: string | null): string {
	const params = new URLSearchParams();
	if (filters.q) params.set("q", filters.q);
	if (filters.kinds.length) params.set("kind", filters.kinds.join(","));
	const from = filters.period === "30d" ? daysAgo(30) : filters.period === "6m" ? daysAgo(183) : filters.period === "1y" ? daysAgo(365) : filters.period === "custom" ? filters.from : "";
	if (from) params.set("from", from);
	if (filters.period === "custom" && filters.to) params.set("to", filters.to);
	if (filters.passage) params.set("passage", filters.passage);
	if (filters.topic) params.set("topic", filters.topic);
	if (before) params.set("before", before);
	return params.toString();
}

type Results = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: SearchResponse; more: boolean };

/**
 * The Library tab: everything studied, newest first, or what a search finds
 * by words and meaning, narrowed by kind, period, passage and topic.
 */
export default function VaultLibrary({
	filters,
	facets,
	onChange,
	onOverTime,
}: {
	filters: LibraryFilters;
	facets: Facets | null;
	onChange: (patch: Partial<LibraryFilters>) => void;
	onOverTime: (subject: string) => void;
}) {
	const [draft, setDraft] = useState(filters.q);
	const [passageDraft, setPassageDraft] = useState(filters.passage);
	const [results, setResults] = useState<Results>({ status: "loading" });
	const [loadingMore, setLoadingMore] = useState(false);
	const [index, setIndex] = useState<IndexStatus | null>(null);
	const [reload, setReload] = useState(0);
	const query = apiQuery(filters);
	const request = useRef(0);
	/** A meaning-index continuation is running; true while this screen is on screen. */
	const continuing = useRef(false);
	const mounted = useRef(true);

	useEffect(() => setDraft(filters.q), [filters.q]);
	useEffect(() => setPassageDraft(filters.passage), [filters.passage]);

	useEffect(() => {
		const id = ++request.current;
		const abort = new AbortController();
		setResults({ status: "loading" });
		vaultFetch<SearchResponse>(`/api/beta/vault?${query}`, { signal: abort.signal })
			.then((data) => {
				if (id !== request.current) return;
				setResults({ status: "ready", data, more: Boolean(data.nextBefore) });
				// Only a search reports the meaning index; the library and filters clear the line.
				if (!continuing.current) setIndex(data.index);
			})
			.catch((error: unknown) => {
				if (id === request.current && !abort.signal.aborted) setResults({ status: "error", message: error instanceof Error ? error.message : "Your vault could not be searched." });
			});
		return () => abort.abort();
	}, [query, reload]);

	// A search reported sources not yet in meaning search: finish them now, a
	// step at a time, then search again so they count. Only after the founder
	// searched, only while this screen is open, and never past a step that
	// indexed nothing.
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const continueIndex = useCallback(async () => {
		if (continuing.current) return;
		continuing.current = true;
		let indexedAny = false;
		try {
			for (let step = 0; step < 30 && mounted.current; step++) {
				const status = await vaultFetch<IndexStatus>("/api/beta/vault/meaning", { method: "POST" });
				if (!mounted.current) return;
				setIndex(status);
				if (status.indexed > 0) indexedAny = true;
				if (!status.allowed || status.failed || status.pending === 0 || status.indexed === 0) break;
			}
		} catch {
			/* Words search still answers; meaning catches up on the next search. */
		} finally {
			continuing.current = false;
			if (indexedAny && mounted.current) setReload((value) => value + 1);
		}
	}, []);
	useEffect(() => {
		if (index && index.allowed && !index.failed && index.pending > 0) void continueIndex();
	}, [index, continueIndex]);

	const loadMore = async () => {
		if (results.status !== "ready" || !results.data.nextBefore) return;
		// A filter changed while the page was loading means this page belongs to an older list.
		const id = request.current;
		setLoadingMore(true);
		try {
			const page = await vaultFetch<SearchResponse>(`/api/beta/vault?${apiQuery(filters, results.data.nextBefore)}`);
			if (id !== request.current) return;
			setResults((old) => {
				if (old.status !== "ready") return old;
				const seen = new Set(old.data.entries.map((entry) => entry.id));
				const entries = [...old.data.entries, ...page.entries.filter((entry) => !seen.has(entry.id))];
				return { status: "ready", data: { ...page, entries }, more: Boolean(page.nextBefore) };
			});
		} catch {
			/* The button stays; another tap tries again. */
		} finally {
			setLoadingMore(false);
		}
	};

	const submit = (event: FormEvent) => {
		event.preventDefault();
		onChange({ q: draft.trim() });
	};
	const submitPassage = (event: FormEvent) => {
		event.preventDefault();
		onChange({ passage: passageDraft.trim() });
	};
	const toggleKind = (kind: VaultKind) =>
		onChange({ kinds: filters.kinds.includes(kind) ? filters.kinds.filter((k) => k !== kind) : [...filters.kinds, kind] });

	const data = results.status === "ready" ? results.data : null;
	const entries: VaultEntry[] = data?.entries ?? [];
	const narrowed = Boolean(filters.q || filters.kinds.length || filters.period || filters.passage || filters.topic);

	return (
		<div className="flex flex-col gap-4">
			<form role="search" onSubmit={submit} className="flex items-center gap-2 rounded-2xl border border-black/10 bg-white/80 py-1.5 pl-4 pr-1.5 focus-within:border-amber-700/40 dark:border-white/10 dark:bg-white/[.04] dark:focus-within:border-amber-300/40">
				<Search size={19} className="shrink-0 text-neutral-500" aria-hidden />
				<label htmlFor="vault-search" className="sr-only">Search everything you have studied</label>
				<input
					id="vault-search"
					type="search"
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					placeholder="Search everything you have studied"
					enterKeyHint="search"
					autoComplete="off"
					maxLength={200}
					className="min-h-11 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-neutral-500 dark:placeholder:text-neutral-400 [&::-webkit-search-cancel-button]:hidden"
				/>
				{draft ? (
					<button type="button" onClick={() => { setDraft(""); onChange({ q: "" }); }} aria-label="Clear search" className="flex h-11 w-11 items-center justify-center rounded-full text-neutral-500 hover:bg-black/5 dark:hover:bg-white/5">
						<X size={18} aria-hidden />
					</button>
				) : null}
				<button type="submit" className="min-h-11 shrink-0 rounded-xl bg-[#24281f] px-4 text-sm font-bold text-white dark:bg-[#e5b664] dark:text-[#1c2118]">
					Search
				</button>
			</form>

			<div role="group" aria-label="Kinds of study" className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 lg:-mx-0 lg:flex-wrap lg:overflow-visible lg:px-0">
				<button type="button" aria-pressed={filters.kinds.length === 0} onClick={() => onChange({ kinds: [] })} className={`${chip} ${filters.kinds.length === 0 ? chipOn : chipOff}`}>
					All
				</button>
				{VAULT_KINDS.map((kind) => {
					const count = facets?.counts[kind];
					const on = filters.kinds.includes(kind);
					return (
						<button key={kind} type="button" aria-pressed={on} onClick={() => toggleKind(kind)} className={`${chip} ${on ? chipOn : chipOff}`}>
							{VAULT_KIND_PLURAL[kind]}
							{count !== undefined ? <span className={on ? "opacity-75" : "text-neutral-500 dark:text-neutral-400"}>{count}</span> : null}
						</button>
					);
				})}
			</div>

			<div className="flex flex-wrap items-center gap-2">
				<label htmlFor="vault-period" className="sr-only">When</label>
				<span className="relative inline-flex">
					<select
						id="vault-period"
						value={filters.period}
						onChange={(event) => onChange({ period: event.target.value as Period })}
						className={`${chip} ${filters.period ? chipOn : chipOff} cursor-pointer appearance-none pr-9`}
					>
						{PERIODS.map((period) => (
							<option key={period.id} value={period.id}>{period.label}</option>
						))}
					</select>
					<ChevronDown size={16} className={`pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 ${filters.period ? "text-white dark:text-[#1c2118]" : "text-neutral-500"}`} aria-hidden />
				</span>
				{filters.period === "custom" ? (
					<span className="flex flex-wrap items-center gap-2">
						<label className="flex items-center gap-1.5 text-sm font-semibold">
							From
							<input type="date" value={filters.from} max={filters.to || undefined} onChange={(event) => onChange({ from: event.target.value })} className={`${chip} ${chipOff} font-normal`} />
						</label>
						<label className="flex items-center gap-1.5 text-sm font-semibold">
							To
							<input type="date" value={filters.to} min={filters.from || undefined} onChange={(event) => onChange({ to: event.target.value })} className={`${chip} ${chipOff} font-normal`} />
						</label>
					</span>
				) : null}
				<form onSubmit={submitPassage} className={`${chip} ${filters.passage ? "border-amber-700/50 dark:border-amber-300/50" : chipOff} gap-1 pr-1.5`}>
					<label htmlFor="vault-passage" className="text-sm font-bold">Passage</label>
					<input
						id="vault-passage"
						value={passageDraft}
						onChange={(event) => setPassageDraft(event.target.value)}
						onBlur={() => passageDraft.trim() !== filters.passage && onChange({ passage: passageDraft.trim() })}
						placeholder="John 3"
						enterKeyHint="search"
						autoComplete="off"
						maxLength={40}
						className="h-11 w-[6.5rem] bg-transparent text-base font-normal outline-none placeholder:text-neutral-500"
					/>
					{filters.passage ? (
						<button type="button" onClick={() => { setPassageDraft(""); onChange({ passage: "" }); }} aria-label="Clear passage" className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/5">
							<X size={16} aria-hidden />
						</button>
					) : null}
				</form>
			</div>

			{facets?.topics.length ? (
				<div role="group" aria-label="Topics" className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 lg:-mx-0 lg:flex-wrap lg:overflow-visible lg:px-0">
					{facets.topics.map(({ label }) => {
						const on = filters.topic === label;
						return (
							<button key={label} type="button" aria-pressed={on} onClick={() => onChange({ topic: on ? "" : label })} className={`${chip} ${on ? "border-amber-700/50 bg-amber-500/15 text-amber-950 dark:border-amber-300/50 dark:text-amber-100" : chipOff}`}>
								#{label}
							</button>
						);
					})}
				</div>
			) : null}

			<div aria-live="polite" className={`min-h-6 text-sm ${muted}`}>
				{results.status === "loading" ? (
					<span className="inline-flex items-center gap-2"><LoaderCircle size={16} className="animate-spin" aria-hidden /> Reading your vault…</span>
				) : results.status === "ready" ? (
					<>
						{data?.mode === "library" ? "Newest first" : data?.mode === "search" ? `${entries.length} ${entries.length === 1 ? "match" : "matches"} for “${filters.q}”` : `${entries.length}${results.more ? "+" : ""} ${entries.length === 1 ? "entry" : "entries"}`}
						{data?.passage ? ` on ${data.passage.label}` : ""}
						{filters.topic ? ` about ${filters.topic}` : ""}
						{data?.queryWasPassage ? " (read as a passage)" : ""}
						{index && !index.allowed ? " · Meaning search needs AI turned on in Settings; word search still works." : null}
						{index && index.allowed && index.pending > 0 && !index.failed ? ` · Getting meaning search ready: ${index.pending} left` : null}
					</>
				) : null}
			</div>

			{results.status === "error" ? (
				<p role="alert" className={`${card} px-5 py-4 text-[15px]`}>{results.message}</p>
			) : results.status === "ready" && entries.length === 0 ? (
				<div className={`${card} px-5 py-6`}>
					<p className="font-[family-name:var(--font-cormorant)] text-[24px] font-semibold">{narrowed ? "Nothing here yet" : "Your vault is empty for now"}</p>
					<p className={`mt-1.5 text-[15px] leading-6 ${muted}`}>
						{narrowed
							? "Nothing you have studied matches that. Try fewer filters, another word, or a whole chapter."
							: "Notes, highlights, chats, reading and the verses you learn all gather here as you study."}
					</p>
					{narrowed ? (
						<button type="button" onClick={() => onChange({ q: "", kinds: [], period: "", from: "", to: "", passage: "", topic: "" })} className="mt-3 min-h-11 text-sm font-bold text-amber-800 hover:underline dark:text-[#e5b664]">
							Clear every filter
						</button>
					) : null}
				</div>
			) : (
				<div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
					{results.status === "loading"
						? [0, 1, 2, 3].map((i) => <div key={i} className={`${card} h-40 animate-pulse`} aria-hidden />)
						: entries.map((entry) => (
								<VaultEntryCard
									key={entry.id}
									entry={entry}
									onPassage={(label) => onChange({ passage: label })}
									onTopic={(topic) => onChange({ topic })}
									onOverTime={onOverTime}
								/>
							))}
				</div>
			)}

			{results.status === "ready" && results.more ? (
				<button type="button" onClick={loadMore} disabled={loadingMore} className={`${chip} ${chipOff} mx-auto justify-center px-6`}>
					{loadingMore ? <LoaderCircle size={16} className="animate-spin" aria-hidden /> : null}
					{loadingMore ? "Loading" : "Load more"}
				</button>
			) : null}
		</div>
	);
}

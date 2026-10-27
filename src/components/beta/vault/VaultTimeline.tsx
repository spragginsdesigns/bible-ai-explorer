"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { History, LoaderCircle } from "lucide-react";
import { VAULT_KIND_LABEL, type VaultKind } from "@/lib/beta/vault/vault-rules";
import type { Timeline, TimelineEntry } from "@/lib/beta/vault/timeline";
import { KindTile, card, eyebrow, monthHeading, muted, shortDate, tapChip, vaultFetch } from "./vaultUi";

/** What the person wrote or asked themselves: the readings worth setting side by side. */
const OWN_WORDS: readonly VaultKind[] = ["note", "chat", "memory", "study"];

type State = { status: "idle" } | { status: "loading" } | { status: "error"; message: string } | { status: "ready"; timeline: Timeline };

/**
 * Understanding over time: one passage or topic, everything studied on it,
 * oldest first, with any two set side by side (the earliest and the latest
 * of the person's own words to begin with). It quotes and dates; it never
 * scores or says which reading is better.
 */
export default function VaultTimeline({ subject, onSubject, suggestions }: { subject: string; onSubject: (subject: string) => void; suggestions: string[] }) {
	const [draft, setDraft] = useState(subject);
	const [state, setState] = useState<State>({ status: subject ? "loading" : "idle" });
	const [picked, setPicked] = useState<string[] | null>(null);

	useEffect(() => setDraft(subject), [subject]);
	useEffect(() => {
		if (!subject) {
			setState({ status: "idle" });
			return;
		}
		const abort = new AbortController();
		setState({ status: "loading" });
		setPicked(null);
		vaultFetch<Timeline>(`/api/beta/vault/timeline?subject=${encodeURIComponent(subject)}`, { signal: abort.signal })
			.then((timeline) => setState({ status: "ready", timeline }))
			.catch((error: unknown) => {
				if (!abort.signal.aborted) setState({ status: "error", message: error instanceof Error ? error.message : "That history could not be loaded." });
			});
		return () => abort.abort();
	}, [subject]);

	const entries = useMemo(() => (state.status === "ready" ? state.timeline.entries : []), [state]);
	// Their notes first, the plainest record of how they read it then; else anything in their own words.
	const notes = entries.filter((entry) => entry.kind === "note");
	const own = notes.length >= 2 ? notes : entries.filter((entry) => OWN_WORDS.includes(entry.kind));
	const defaultPair = own.length >= 2 ? [own[0].id, own[own.length - 1].id] : [];
	const pair = (picked ?? defaultPair).map((id) => entries.find((entry) => entry.id === id)).filter((entry): entry is TimelineEntry => Boolean(entry));
	const toggle = (id: string) => {
		const current = picked ?? defaultPair;
		const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id].slice(-2);
		setPicked(next);
	};
	const months = useMemo(() => {
		const groups: { heading: string; items: TimelineEntry[] }[] = [];
		for (const entry of entries) {
			const heading = monthHeading(entry.date);
			const last = groups[groups.length - 1];
			if (last && last.heading === heading) last.items.push(entry);
			else groups.push({ heading, items: [entry] });
		}
		return groups;
	}, [entries]);

	const submit = (event: FormEvent) => {
		event.preventDefault();
		onSubject(draft.replace(/\s+/g, " ").trim());
	};

	return (
		<div className="flex flex-col gap-4">
			<form onSubmit={submit} className={`${card} p-3 sm:p-4`}>
				<label htmlFor="vault-subject" className={eyebrow}>A passage or a topic</label>
				<div className="mt-2 flex items-center gap-2">
					<input
						id="vault-subject"
						value={draft}
						onChange={(event) => setDraft(event.target.value)}
						placeholder="Romans 8, or grace"
						enterKeyHint="go"
						autoComplete="off"
						maxLength={60}
						className="min-h-11 min-w-0 flex-1 rounded-xl bg-white/80 px-3 text-base outline-none placeholder:text-neutral-500 focus:ring-1 focus:ring-amber-700/40 dark:bg-white/[.04] dark:placeholder:text-neutral-400"
					/>
					<button type="submit" disabled={!draft.trim()} className="min-h-11 shrink-0 rounded-xl bg-[#24281f] px-4 text-sm font-bold text-white disabled:opacity-35 dark:bg-[#e5b664] dark:text-[#1c2118]">
						Show
					</button>
				</div>
				{suggestions.length ? (
					<div className="mt-3 flex flex-wrap gap-2" aria-label="Suggestions">
						{suggestions.map((s) => (
							<button key={s} type="button" onClick={() => onSubject(s)} className={tapChip}>
								{s}
							</button>
						))}
					</div>
				) : null}
			</form>

			<div aria-live="polite">
				{state.status === "idle" ? (
					<p className={`px-1 text-[15px] leading-6 ${muted}`}>
						Choose a passage or a topic to see everything you have studied on it, earliest first, and set an earlier reading beside a later one.
					</p>
				) : state.status === "loading" ? (
					<p className={`inline-flex items-center gap-2 px-1 text-sm font-semibold ${muted}`}>
						<LoaderCircle size={16} className="animate-spin" aria-hidden /> Gathering {subject} from your vault…
					</p>
				) : state.status === "error" ? (
					<p role="alert" className={`${card} px-5 py-4 text-[15px]`}>{state.message}</p>
				) : entries.length === 0 ? (
					<div className={`${card} px-5 py-6`}>
						<p className="font-[family-name:var(--font-cormorant)] text-[24px] font-semibold">Nothing on {state.timeline.subject.label} yet</p>
						<p className={`mt-1.5 text-[15px] leading-6 ${muted}`}>When you read, highlight, write or ask about it, it will appear here by date.</p>
					</div>
				) : (
					<p className={`px-1 text-sm ${muted}`}>
						<History size={15} className="mr-1 inline align-[-2px]" aria-hidden />
						{state.timeline.subject.label}: {entries.length} {entries.length === 1 ? "entry" : "entries"} from {shortDate(entries[0].date)} to {shortDate(entries[entries.length - 1].date)}
					</p>
				)}
			</div>

			{pair.length === 2 ? (
				<section aria-labelledby="vault-compare" className={`${card} px-4 py-4 sm:px-5`}>
					<h2 id="vault-compare" className={eyebrow}>Then and later, side by side</h2>
					<div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
						{[...pair].sort((a, b) => a.date.localeCompare(b.date)).map((entry, i) => (
							<div key={entry.id} className="rounded-2xl border border-black/[.07] bg-white/50 p-4 dark:border-white/[.07] dark:bg-white/[.02]">
								<p className={`text-xs font-bold uppercase tracking-[.14em] ${muted}`}>{i === 0 ? "Earlier" : "Later"} · {shortDate(entry.date)}</p>
								<p className="mt-1.5 font-bold leading-snug">
									<Link href={entry.href} className="hover:underline">{entry.title}</Link>
								</p>
								<p className={`mt-0.5 text-xs ${muted}`}>{VAULT_KIND_LABEL[entry.kind]}</p>
								<p className="mt-2 whitespace-pre-line text-[15px] leading-6">{entry.kind === "chat" ? `You asked: ${entry.excerpt}` : entry.excerpt}</p>
							</div>
						))}
					</div>
					<p className={`mt-3 text-xs leading-5 ${muted}`}>Pick any two entries below to set them side by side.</p>
				</section>
			) : null}

			{months.map((group) => (
				<section key={group.heading} aria-label={group.heading}>
					<h2 className={`${eyebrow} sticky top-0 z-10 -mx-1 bg-[#f6f2e9]/95 px-1 py-2 dark:bg-[#0d100d]/95`}>{group.heading}</h2>
					<ol className="relative ml-[17px] border-l border-black/10 pl-6 dark:border-white/10">
						{group.items.map((entry) => {
							const selected = pair.some((p) => p.id === entry.id);
							return (
								<li key={entry.id} className="relative pb-4">
									<span className="absolute -left-[44px] top-0 rounded-full bg-[#f6f2e9] p-0.5 dark:bg-[#0d100d]"><KindTile kind={entry.kind} /></span>
									<div className={`${card} px-4 py-3.5 ${selected ? "border-amber-700/50 dark:border-amber-300/50" : ""}`}>
										<div className="flex items-start justify-between gap-3">
											<p className={`text-sm font-semibold ${muted}`}>{VAULT_KIND_LABEL[entry.kind]} · {shortDate(entry.date)}{entry.detail ? ` · ${entry.detail}` : ""}</p>
											<label className="-my-2 -mr-2 flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 px-2 text-xs font-bold">
												<input type="checkbox" checked={selected} onChange={() => toggle(entry.id)} className="h-4 w-4 accent-[#b98a3a]" />
												Compare
											</label>
										</div>
										<p className="mt-1 font-[family-name:var(--font-cormorant)] text-[21px] font-semibold leading-tight">
											<Link href={entry.href} className="hover:underline">{entry.title}</Link>
										</p>
										{entry.excerpt ? (
											entry.kind === "highlight" || entry.kind === "verse" ? (
												<blockquote className="mt-1.5 border-l-2 border-[#e5b664] pl-3 font-[family-name:var(--font-cormorant)] text-[18px] italic leading-7">{entry.excerpt}</blockquote>
											) : (
												<p className="mt-1.5 whitespace-pre-line text-[15px] leading-6 text-neutral-700 dark:text-[#d9d1c3]">{entry.kind === "chat" ? `You asked: ${entry.excerpt}` : entry.excerpt}</p>
											)
										) : null}
										{entry.answer ? (
											<div className="mt-2 rounded-2xl bg-black/[.035] px-3.5 py-2.5 dark:bg-white/[.04]">
												<p className={`text-xs font-bold uppercase tracking-[.14em] ${muted}`}>SureWord answered</p>
												<p className="mt-1 text-[15px] leading-6 text-neutral-700 dark:text-[#d9d1c3]">{entry.answer}</p>
											</div>
										) : null}
										{entry.matched?.includes("meaning") && !entry.matched.includes("topic") && !entry.matched.includes("passage") ? (
											<p className={`mt-1.5 text-xs font-semibold ${muted}`}>Found by meaning</p>
										) : null}
									</div>
								</li>
							);
						})}
					</ol>
				</section>
			))}
		</div>
	);
}

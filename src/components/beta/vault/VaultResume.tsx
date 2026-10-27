"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, BookOpen, FolderOpen, Layers, MessagesSquare, NotebookPen, type LucideIcon } from "lucide-react";
import type { ResumeFeature, ResumeTarget } from "@/lib/beta/vault/vault-rules";
import { card, muted, shortDate, vaultFetch } from "./vaultUi";

const FEATURE_ICON: Record<ResumeFeature, LucideIcon> = {
	reader: BookOpen,
	chat: MessagesSquare,
	note: NotebookPen,
	learn: Layers,
	module: FolderOpen,
};

type State = { status: "loading" } | { status: "ready"; primary: ResumeTarget | null; others: ResumeTarget[] } | { status: "error" };

/**
 * Study memory: the newest study across the reader, chats, notes, Learn a
 * verse and every beta module, with the latest of each of the others beside
 * it, so continuing is one tap whichever part of SureWord it was in.
 */
export default function VaultResume() {
	const [state, setState] = useState<State>({ status: "loading" });
	useEffect(() => {
		const abort = new AbortController();
		vaultFetch<{ primary: ResumeTarget | null; others: ResumeTarget[] }>("/api/beta/vault/resume", { signal: abort.signal })
			.then((body) => setState({ status: "ready", ...body }))
			.catch(() => {
				if (!abort.signal.aborted) setState({ status: "error" });
			});
		return () => abort.abort();
	}, []);

	if (state.status === "loading") {
		return (
			<section aria-label="Pick up where you left off" aria-busy="true" className={`${card} px-5 py-5`}>
				<span className="block h-3 w-32 animate-pulse rounded bg-black/[.06] dark:bg-white/[.06]" />
				<span className="mt-3 block h-7 w-56 animate-pulse rounded bg-black/[.06] dark:bg-white/[.06]" />
				<span className="mt-2 block h-4 w-64 max-w-full animate-pulse rounded bg-black/[.06] dark:bg-white/[.06]" />
			</section>
		);
	}
	if (state.status === "error" || !state.primary) {
		return (
			<section aria-label="Pick up where you left off" className={`${card} px-5 py-5`}>
				<p className="text-xs font-bold uppercase tracking-[.18em] text-neutral-600 dark:text-[#b3ad9e]">Your study starts here</p>
				<p className={`mt-2 text-[15px] leading-6 ${muted}`}>
					{state.status === "error"
						? "Your last study could not be found just now."
						: "As you read, highlight, write notes and ask questions, your vault fills up and remembers where you left off."}
				</p>
				<Link href="/bible" className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-amber-800 hover:underline dark:text-[#e5b664]">
					Open the Bible <ArrowRight size={16} aria-hidden />
				</Link>
			</section>
		);
	}
	const { primary, others } = state;
	return (
		<section aria-label="Pick up where you left off" className={`${card} px-4 py-4 sm:px-5 sm:py-5`}>
			<Link href={primary.href} className="group flex items-start gap-4 rounded-2xl focus-visible:outline-amber-600">
				<span className="min-w-0 flex-1">
					<span className="block text-xs font-bold uppercase tracking-[.18em] text-neutral-600 dark:text-[#b3ad9e]">{primary.action}</span>
					<span className="mt-1.5 block font-[family-name:var(--font-cormorant)] text-[27px] font-semibold leading-tight">{primary.title}</span>
					{primary.detail ? <span className={`mt-1 line-clamp-2 block text-[15px] leading-6 ${muted}`}>{primary.detail}</span> : null}
					<span className={`mt-1 block text-xs font-semibold ${muted}`}>{shortDate(primary.at)}</span>
				</span>
				<span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#24281f] text-white transition-transform group-hover:translate-x-0.5 dark:bg-[#e5b664] dark:text-[#1c2118]" aria-hidden>
					<ArrowRight size={21} />
				</span>
			</Link>
			{others.length ? (
				<ul className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:-mx-5 sm:px-5 lg:flex-wrap lg:overflow-visible" aria-label="Also where you left off">
					{others.map((target) => {
						const Icon = FEATURE_ICON[target.feature];
						return (
							<li key={`${target.feature}:${target.module ?? ""}`} className="shrink-0">
								<Link
									href={target.href}
									className="flex min-h-11 max-w-[19rem] items-center gap-2 rounded-2xl border border-black/10 bg-white/60 px-3.5 py-2 text-sm hover:border-amber-700/30 dark:border-white/10 dark:bg-white/[.03] dark:hover:border-amber-300/30"
								>
									<Icon size={17} className="shrink-0 text-emerald-800 dark:text-emerald-200" aria-hidden />
									<span className="min-w-0 truncate">
										<span className="font-bold">{target.action}</span>
										<span className={muted}>: {target.title}</span>
									</span>
								</Link>
							</li>
						);
					})}
				</ul>
			) : null}
		</section>
	);
}

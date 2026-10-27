"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { ArrowLeft, Download } from "lucide-react";
import { isVaultKind, type VaultKind } from "@/lib/beta/vault/vault-rules";
import { DESTINATION_TILE, IconTile, moduleIcon } from "../visuals";
import VaultAsk from "./VaultAsk";
import VaultLibrary, { type Facets, type LibraryFilters, type Period } from "./VaultLibrary";
import VaultResume from "./VaultResume";
import VaultTimeline from "./VaultTimeline";
import { muted, vaultFetch } from "./vaultUi";

type View = "library" | "ask" | "time";
const VIEWS: { id: View; label: string }[] = [
	{ id: "library", label: "Library" },
	{ id: "ask", label: "Ask" },
	{ id: "time", label: "Over time" },
];
const PERIOD_IDS: readonly Period[] = ["", "30d", "6m", "1y", "custom"];

/** Every view and filter lives in the URL (replaced, not pushed, so filters do not pile up in history), so a search or a history can be linked or reloaded. */
function readState(params: URLSearchParams): { view: View; filters: LibraryFilters; subject: string } {
	const view = params.get("view");
	const period = params.get("period") ?? "";
	return {
		view: view === "ask" || view === "time" ? view : "library",
		filters: {
			q: params.get("q") ?? "",
			kinds: (params.get("kind") ?? "").split(",").filter(isVaultKind) as VaultKind[],
			period: (PERIOD_IDS as readonly string[]).includes(period) ? (period as Period) : "",
			from: params.get("from") ?? "",
			to: params.get("to") ?? "",
			passage: params.get("passage") ?? "",
			topic: params.get("topic") ?? "",
		},
		subject: params.get("subject") ?? "",
	};
}

export default function VaultScreen() {
	const { userId } = useAuth();
	// A different account must never see the previous one's vault, even briefly.
	return <VaultContent key={userId ?? "guest"} />;
}

function VaultContent() {
	const router = useRouter();
	const pathname = usePathname();
	const params = useSearchParams();
	const { view, filters, subject } = readState(new URLSearchParams(params.toString()));
	const [facets, setFacets] = useState<Facets | null>(null);

	useEffect(() => {
		const abort = new AbortController();
		vaultFetch<Facets>("/api/beta/vault/facets", { signal: abort.signal }).then(setFacets).catch(() => {});
		return () => abort.abort();
	}, []);

	const navigate = useCallback(
		(patch: Record<string, string | null>) => {
			const next = new URLSearchParams(params.toString());
			for (const [key, value] of Object.entries(patch)) {
				if (value) next.set(key, value);
				else next.delete(key);
			}
			const query = next.toString();
			router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
		},
		[params, pathname, router],
	);

	const onFilters = (patch: Partial<LibraryFilters>) =>
		navigate(
			Object.fromEntries(
				Object.entries(patch).map(([key, value]) => [key === "kinds" ? "kind" : key, Array.isArray(value) ? value.join(",") : (value as string)]),
			),
		);
	const overTime = (value: string) => {
		navigate({ view: "time", subject: value });
		window.scrollTo({ top: 0, behavior: "smooth" });
	};
	const suggestions = [...new Set([...(facets?.topics.slice(0, 4).map((topic) => topic.label) ?? []), "Romans 8", "John 3"])].slice(0, 6);

	return (
		<main className="mx-auto w-full max-w-5xl px-5 pb-[calc(var(--sureword-mobile-tab-clearance)+24px)] pt-4 lg:px-8 lg:pb-16 lg:pt-10">
			<Link href="/beta/library" className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-bold text-neutral-600 hover:bg-black/5 dark:text-[#bbb3a7] dark:hover:bg-white/5">
				<ArrowLeft size={18} aria-hidden /> Library
			</Link>

			<header className="mt-3 flex items-start gap-4">
				<IconTile Icon={moduleIcon("vault", "library")} tone={DESTINATION_TILE.library} size="lg" />
				<div className="min-w-0 flex-1">
					<h1 className="font-[family-name:var(--font-cormorant)] text-[clamp(2.2rem,8vw,2.9rem)] font-semibold leading-[1.02]">Knowledge Vault</h1>
					<p className="mt-1.5 text-base text-neutral-700 dark:text-[#d9d1c3]">Everything you have studied, in one place</p>
				</div>
				<details className="relative shrink-0">
					<summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-full border border-black/10 bg-white/50 px-4 text-sm font-bold hover:border-amber-700/30 dark:border-white/10 dark:bg-white/[.03] [&::-webkit-details-marker]:hidden">
						<Download size={16} aria-hidden /> Export
					</summary>
					<div className="absolute right-0 z-20 mt-2 w-60 rounded-2xl border border-black/10 bg-[#fbf8f1] p-2 shadow-lg dark:border-white/10 dark:bg-[#161a15]">
						<p className={`px-3 pb-1 pt-1 text-xs leading-5 ${muted}`}>Your whole vault, as one file.</p>
						<a href="/api/beta/vault/export?format=md" download className="flex min-h-11 items-center rounded-xl px-3 text-sm font-bold hover:bg-black/5 dark:hover:bg-white/5">
							Markdown (.md)
						</a>
						<a href="/api/beta/vault/export?format=json" download className="flex min-h-11 items-center rounded-xl px-3 text-sm font-bold hover:bg-black/5 dark:hover:bg-white/5">
							JSON (.json)
						</a>
					</div>
				</details>
			</header>

			<div className="mt-6">
				<VaultResume />
			</div>

			<div role="tablist" aria-label="Knowledge Vault" className="mt-6 grid grid-cols-3 gap-1 rounded-2xl bg-black/[.05] p-1 dark:bg-white/[.05]">
				{VIEWS.map((tab) => {
					const active = view === tab.id;
					return (
						<button
							key={tab.id}
							type="button"
							role="tab"
							id={`vault-tab-${tab.id}`}
							aria-selected={active}
							aria-controls="vault-panel"
							onClick={() => navigate({ view: tab.id === "library" ? null : tab.id })}
							className={`min-h-11 rounded-xl text-[15px] font-bold transition-colors ${active ? "bg-white text-neutral-900 shadow-sm dark:bg-[#24281f] dark:text-[#f1eadc]" : "text-neutral-600 hover:text-neutral-900 dark:text-[#bbb3a7] dark:hover:text-[#f1eadc]"}`}
						>
							{tab.label}
						</button>
					);
				})}
			</div>

			<div id="vault-panel" role="tabpanel" aria-labelledby={`vault-tab-${view}`} className="mt-5">
				{view === "library" ? (
					<VaultLibrary filters={filters} facets={facets} onChange={onFilters} onOverTime={overTime} />
				) : view === "ask" ? (
					<VaultAsk onOverTime={overTime} />
				) : (
					<VaultTimeline subject={subject} onSubject={(value) => navigate({ subject: value })} suggestions={suggestions} />
				)}
			</div>
		</main>
	);
}

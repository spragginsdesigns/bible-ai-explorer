"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { ArrowLeft, ArrowRight, Loader2, Sparkles } from "lucide-react";
import { THEME_MAX, type MapOrigin } from "@/lib/beta/maps/map-rules";
import { DESTINATION_TILE, IconTile, moduleIcon } from "@/components/beta/visuals";
import { writeDraft } from "./draftStorage";

const card = "rounded-[22px] border border-black/[.09] bg-white/35 dark:border-white/[.09] dark:bg-white/[.025]";
const eyebrow = "text-xs font-bold uppercase tracking-[.2em] text-neutral-600 dark:text-[#b3ad9e]";
const SUGGESTIONS = ["the Holy Spirit in Acts", "faith and works in James and Romans", "the names of God", "Christ in the tabernacle"];

export interface LibraryCard {
	slug: string;
	title: string;
	summary: string;
	nodes: number;
	questions: number;
}

export interface SavedCard {
	id: string;
	title: string;
	summary: string;
	nodes: number;
	questions: number;
	origin: MapOrigin;
	updatedAt: string;
}

function counts(nodes: number, questions: number): string {
	return `${nodes} ideas${questions ? ` · ${questions} read differently` : ""}`;
}

function originLabel(origin: MapOrigin): string {
	if (origin.kind === "generated") return `Built for “${origin.theme}”`;
	if (origin.kind === "library") return "Copy of a ready-made map";
	return "Your map";
}

type BuildState = { status: "idle" } | { status: "working"; startedAt: number } | { status: "error"; message: string };

export default function MapsHome({ library, saved }: { library: LibraryCard[]; saved: SavedCard[] }) {
	const router = useRouter();
	const { userId } = useAuth();
	const [theme, setTheme] = useState("");
	const [build, setBuild] = useState<BuildState>({ status: "idle" });
	const [elapsed, setElapsed] = useState(0);
	const abort = useRef<AbortController | null>(null);

	useEffect(() => {
		if (build.status !== "working") return;
		const timer = window.setInterval(() => setElapsed(Math.round((Date.now() - build.startedAt) / 1000)), 1000);
		return () => window.clearInterval(timer);
	}, [build]);
	useEffect(() => () => abort.current?.abort(), []);

	const start = async (event?: FormEvent, text = theme) => {
		event?.preventDefault();
		const value = text.replace(/\s+/g, " ").trim();
		if (!value || build.status === "working" || !userId) return;
		setTheme(value);
		setElapsed(0);
		setBuild({ status: "working", startedAt: Date.now() });
		const controller = new AbortController();
		abort.current = controller;
		try {
			const response = await fetch("/api/beta/maps/generate", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ theme: value }),
				signal: controller.signal,
			});
			const body = await response.json().catch(() => null);
			if (!response.ok || !body?.map) throw new Error(body?.error ?? "The map could not be built right now. Please try again.");
			writeDraft(userId, { map: body.map, retrieval: body.retrieval ?? null });
			router.push("/beta/study/maps/new");
		} catch (caught) {
			if (controller.signal.aborted) {
				setBuild({ status: "idle" });
				return;
			}
			setBuild({ status: "error", message: caught instanceof Error ? caught.message : "The map could not be built right now." });
		}
	};

	const Icon = moduleIcon("maps", "study");
	const working = build.status === "working";

	return (
		<main className="mx-auto w-full max-w-6xl px-5 pb-[calc(var(--sureword-mobile-tab-clearance)+24px)] pt-4 lg:px-8 lg:pb-16 lg:pt-10">
			<Link href="/beta/study" className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-bold text-neutral-600 hover:bg-black/5 dark:text-[#bbb3a7] dark:hover:bg-white/5">
				<ArrowLeft size={18} aria-hidden /> Study
			</Link>

			<header className="mt-3 flex items-start gap-4">
				<IconTile Icon={Icon} tone={DESTINATION_TILE.study} size="lg" />
				<div className="min-w-0">
					<h1 className="font-[family-name:var(--font-cormorant)] text-[clamp(2.2rem,8vw,2.9rem)] font-semibold leading-[1.02]">Concept Maps</h1>
					<p className="mt-1.5 text-base text-neutral-700 dark:text-[#d9d1c3]">See how the doctrines fit together. Every idea opens the verses behind it.</p>
				</div>
			</header>

			<section aria-labelledby="maps-build" className={`${card} mt-6 p-5`}>
				<h2 id="maps-build" className={eyebrow}>Map any theme</h2>
				<p className="mt-2 text-[15px] leading-6 text-neutral-700 dark:text-[#d9d1c3]">SureWord searches the Scriptures for the theme, then draws the map only from the verses it finds. You can change anything before you save it.</p>
				<form onSubmit={start} className="mt-3">
					<label htmlFor="maps-theme" className="sr-only">Theme to map</label>
					<div className="flex items-center gap-2 rounded-2xl border border-black/10 bg-white/80 py-1.5 pl-4 pr-1.5 focus-within:border-amber-700/40 dark:border-white/10 dark:bg-white/[.04] dark:focus-within:border-amber-300/40">
						<input
							id="maps-theme"
							value={theme}
							onChange={(event) => setTheme(event.target.value)}
							maxLength={THEME_MAX}
							disabled={working}
							placeholder="e.g. the Holy Spirit in Acts"
							enterKeyHint="go"
							autoComplete="off"
							className="min-h-11 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-neutral-500 disabled:opacity-60 dark:placeholder:text-neutral-400"
						/>
						<button type="submit" disabled={!theme.trim() || working || !userId} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full bg-[#24281f] px-4 text-sm font-bold text-white transition-opacity disabled:opacity-35 dark:bg-[#e5b664] dark:text-[#1c2118]">
							{working ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <Sparkles size={17} aria-hidden />} Build map
						</button>
					</div>
				</form>
				{!working && (
					<ul className="mt-3 flex flex-wrap gap-2" aria-label="Try one">
						{SUGGESTIONS.map((item) => (
							<li key={item}>
								<button type="button" onClick={() => start(undefined, item)} disabled={!userId} className="min-h-11 rounded-full border border-black/10 px-3.5 text-sm hover:bg-black/[.04] dark:border-white/10 dark:hover:bg-white/[.04]">{item}</button>
							</li>
						))}
					</ul>
				)}
				{working && (
					<div role="status" className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-neutral-700 dark:text-[#d9d1c3]">
						<span>Searching the Scriptures for &ldquo;{theme}&rdquo; and drawing the map from the verses found. This usually takes about a minute{elapsed ? ` (${elapsed}s)` : ""}.</span>
						<button type="button" onClick={() => abort.current?.abort()} className="min-h-11 font-bold text-amber-800 hover:underline dark:text-[#e5b664]">Cancel</button>
					</div>
				)}
				{build.status === "error" && (
					<p role="alert" className="mt-3 rounded-2xl border border-red-700/30 px-4 py-2.5 text-sm text-red-800 dark:text-red-200">{build.message}</p>
				)}
			</section>

			<section aria-labelledby="maps-library" className="mt-9">
				<h2 id="maps-library" className="font-[family-name:var(--font-cormorant)] text-[30px] font-semibold leading-tight">Ready-made maps</h2>
				<p className="mt-1 text-sm text-neutral-600 dark:text-[#bbb3a7]">Written once and reviewed for doctrinal care. Where Christians read a passage differently, the readings sit side by side.</p>
				<ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{library.map((item) => (
						<li key={item.slug}>
							<Link href={`/beta/study/maps/${item.slug}`} className={`${card} group flex h-full min-h-[148px] flex-col p-5 transition-colors hover:border-amber-700/30 hover:bg-white/70 focus-visible:outline-amber-600 dark:hover:border-amber-300/30 dark:hover:bg-white/[.05]`}>
								<span className="font-[family-name:var(--font-cormorant)] text-[25px] font-semibold leading-tight">{item.title}</span>
								<span className="mt-1.5 line-clamp-2 text-[15px] leading-6 text-neutral-700 dark:text-[#d9d1c3]">{item.summary}</span>
								<span className="mt-auto flex items-center justify-between pt-3 text-xs font-bold text-neutral-600 dark:text-[#b3ad9e]">
									{counts(item.nodes, item.questions)}
									<ArrowRight size={18} aria-hidden className="transition-transform group-hover:translate-x-0.5" />
								</span>
							</Link>
						</li>
					))}
				</ul>
			</section>

			<section aria-labelledby="maps-saved" className="mt-9">
				<h2 id="maps-saved" className="font-[family-name:var(--font-cormorant)] text-[30px] font-semibold leading-tight">Your maps</h2>
				{saved.length === 0 ? (
					<p className={`${card} mt-4 px-5 py-5 text-[15px] leading-6 text-neutral-700 dark:text-[#d9d1c3]`}>
						Maps you build or copy and save land here, and in your Library with their passages and topics.
					</p>
				) : (
					<ul className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
						{saved.map((item) => (
							<li key={item.id}>
								<Link href={`/beta/study/maps/${item.id}`} className={`${card} group flex min-h-24 items-center gap-4 px-5 py-4 transition-colors hover:border-amber-700/30 hover:bg-white/70 dark:hover:border-amber-300/30 dark:hover:bg-white/[.05]`}>
									<span className="min-w-0 flex-1">
										<span className="block text-xs font-bold text-neutral-600 dark:text-[#b3ad9e]">{originLabel(item.origin)}</span>
										<span className="mt-0.5 block truncate font-[family-name:var(--font-cormorant)] text-[23px] font-semibold leading-tight">{item.title}</span>
										<span className="block text-sm text-neutral-600 dark:text-[#bbb3a7]">{counts(item.nodes, item.questions)} · updated {new Date(item.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}</span>
									</span>
									<ArrowRight size={20} aria-hidden className="shrink-0 transition-transform group-hover:translate-x-0.5" />
								</Link>
							</li>
						))}
					</ul>
				)}
			</section>
		</main>
	);
}

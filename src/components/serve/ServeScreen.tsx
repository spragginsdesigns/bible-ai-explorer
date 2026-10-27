"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { ExternalLink, Loader2 } from "lucide-react";
import { SERVE_MODES, type ServeMode } from "@/lib/serve-rules";
import { Switch } from "@/components/settings/SettingsPrimitives";
import SendWordDialog from "@/components/share/SendWordDialog";
import JournalSection, { type JournalSectionHandle } from "./JournalSection";
import NearbySection, { type NearbySectionHandle } from "./NearbySection";
import { fetchServe, patchServe, type ServeSettings, type ServeView } from "./serveClient";
import { serveActionLabel, serveActionTarget, verseRangeLabel } from "./serveActions";

type WayView = ServeView["ways"][number];

const MODE_LABELS: Record<ServeMode, string> = {
	off: "Off",
	nearby: "Nearby",
	online: "Online",
	both: "Both",
};

const actionClass =
	"inline-flex min-h-11 items-center gap-1.5 self-start rounded-full border border-amber-600/40 bg-amber-500/10 px-4 text-sm font-bold text-amber-900 transition-colors hover:bg-amber-500/20 focus-visible:outline-amber-600 dark:border-[#e5b664]/40 dark:bg-[#e5b664]/10 dark:text-[#efc574] dark:hover:bg-[#e5b664]/20";

export default function ServeScreen() {
	const { userId } = useAuth();
	// A different account must never see the previous reader's journal.
	return <ServeContent key={userId ?? "guest"} />;
}

function ServeContent() {
	const router = useRouter();
	const [view, setView] = useState<ServeView | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [attempt, setAttempt] = useState(0);
	const [sendReference, setSendReference] = useState<string | null>(null);
	const nearbyRef = useRef<NearbySectionHandle>(null);
	const journalRef = useRef<JournalSectionHandle>(null);
	// Only the newest PATCH may write the view, so two quick taps never land
	// out of order.
	const patchSeq = useRef(0);

	useEffect(() => {
		const controller = new AbortController();
		setLoadError(null);
		fetchServe(controller.signal)
			.then((next) => {
				if (!controller.signal.aborted) setView(next);
			})
			.catch((err: unknown) => {
				if (controller.signal.aborted) return;
				setLoadError(err instanceof Error ? err.message : "Ways to Serve couldn't load.");
			});
		return () => controller.abort();
	}, [attempt]);

	const update = useCallback(
		(patch: Partial<ServeSettings>) => {
			if (!view) return;
			const previous = view;
			const seq = ++patchSeq.current;
			setSaveError(null);
			setView({ ...previous, settings: { ...previous.settings, ...patch } });
			patchServe(patch)
				.then((next) => {
					if (seq === patchSeq.current) setView(next);
				})
				.catch(() => {
					if (seq !== patchSeq.current) return;
					setView(previous);
					// An earlier failed write may still sit inside `previous`, so take
					// what the server actually saved.
					fetchServe()
						.then((next) => {
							if (seq === patchSeq.current) setView(next);
						})
						.catch(() => undefined);
					setSaveError("That change didn't save. Try again.");
				});
		},
		[view]
	);

	const runAction = useCallback(
		(way: WayView) => {
			if (!view) return;
			const target = serveActionTarget(way, {
				nearbyAvailable: view.nearby.available,
				churchWebsite: view.church?.website ?? null,
			});
			if (!target) return;
			switch (target.type) {
				case "send-word":
					setSendReference(target.reference);
					return;
				case "chat":
					router.push(target.href);
					return;
				case "focus":
					if (target.section === "nearby") nearbyRef.current?.focus();
					else journalRef.current?.focus(way.verse.reference);
					return;
				case "link":
					if (target.external) window.open(target.href, "_blank", "noopener,noreferrer");
					else router.push(target.href);
					return;
			}
		},
		[router, view]
	);

	const actionButton = (way: WayView) => {
		if (!view) return null;
		const target = serveActionTarget(way, {
			nearbyAvailable: view.nearby.available,
			churchWebsite: view.church?.website ?? null,
		});
		if (!target) return null;
		return (
			<button type="button" onClick={() => runAction(way)} className={actionClass}>
				{serveActionLabel(way.action, target)}
				{target.type === "link" && target.external ? <ExternalLink size={15} aria-hidden /> : null}
			</button>
		);
	};

	return (
		<main className="mx-auto w-full max-w-2xl px-5 pb-28 pt-4 lg:px-8 lg:pb-16 lg:pt-8">
			<div className="flex items-center gap-4 py-2">
				<Link href="/today" className="min-h-11 content-center text-control font-semibold text-amber-800 dark:text-[#e5b664]">
					‹ Today
				</Link>
			</div>
			<h1 className="mt-2 font-[family-name:var(--font-cormorant)] text-[clamp(2.1rem,6vw,2.75rem)] font-semibold leading-tight text-amber-900 dark:text-[#efc574]">
				{view?.title ?? "Ways to Serve"}
			</h1>

			{!view && !loadError ? (
				<p role="status" className="mt-8 flex items-center gap-2 text-sm text-neutral-500">
					<Loader2 size={16} className="animate-spin" aria-hidden />
					Opening Ways to Serve...
				</p>
			) : !view && loadError ? (
				<div role="alert" className="mt-6 rounded-2xl border border-black/10 p-5 dark:border-white/10">
					<p className="text-sm text-neutral-700 dark:text-neutral-300">{loadError}</p>
					<button
						type="button"
						onClick={() => setAttempt((value) => value + 1)}
						className="mt-2 min-h-11 font-bold text-amber-800 dark:text-[#e5b664]"
					>
						Try again
					</button>
				</div>
			) : view ? (
				<div className="mt-4 flex flex-col gap-6">
					<section aria-label="Saved by grace through faith">
						<p className="text-[15px] leading-7 text-neutral-700 dark:text-[#d6cfc1]">{view.intro.text}</p>
						<blockquote className="mt-4 border-l-2 border-amber-600/50 pl-4 dark:border-[#e5b664]/50">
							{view.intro.verses.map((verse) => (
								<p key={verse.reference} className="font-[family-name:var(--font-cormorant)] text-[22px] leading-[1.35]">
									{verse.text}
								</p>
							))}
							<footer className="mt-2 text-xs font-bold uppercase tracking-[.18em] text-neutral-600 dark:text-[#b3ad9e]">
								{verseRangeLabel(view.intro.verses.map((verse) => verse.reference))} · KJV
							</footer>
						</blockquote>
					</section>

					<section aria-labelledby="serve-mode-title" className="flex flex-col gap-3">
						<h2 id="serve-mode-title" className="text-xs font-bold uppercase tracking-[.15em] text-neutral-600 dark:text-[#b3ad9e]">
							Show me ways to serve
						</h2>
						<div role="radiogroup" aria-labelledby="serve-mode-title" className="grid grid-cols-4 gap-1 rounded-2xl border border-black/10 p-1 dark:border-white/10">
							{SERVE_MODES.map((mode) => {
								const selected = view.settings.mode === mode;
								return (
									<button
										key={mode}
										type="button"
										role="radio"
										aria-checked={selected}
										onClick={() => {
											if (!selected) update({ mode });
										}}
										className={`min-h-11 rounded-xl text-sm font-bold transition-colors focus-visible:outline-amber-600 ${
											selected
												? "bg-[#e5b664] text-[#1c2118]"
												: "text-neutral-700 hover:bg-black/5 dark:text-neutral-300 dark:hover:bg-white/5"
										}`}
									>
										{MODE_LABELS[mode]}
									</button>
								);
							})}
						</div>
						<div className="flex items-center gap-3 rounded-2xl border border-black/10 px-4 py-3 dark:border-white/10">
							<span className="flex-1 text-[15px] font-semibold">
								I already give to my church
							</span>
							<Switch
								checked={view.settings.givesToChurch}
								label="I already give to my church"
								onChange={(next) => update({ givesToChurch: next })}
							/>
						</div>
						{saveError ? (
							<p role="alert" className="text-sm text-red-700 dark:text-red-300">
								{saveError}
							</p>
						) : null}
					</section>

					{view.today ? (
						<section
							aria-labelledby="serve-today-title"
							className="rounded-[24px] border border-amber-900/15 bg-amber-500/[.06] p-5 dark:border-amber-200/15 dark:bg-[#e5b664]/[.05]"
						>
							<p className="text-xs font-bold uppercase tracking-[.15em] text-neutral-600 dark:text-[#b3ad9e]">Today</p>
							<h2 id="serve-today-title" className="mt-2 text-xl font-bold">
								{view.today.title}
							</h2>
							<p className="mt-1 text-[15px] leading-6 text-neutral-700 dark:text-[#d6cfc1]">{view.today.detail}</p>
							<VerseQuote verse={view.today.verse} large />
							<div className="mt-4">{actionButton(view.today)}</div>
						</section>
					) : null}

					{view.ways.length > 0 ? (
						<section aria-labelledby="serve-ways-title" className="flex flex-col gap-3">
							<h2 id="serve-ways-title" className="text-xs font-bold uppercase tracking-[.15em] text-neutral-600 dark:text-[#b3ad9e]">
								Ways to let His love reach someone
							</h2>
							<ul className="flex flex-col gap-3">
								{view.ways.map((way) => (
									<li
										key={way.id}
										className="flex flex-col gap-2 rounded-[22px] border border-black/[.09] bg-white/35 px-5 py-4 dark:border-white/[.09] dark:bg-white/[.025]"
									>
										<h3 className="text-lg font-bold leading-snug">{way.title}</h3>
										<p className="text-sm leading-6 text-neutral-700 dark:text-[#d6cfc1]">{way.detail}</p>
										<VerseQuote verse={way.verse} />
										<div className="mt-1">{actionButton(way)}</div>
									</li>
								))}
							</ul>
						</section>
					) : null}

					{view.nearby.available ? <NearbySection ref={nearbyRef} searches={view.nearby.searches} /> : null}

					<JournalSection ref={journalRef} journal={view.journal} />
				</div>
			) : null}

			{sendReference ? <SendWordDialog reference={sendReference} onClose={() => setSendReference(null)} /> : null}
		</main>
	);
}

function VerseQuote({ verse, large = false }: { verse: { reference: string; text: string }; large?: boolean }) {
	return (
		<blockquote className="mt-2 border-l-2 border-amber-600/40 pl-3 dark:border-[#e5b664]/40">
			{verse.text ? (
				<p className={`font-[family-name:var(--font-cormorant)] ${large ? "text-[22px] leading-[1.35]" : "text-lg leading-7"}`}>
					&ldquo;{verse.text}&rdquo;
				</p>
			) : null}
			<footer className="mt-1 text-xs font-bold uppercase tracking-[.15em] text-neutral-600 dark:text-[#b3ad9e]">
				{verse.reference} · KJV
			</footer>
		</blockquote>
	);
}

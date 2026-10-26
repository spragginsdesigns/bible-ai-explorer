"use client";

import React, { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { CheckCircle2, ChevronRight, Circle, X } from "lucide-react";
import { GETTING_STARTED_ITEMS, TOUR_STOPS, type GettingStartedKey } from "@/lib/onboarding-rules";
import { dismissGettingStarted, fetchGettingStarted, type GettingStartedProgress } from "@/lib/walk-client";
import { showSpotlight } from "@/lib/spotlight";

/**
 * What the spotlight says for each row, in SureWord's voice. The tour's own
 * captions where the target is a tour stop, so a reader hears the same words
 * either way.
 */
const CAPTIONS: Record<GettingStartedKey, string> = {
	readChapter: TOUR_STOPS.find((stop) => stop.target === "tab.bible")?.caption ?? "Here is the whole Bible.",
	tapVerse: TOUR_STOPS.find((stop) => stop.target === "reader.verse")?.caption ?? "Tap any verse and I will explain it to you.",
	dailyWord: "This is your Pick Up Your Cross: a verse and a short devotional made for you each day.",
	learnVerse: "Learn a verse helps you keep Scripture in your heart, one verse at a time.",
	church: "Add your home church here, and I will remember it.",
};

/**
 * Getting started, at the top of Today (docs/onboarding/PLAN.md): the tour's
 * steps for anyone who skipped it, each ticked only by real use as the
 * server reports it. Tapping an unticked row lights up where to do it; the X
 * hides the card for good. The server says `show: false` for anyone who never
 * had the welcome, so existing members never see it.
 */
export default function GettingStartedCard() {
	const { isSignedIn, userId } = useAuth();
	const [progress, setProgress] = useState<GettingStartedProgress | null>(null);
	const [dismissing, setDismissing] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!isSignedIn || !userId) {
			setProgress(null);
			return;
		}
		const controller = new AbortController();
		const load = () => {
			fetchGettingStarted(controller.signal)
				.then((next) => {
					if (!controller.signal.aborted && next) setProgress(next);
				})
				.catch(() => {
					// Quietly absent offline: the card is an invitation, not a status.
				});
		};
		load();
		// Coming back from the reader or Settings is when a row has just been done.
		const wake = () => {
			if (document.visibilityState === "visible") load();
		};
		window.addEventListener("focus", wake);
		document.addEventListener("visibilitychange", wake);
		return () => {
			controller.abort();
			window.removeEventListener("focus", wake);
			document.removeEventListener("visibilitychange", wake);
		};
	}, [isSignedIn, userId]);

	if (!progress?.show) return null;

	const dismiss = async () => {
		if (dismissing) return;
		setDismissing(true);
		setError(null);
		try {
			setProgress((await dismissGettingStarted()) ?? { ...progress, show: false });
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not hide Getting started. Try again.");
		} finally {
			setDismissing(false);
		}
	};

	const done = GETTING_STARTED_ITEMS.filter((item) => progress.items[item.key]).length;

	return (
		<section
			aria-labelledby="getting-started-title"
			className="mb-7 rounded-[24px] border border-amber-700/20 bg-white/40 p-5 dark:border-amber-300/15 dark:bg-white/[.02]"
		>
			<div className="flex items-start gap-3">
				<div className="flex-1">
					<h2 id="getting-started-title" className="text-xl font-bold">
						Getting started
					</h2>
					<p className="mt-1 text-sm text-neutral-600 dark:text-[#bbb3a7]">
						{done} of {GETTING_STARTED_ITEMS.length} done. Tap one and I will show you where.
					</p>
				</div>
				<button
					type="button"
					onClick={() => void dismiss()}
					disabled={dismissing}
					aria-label="Hide Getting started"
					className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-neutral-500 hover:bg-black/5 hover:text-neutral-800 disabled:opacity-50 dark:hover:bg-white/10 dark:hover:text-neutral-200"
				>
					<X className="h-5 w-5" />
				</button>
			</div>
			<ul className="mt-3 flex flex-col">
				{GETTING_STARTED_ITEMS.map((item) => {
					const ticked = progress.items[item.key];
					return (
						<li key={item.key}>
							{ticked ? (
								<span className="flex min-h-14 items-center gap-3 px-1 text-base text-neutral-500 dark:text-neutral-400">
									<CheckCircle2 className="h-6 w-6 shrink-0 text-amber-700 dark:text-[#e5b664]" aria-hidden />
									<span className="flex-1 line-through decoration-1">{item.label}</span>
									<span className="sr-only">Done</span>
								</span>
							) : (
								<button
									type="button"
									onClick={() => showSpotlight(item.target, CAPTIONS[item.key])}
									className="flex min-h-14 w-full items-center gap-3 rounded-xl px-1 text-left text-base font-semibold transition-colors hover:bg-amber-500/5"
								>
									<Circle className="h-6 w-6 shrink-0 text-neutral-400" aria-hidden />
									<span className="flex-1">{item.label}</span>
									<ChevronRight className="h-5 w-5 shrink-0 text-neutral-500" aria-hidden />
								</button>
							)}
						</li>
					);
				})}
			</ul>
			{error && (
				<p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
					{error}
				</p>
			)}
		</section>
	);
}

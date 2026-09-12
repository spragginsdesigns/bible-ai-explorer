"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { applyReview, parseCard, parseToday, verseWords, type LearnToday } from "./learn";

/**
 * N4 Learn a verse, web half. One verse per screen, one job: today's three
 * cards, each running the ladder (read → every fourth word → half →
 * reference alone). Tap a blank to reveal it. The only number shown is
 * "verses you know". Mirrors mobile/src/features/learn/LearnScreen.tsx.
 *
 * A failed or uncertain write requires reloading the queue before continuing.
 */
const LearnScreen: React.FC = () => {
	const [today, setToday] = useState<LearnToday | null>(null);
	const [revealed, setRevealed] = useState<ReadonlySet<number>>(new Set());
	const [unavailable, setUnavailable] = useState(false);
	const [busy, setBusy] = useState(false);
	const operation = useRef(false);

	const load = useCallback(async () => {
		if (operation.current) return;
		operation.current = true;
		setBusy(true);
		try {
			const res = await fetch("/api/learn/today", { credentials: "same-origin" });
			if (!res.ok) throw new Error(String(res.status));
			setToday(parseToday(await res.json()));
			setUnavailable(false);
			setRevealed(new Set());
		} catch {
			setUnavailable(true);
		} finally {
			operation.current = false;
			setBusy(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const card = today?.cards[0] ?? null;
	const words = card ? verseWords(card.text, card.stage) : [];

	const review = async (result: "again" | "good") => {
		if (!card || !today || operation.current) return;
		operation.current = true;
		setBusy(true);
		try {
			const res = await fetch(`/api/learn/${card.id}/review`, {
				method: "POST",
				credentials: "same-origin",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ result }),
			});
			if (!res.ok) throw new Error(String(res.status));
			const updated = parseCard(await res.json());
			setToday(applyReview(today, card, updated, result));
			setRevealed(new Set());
		} catch {
			setUnavailable(true);
		} finally {
			operation.current = false;
			setBusy(false);
		}
	};

	return (
		<div className="min-h-[100dvh] gradient-mesh">
			<div className="mx-auto flex min-h-[100dvh] w-full max-w-2xl flex-col px-5 pb-16 lg:px-8">
				<div className="flex items-center gap-4 pt-3 lg:pt-6">
					<Link
						href="/bible"
						className="text-control font-semibold text-amber-600 dark:text-amber-400"
					>
						‹ Bible
					</Link>
					<h1 className="flex-1 text-center text-control font-semibold text-neutral-900 dark:text-neutral-100">
						Learn a verse
					</h1>
					<span className="min-w-11 text-right text-metadata text-neutral-500 dark:text-neutral-400">
						{today ? `${today.knownCount} known` : ""}
					</span>
				</div>

				{unavailable ? (
					<div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
						<p className="font-[family-name:var(--font-cormorant)] text-2xl text-neutral-800 dark:text-neutral-200">
							Your verses could not be loaded or saved.
						</p>
						<p className="text-support text-neutral-500 dark:text-neutral-400">
							Check your connection, then reload your verses before continuing.
						</p>
						<button
							onClick={() => void load()}
							disabled={busy}
							className="mt-2 rounded-xl border border-amber-600/40 dark:border-amber-400/30 px-4 py-2 text-control font-medium text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 transition-colors disabled:opacity-50"
						>
							Reload verses
						</button>
					</div>
				) : !today ? (
					<p className="flex-1 content-center text-center text-support text-neutral-500 dark:text-neutral-400">
						Loading your verses...
					</p>
				) : !card ? (
					<div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
						<p className="font-[family-name:var(--font-cormorant)] text-2xl text-neutral-800 dark:text-neutral-200">
							{today.queueCount
								? "Today's practice is complete."
								: "Start with a verse you want to remember."}
						</p>
						<p className="text-support text-neutral-500 dark:text-neutral-400">
							{today.queueCount
								? "Your next verses will be ready when they are due."
								: "Choose Learn this verse from the Bible reader or a highlight."}
						</p>
					</div>
				) : (
					<div className="flex flex-1 flex-col justify-center py-8">
						<p className="mb-8 text-center text-control font-semibold text-amber-600 dark:text-amber-400">
							{card.reference} · {card.translation}
						</p>
						<p className="text-center font-[family-name:var(--font-cormorant)] text-[28px] leading-[44px] text-neutral-800 dark:text-neutral-200">
							{words.map((word, index) => (
								<React.Fragment key={index}>
									{index > 0 ? " " : ""}
									{word.hidden && !revealed.has(index) ? (
										<button
											onClick={() =>
												setRevealed((prev) => new Set(prev).add(index))
											}
											aria-label={`Reveal word ${index + 1}`}
											className="font-[inherit] text-amber-600 dark:text-amber-400 underline underline-offset-4 decoration-amber-600/50 dark:decoration-amber-400/50 hover:decoration-current"
										>
											{word.blank}
										</button>
									) : (
										word.text
									)}
								</React.Fragment>
							))}
						</p>
						<p className="mt-8 text-center text-metadata text-neutral-500 dark:text-neutral-400">
							{card.stage === 0
								? "Read the verse, then continue."
								: card.stage === 3
									? "Say the verse from its reference. Tap a blank for help."
									: "Recall the missing words. Tap a blank for help, then continue."}
						</p>
						<div className="mx-auto mt-6 flex w-full max-w-md gap-3">
							<button
								onClick={() => void review("again")}
								disabled={busy}
								className="flex-1 min-h-[48px] rounded-xl border border-black/[0.12] dark:border-white/[0.12] px-4 py-2.5 text-control font-medium text-neutral-700 dark:text-neutral-300 hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors disabled:opacity-50"
							>
								Practice again
							</button>
							<button
								onClick={() => void review("good")}
								disabled={busy}
								className="flex-1 min-h-[48px] rounded-xl bg-amber-500 dark:bg-amber-400 px-4 py-2.5 text-control font-semibold text-neutral-950 hover:bg-amber-400 dark:hover:bg-amber-300 transition-colors disabled:opacity-50"
							>
								{busy ? "Saving..." : card.stage === 3 ? "I remembered" : "Continue"}
							</button>
						</div>
					</div>
				)}
			</div>
		</div>
	);
};

export default LearnScreen;

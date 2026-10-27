"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { readQuizOfferPref } from "@/lib/preferences";
import { usePreference } from "@/lib/preferencesSync";
import { dismissChapter, isChapterDismissed } from "./quizClient";

interface QuizEntryCardProps {
	book: number;
	chapter: number;
	bookName: string;
	/** The reader shows something other than the KJV (NKJV, BSB, LC Greek). */
	notKjv: boolean;
	/** The reader's parchment surface is on, so the card inherits its ink. */
	parchment: boolean;
	/** Where the quiz route opens, carrying the reader's route translation. */
	href: string;
}

/**
 * "Quiz me on John 3" at the end of a reader chapter. The parent mounts it only
 * for a signed-in reader and keys it by chapter, so paging in place starts a
 * fresh card. Hidden when Settings turns the offer off or this chapter was
 * dismissed with "Not now" on this device.
 */
export default function QuizEntryCard({ book, chapter, bookName, notKjv, parchment, href }: QuizEntryCardProps) {
	const offer = usePreference(readQuizOfferPref, true);
	// Unknown until mounted: localStorage does not exist in the server render,
	// and guessing "shown" would flash the card for a dismissed chapter.
	const [dismissed, setDismissed] = useState<boolean | null>(null);
	useEffect(() => {
		setDismissed(isChapterDismissed(book, chapter));
	}, [book, chapter]);

	if (!offer || dismissed !== false) return null;

	const title = `Quiz me on ${bookName} ${chapter}`;
	return (
		<section
			aria-label={title}
			className={`mt-8 rounded-2xl border px-5 py-6 text-center shadow-[0_0_24px_-8px_rgba(245,158,11,0.45)] ${
				parchment
					? "border-amber-800/40 bg-white/30 dark:border-amber-400/40 dark:bg-black/30"
					: "border-amber-500/50 dark:border-amber-400/40 bg-[hsl(var(--card))]"
			}`}
		>
			<h2
				className={`text-xl font-bold ${parchment ? "" : "text-neutral-900 dark:text-neutral-100"}`}
			>
				{title}
			</h2>
			<p
				className={`mx-auto mt-2 max-w-sm text-[0.9375rem] leading-6 ${
					parchment ? "opacity-75" : "text-neutral-500 dark:text-neutral-400"
				}`}
			>
				5 questions from what you just read. Every answer comes with its verse.
			</p>
			{notKjv ? (
				<p
					className={`mt-1 text-[0.8125rem] ${parchment ? "opacity-60" : "text-neutral-400 dark:text-neutral-500"}`}
				>
					Questions come from the King James text.
				</p>
			) : null}
			<Link
				href={href}
				className="mt-5 flex min-h-12 w-full items-center justify-center rounded-xl bg-amber-500 text-[1rem] font-bold text-neutral-950 transition-colors hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 dark:bg-amber-400 dark:hover:bg-amber-300"
			>
				Start quiz
			</Link>
			<button
				type="button"
				onClick={() => {
					dismissChapter(book, chapter);
					setDismissed(true);
				}}
				className={`mt-2 min-h-11 rounded-lg px-4 text-[0.9375rem] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
					parchment ? "opacity-70 hover:opacity-100" : "text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
				}`}
			>
				Not now
			</button>
		</section>
	);
}

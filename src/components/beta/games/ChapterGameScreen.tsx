"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, ListChecks } from "lucide-react";
import ChapterGamePlayer from "./ChapterGamePlayer";
import { chapterQuizHref, gameChapterHref, type ChapterGame, type GameAward } from "@/lib/beta/games/games-rules";

interface Props {
	game: ChapterGame;
	initialAward: GameAward | null;
	/** The founder has finished this chapter's quiz before. */
	quizTaken: boolean;
	/** The chapter after this game's, or null after Revelation. */
	next: { book: number; chapter: number; label: string } | null;
}

/**
 * A chapter game's own page (LC-17905): the game, and once it is beaten, what
 * is left of the chapter: its quiz when the founder has not taken it, then
 * the next chapter. A founder who already holds the award sees the way on
 * from the start.
 */
export default function ChapterGameScreen({ game, initialAward, quizTaken, next }: Props) {
	const [won, setWon] = useState(initialAward !== null);
	const [justWon, setJustWon] = useState(false);
	const nextRef = useRef<HTMLElement>(null);
	const onWon = useCallback(() => {
		setWon(true);
		setJustWon(true);
	}, []);

	// A win brings the way on into view under the game.
	useEffect(() => {
		if (!justWon) return;
		const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		nextRef.current?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
	}, [justWon]);

	return (
		<main className="mx-auto w-full max-w-3xl px-5 pb-[calc(var(--sureword-mobile-tab-clearance)+24px)] pt-4 lg:px-8 lg:pb-16 lg:pt-10">
			<Link href={gameChapterHref(game)} className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-bold text-neutral-600 hover:bg-black/5 dark:text-[#bbb3a7] dark:hover:bg-white/5">
				<ArrowLeft size={18} aria-hidden /> Matthew {game.chapter}
			</Link>
			<header className="mb-4 mt-2">
				<p className="text-xs font-bold uppercase tracking-[.14em] text-amber-800 dark:text-[#e5b664]">Chapter game · {game.reference}</p>
				<h1 className="font-[family-name:var(--font-cormorant)] text-[clamp(2rem,7vw,2.6rem)] font-semibold leading-[1.05]">{game.title}</h1>
			</header>

			<div className="-mx-3 sm:mx-0">
				<ChapterGamePlayer game={game} initialAward={initialAward} onWon={onWon} />
			</div>

			{won ? (
				<section ref={nextRef} aria-label="What's next" className="mx-auto mt-5 w-full max-w-[520px] scroll-mb-28">
					<p className="text-xs font-bold uppercase tracking-[.14em] text-neutral-600 dark:text-[#b3ad9e]">
						{justWon ? "Beaten! What's next" : "What's next"}
					</p>
					<div className="mt-2 flex flex-col gap-2">
						{quizTaken ? null : (
							<Link
								href={chapterQuizHref(game.book, game.chapter)}
								className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-amber-500/50 bg-amber-500/10 px-4 text-[16px] font-bold text-amber-800 hover:bg-amber-500/20 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-300 dark:hover:bg-amber-400/20"
							>
								<ListChecks size={20} aria-hidden /> Quiz on Matthew {game.chapter}
							</Link>
						)}
						{next ? (
							<Link
								href={`/bible/chapter?book=${next.book}&chapter=${next.chapter}`}
								className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 text-[16px] font-bold text-neutral-950 hover:bg-amber-400 dark:bg-amber-400 dark:hover:bg-amber-300"
							>
								Continue to {next.label} <ArrowRight size={20} aria-hidden />
							</Link>
						) : null}
					</div>
				</section>
			) : null}
		</main>
	);
}

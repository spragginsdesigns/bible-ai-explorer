"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Check, Gamepad2, ListChecks } from "lucide-react";
import AwardMedal from "./AwardMedal";
import { useBetaAccess, useGameProgress } from "./betaProbe";
import { readQuizOfferPref } from "@/lib/preferences";
import { usePreference } from "@/lib/preferencesSync";
import { chapterGameFor, gameHref } from "@/lib/beta/games/games-rules";

interface Props {
	order: number;
	chapter: number;
	parchment: boolean;
	/** The chapter's quiz, carrying the reader's route translation. */
	quizHref: string;
	/** The next chapter in the reader, or null after Revelation. */
	next: { href: string; label: string } | null;
	/** What everyone else sees here (the reader's "Quiz me" card). */
	fallback: ReactNode;
}

/**
 * The end of a chapter that has a game, for founders (SureWord Beta,
 * LC-17850; LC-17905): three ways on, the chapter's game by name, its quiz
 * and the next chapter. The game and the quiz each open on their own page,
 * and both offer the other one and the next chapter when they are done. The
 * next thing not yet done is the gold one.
 *
 * Chapters without a game, and everyone off the founders' list, see
 * `fallback`. The founders-only probe runs only on a chapter with a game, at
 * most once per account per session (betaProbe.ts).
 */
export default function ChapterGameCard({ order, chapter, parchment, quizHref, next, fallback }: Props) {
	const game = chapterGameFor(order, chapter);
	const allowed = useBetaAccess(game !== null);
	const progress = useGameProgress(game?.slug ?? null, allowed);
	const quizOffer = usePreference(readQuizOfferPref, true);

	if (!game || allowed === false) return <>{fallback}</>;
	// Unknown until the probe answers (once a session): show neither card rather than flash the wrong one.
	if (allowed === null) return null;

	const award = progress?.award ?? null;
	const quizTaken = progress?.quizTaken ?? false;
	const lead = !award ? "game" : quizOffer && !quizTaken ? "quiz" : "next";
	const muted = parchment ? "opacity-75" : "text-neutral-500 dark:text-neutral-400";
	const button = (primary: boolean) =>
		`flex min-h-14 items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
			primary
				? "bg-amber-500 text-neutral-950 hover:bg-amber-400 dark:bg-amber-400 dark:hover:bg-amber-300"
				: parchment
					? "border border-amber-800/40 bg-white/40 hover:bg-white/60 dark:border-amber-400/40 dark:bg-black/30 dark:hover:bg-black/45"
					: "border border-amber-500/40 bg-amber-500/[.06] text-neutral-900 hover:bg-amber-500/[.12] dark:border-amber-400/30 dark:text-neutral-100"
		}`;
	const sub = (primary: boolean) => `block text-[13px] font-semibold leading-tight ${primary ? "text-neutral-900/75" : muted}`;

	return (
		<section
			aria-label={`Finish ${game.reference.split(":")[0]}`}
			data-chapter-end={game.slug}
			className={`mt-8 rounded-2xl border px-4 py-4 ${
				parchment ? "border-amber-800/40 bg-white/30 dark:border-amber-400/40 dark:bg-black/30" : "border-amber-500/50 bg-[hsl(var(--card))] dark:border-amber-400/40"
			}`}
		>
			<h2 className={`text-xs font-bold uppercase tracking-[.14em] ${parchment ? "opacity-70" : "text-neutral-500 dark:text-neutral-400"}`}>
				Finished Matthew {chapter}? Keep going
			</h2>
			<div className={`mt-3 grid gap-2 ${quizOffer && next ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
				<Link href={gameHref(game)} className={button(lead === "game")}>
					{award ? (
						<AwardMedal grade={award.grade} emblem={game.emblem} size={36} title={`${game.award}: ${game.grades[award.grade]}`} />
					) : (
						<Gamepad2 size={26} strokeWidth={1.8} aria-hidden className="shrink-0" />
					)}
					<span className="min-w-0">
						<span className="block text-[16px] font-bold leading-tight">{game.title}</span>
						<span className={sub(lead === "game")}>{award ? game.grades[award.grade] : `Minigame · ${game.seconds} s`}</span>
					</span>
				</Link>
				{quizOffer ? (
					<Link href={quizHref} className={button(lead === "quiz")}>
						{quizTaken ? <Check size={26} strokeWidth={2.4} aria-hidden className="shrink-0" /> : <ListChecks size={26} strokeWidth={1.8} aria-hidden className="shrink-0" />}
						<span className="min-w-0">
							<span className="block text-[16px] font-bold leading-tight">Quiz</span>
							<span className={sub(lead === "quiz")}>{quizTaken ? "Taken · try again" : "5 questions"}</span>
						</span>
					</Link>
				) : null}
				{next ? (
					<Link href={next.href} className={button(lead === "next")}>
						<ArrowRight size={26} strokeWidth={1.8} aria-hidden className="shrink-0" />
						<span className="min-w-0">
							<span className="block text-[16px] font-bold leading-tight">Next chapter</span>
							<span className={sub(lead === "next")}>{next.label}</span>
						</span>
					</Link>
				) : null}
			</div>
		</section>
	);
}

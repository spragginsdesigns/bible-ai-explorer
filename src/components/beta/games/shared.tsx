"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { GameVerse } from "./types";
import type { ChapterGame, GameAward, GameRun } from "@/lib/beta/games/games-rules";

/**
 * What every chapter game shares (LC-17850, LC-17851; docs/beta/games.md):
 * the page's header and passage, the story screens over the stage, the mute
 * setting and saving a finished run as the award. Each game keeps its own
 * stage, controls and look.
 */

/** One mute setting for every chapter game, remembered on the device. */
export const MUTE_KEY = "sureword.beta.games.muted";

export function verseText(verses: readonly GameVerse[], from: number, to = from) {
	return verses.filter((item) => item.verse >= from && item.verse <= to);
}

export function chapterHref(game: Pick<ChapterGame, "book" | "chapter">) {
	return `/bible/chapter?book=${game.book}&chapter=${game.chapter}`;
}

/** A story screen over the stage: its words scroll if they must, its buttons never leave the stage. */
export function StoryScreen({ children, actions, centered = false, className = "bg-[#070b12]/80 text-[#f1eadc]" }: { children: ReactNode; actions: ReactNode; centered?: boolean; className?: string }) {
	return (
		<div className={`absolute inset-0 flex flex-col ${className}`}>
			<div className={`min-h-0 flex-1 overflow-y-auto px-5 pt-5 sm:px-8 sm:pt-8 ${centered ? "flex flex-col items-center text-center" : ""}`}>{children}</div>
			<div className={`flex shrink-0 flex-wrap items-center gap-3 px-5 pb-5 pt-3 sm:px-8 sm:pb-7 ${centered ? "justify-center" : ""}`}>{actions}</div>
		</div>
	);
}

/** Verses of the passage as the KJV gives them, numbered. */
export function Passage({ verses, className = "", numberClassName = "text-[#e5b664]" }: { verses: readonly GameVerse[]; className?: string; numberClassName?: string }) {
	return (
		<blockquote className={`font-[family-name:var(--font-cormorant)] text-[19px] leading-7 ${className}`}>
			{verses.map((item) => (
				<span key={item.verse}>
					<sup className={`mr-1 font-sans text-xs font-bold ${numberClassName}`}>{item.verse}</sup>
					{item.text}{" "}
				</span>
			))}
		</blockquote>
	);
}

/** Back to Chapter Games, the game's title and its passage in the reader. */
export function GameHeader({ game }: { game: ChapterGame }) {
	return (
		<>
			<Link href="/beta/bible/games" className="-ml-1 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-bold text-neutral-600 hover:bg-black/5 dark:text-[#bbb3a7] dark:hover:bg-white/5">
				<ArrowLeft size={18} aria-hidden /> Chapter Games
			</Link>
			<header className="mt-1 flex flex-wrap items-end justify-between gap-x-4 gap-y-1 px-1">
				<h1 className="font-[family-name:var(--font-cormorant)] text-[clamp(2rem,7vw,2.7rem)] font-semibold leading-[1.05]">{game.title}</h1>
				<Link href={chapterHref(game)} className="inline-flex min-h-11 items-center text-sm font-bold text-amber-800 underline-offset-2 hover:underline dark:text-[#e5b664]">
					{game.reference} ›
				</Link>
			</header>
		</>
	);
}

/** The whole passage under the game, in the KJV. */
export function PassageSection({ game, verses }: { game: ChapterGame; verses: readonly GameVerse[] }) {
	const id = `${game.slug}-passage`;
	return (
		<section aria-labelledby={id} className="mt-6 rounded-[22px] border border-black/[.09] bg-white/35 p-5 dark:border-white/[.09] dark:bg-white/[.025]">
			<h2 id={id} className="text-xs font-bold uppercase tracking-[.2em] text-neutral-600 dark:text-[#b3ad9e]">
				The passage · {game.reference} (KJV)
			</h2>
			<Passage verses={verses} className="mt-3" numberClassName="text-amber-700 dark:text-[#e5b664]" />
		</section>
	);
}

/** The device's mute setting for chapter games; `onChange` hears every toggle (to mute a game's sound). */
export function useMuted(onChange?: (muted: boolean) => void) {
	const [muted, setMuted] = useState(false);
	useEffect(() => {
		setMuted(window.localStorage.getItem(MUTE_KEY) === "1");
	}, []);
	const toggleMute = useCallback(() => {
		setMuted((value) => {
			const next = !value;
			window.localStorage.setItem(MUTE_KEY, next ? "1" : "0");
			onChange?.(next);
			return next;
		});
	}, [onChange]);
	return { muted, toggleMute };
}

export type AwardSaving = { status: "idle" } | { status: "saving" } | { status: "saved" } | { status: "error"; message: string };

/**
 * Saves a finished run as the founder's award for this game
 * (POST /api/beta/games/<slug>/award) and holds the award as it now stands.
 */
export function useGameAward(slug: string, initialAward: GameAward | null) {
	const [award, setAward] = useState<GameAward | null>(initialAward);
	const [saving, setSaving] = useState<AwardSaving>({ status: "idle" });
	const save = useCallback(
		async (run: GameRun) => {
			setSaving({ status: "saving" });
			try {
				const response = await fetch(`/api/beta/games/${slug}/award`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ faithKept: run.faithKept, seconds: run.seconds, swellsCleared: run.swellsCleared }),
				});
				const data = (await response.json().catch(() => null)) as { award?: GameAward; error?: string } | null;
				if (!response.ok || !data?.award) throw new Error(data?.error ?? "Your award could not be saved.");
				setAward(data.award);
				setSaving({ status: "saved" });
			} catch (error) {
				setSaving({ status: "error", message: error instanceof Error ? error.message : "Your award could not be saved." });
			}
		},
		[slug],
	);
	const resetSaving = useCallback(() => setSaving({ status: "idle" }), []);
	return { award, saving, save, resetSaving };
}

/** The line under a finished game's award: saving, saved with the award as it stands, or the error with Try again. */
export function AwardSaveStatus({ game, award, saving, onRetry, className = "text-[#bbb3a7]" }: { game: ChapterGame; award: GameAward | null; saving: AwardSaving; onRetry: () => void; className?: string }) {
	return (
		<p className={`mt-1 min-h-5 text-xs ${className}`} aria-live="polite">
			{saving.status === "saving" && "Saving your award…"}
			{saving.status === "saved" && award && `Saved to your awards · best ${game.grades[award.grade]}, finished ${award.completions} ${award.completions === 1 ? "time" : "times"}`}
			{saving.status === "error" && (
				<>
					{saving.message}{" "}
					<button type="button" onClick={onRetry} className="min-h-11 font-bold text-[#e5b664] underline">
						Try again
					</button>
				</>
			)}
		</p>
	);
}

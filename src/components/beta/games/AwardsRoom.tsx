"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, ChevronRight, Trophy } from "lucide-react";
import AwardMedal from "./AwardMedal";
import { DESTINATION_TILE, IconTile } from "../visuals";
import { chapterQuizHref, gameChapterHref, gameHref } from "@/lib/beta/games/games-rules";
import { quizPercent, type ChapterStanding } from "@/lib/beta/games/awards-room-rules";
import type { AwardsRoom as Room } from "@/lib/beta/games/awards-room";

/**
 * The Awards Room (LC-17906, docs/beta/games.md): the founder's grade,
 * chapters complete, trophies and a plaque for every chapter of Matthew.
 * Trophies earned since the founder last opened the room are marked New
 * (remembered on this device only).
 */

const SEEN_KEY = "sureword:beta:awards-room:seen";
const CARD = "rounded-[22px] border bg-white/35 dark:bg-white/[.025]";
/** One border colour per card: two border-colour classes on one element resolve by stylesheet order, not class order. */
const QUIET = "border-black/[.09] dark:border-white/[.09]";
const GOLD = "border-amber-500/60 dark:border-amber-400/50";
const LABEL = "text-xs font-bold uppercase tracking-[.14em] text-neutral-600 dark:text-[#b3ad9e]";

/** The one thing left to do on a chapter, in the order the chapter's end offers it (read, game, quiz). */
function nextStep(standing: ChapterStanding): { href: string; label: string } {
	if (standing.read !== "complete") return { href: gameChapterHref(standing.game), label: "Read the chapter" };
	if (!standing.award) return { href: gameHref(standing.game), label: `Play ${standing.game.title}` };
	if (!standing.quiz) return { href: chapterQuizHref(standing.game.book, standing.chapter), label: "Take the quiz" };
	return { href: gameChapterHref(standing.game), label: "Complete" };
}

function useNewTrophies(earned: string[]): Set<string> {
	const [fresh, setFresh] = useState<Set<string>>(new Set());
	const key = earned.join(",");
	useEffect(() => {
		let seen: string[] = [];
		try {
			const parsed: unknown = JSON.parse(window.localStorage.getItem(SEEN_KEY) ?? "[]");
			if (Array.isArray(parsed)) seen = parsed.filter((slug): slug is string => typeof slug === "string");
		} catch {
			seen = [];
		}
		const slugs = key ? key.split(",") : [];
		setFresh(new Set(slugs.filter((slug) => !seen.includes(slug))));
		try {
			window.localStorage.setItem(SEEN_KEY, JSON.stringify([...new Set([...seen, ...slugs])]));
		} catch {
			// Storage refused (private mode): nothing is remembered, so earned trophies read New on every visit.
		}
	}, [key]);
	return fresh;
}

function ProgressRing({ done, of }: { done: number; of: number }) {
	const radius = 34;
	const length = 2 * Math.PI * radius;
	const share = of > 0 ? done / of : 0;
	return (
		<div className="relative h-[88px] w-[88px] shrink-0">
			<svg width="88" height="88" viewBox="0 0 88 88" aria-hidden className="-rotate-90">
				<circle cx="44" cy="44" r={radius} fill="none" strokeWidth="8" className="stroke-black/[.08] dark:stroke-white/[.1]" />
				{done > 0 ? (
					<circle cx="44" cy="44" r={radius} fill="none" stroke="#e5b664" strokeWidth="8" strokeLinecap="round" strokeDasharray={`${share * length} ${length}`} />
				) : null}
			</svg>
			<span className="absolute inset-0 flex flex-col items-center justify-center leading-none">
				<span className="font-[family-name:var(--font-cormorant)] text-[28px] font-bold">{done}</span>
				<span className="mt-0.5 text-xs font-bold text-neutral-600 dark:text-[#b3ad9e]">of {of}</span>
			</span>
		</div>
	);
}

function Part({ done, started, label }: { done: boolean; started?: boolean; label: string }) {
	return (
		<span
			className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${
				done
					? "bg-amber-500/15 text-amber-900 dark:bg-amber-400/15 dark:text-amber-200"
					: "border border-black/10 text-neutral-500 dark:border-white/10 dark:text-[#9c9586]"
			}`}
		>
			{done ? <Check size={12} strokeWidth={3} aria-hidden /> : null}
			{label}
			{!done && started ? " · started" : null}
			<span className="sr-only">{done ? " done" : " not yet"}</span>
		</span>
	);
}

export default function AwardsRoom({ room }: { room: Room }) {
	const { scorecard, trophies, chapters } = room;
	const fresh = useNewTrophies(trophies.filter((standing) => standing.earned).map((standing) => standing.trophy.slug));
	const medals = scorecard.medals.gold + scorecard.medals.silver + scorecard.medals.bronze;
	const earnedTrophies = trophies.filter((standing) => standing.earned).length;

	return (
		<main className="mx-auto w-full max-w-3xl px-5 pb-[calc(var(--sureword-mobile-tab-clearance)+24px)] pt-4 lg:px-8 lg:pb-16 lg:pt-10">
			<Link href="/beta/bible/games" className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-bold text-neutral-600 hover:bg-black/5 dark:text-[#bbb3a7] dark:hover:bg-white/5">
				<ArrowLeft size={18} aria-hidden /> Chapter Games
			</Link>
			<header className="mt-3 flex items-start gap-4">
				<IconTile Icon={Trophy} tone={DESTINATION_TILE.bible} size="lg" />
				<div className="min-w-0">
					<h1 className="font-[family-name:var(--font-cormorant)] text-[clamp(2.2rem,8vw,2.9rem)] font-semibold leading-[1.02]">Awards Room</h1>
					<p className="mt-1.5 text-base text-neutral-700 dark:text-[#d9d1c3]">
						The Gospel of Matthew. Read each chapter, win its game and take its quiz to complete it.
					</p>
				</div>
			</header>

			<section aria-label="Scorecard" className={`mt-6 p-4 sm:p-5 ${CARD} ${QUIET}`}>
				<div className="flex items-center gap-4">
					<div className="min-w-0 flex-1">
						<p className={LABEL}>Grade so far</p>
						<p className="mt-1 font-[family-name:var(--font-cormorant)] text-[56px] font-bold leading-none text-amber-800 dark:text-[#e5b664]" data-room-grade>
							{scorecard.grade ?? "—"}
						</p>
						<p className="mt-1.5 text-sm text-neutral-700 dark:text-[#d9d1c3]">
							{scorecard.score === null ? "Win a chapter game or take a quiz to earn your first grade." : `Average of your best scores: ${scorecard.score}%`}
						</p>
					</div>
					<div className="flex flex-col items-center gap-1">
						<ProgressRing done={scorecard.complete} of={scorecard.chapters} />
						<span className="text-xs font-bold text-neutral-600 dark:text-[#b3ad9e]">chapters complete</span>
					</div>
				</div>
				<dl className="mt-4 grid grid-cols-3 gap-2 border-t border-black/[.07] pt-4 dark:border-white/[.07]">
					<div>
						<dt className={LABEL}>Read</dt>
						<dd className="mt-1 text-lg font-bold leading-tight">
							{scorecard.read}
							<span className="text-sm font-semibold text-neutral-600 dark:text-[#b3ad9e]"> of {scorecard.chapters}</span>
						</dd>
					</div>
					<div>
						<dt className={LABEL}>Medals</dt>
						<dd className="mt-1 text-lg font-bold leading-tight">{medals}</dd>
						{medals ? (
							<dd className="mt-0.5 text-xs font-semibold text-neutral-600 dark:text-[#b3ad9e]">
								{(["gold", "silver", "bronze"] as const)
									.filter((grade) => scorecard.medals[grade] > 0)
									.map((grade) => `${scorecard.medals[grade]} ${grade}`)
									.join(" · ")}
							</dd>
						) : null}
					</div>
					<div>
						<dt className={LABEL}>Quizzes</dt>
						<dd className="mt-1 text-lg font-bold leading-tight">{scorecard.quizzes}</dd>
						{scorecard.quizAverage !== null ? (
							<dd className="mt-0.5 text-xs font-semibold text-neutral-600 dark:text-[#b3ad9e]">best average {scorecard.quizAverage}%</dd>
						) : null}
					</div>
				</dl>
			</section>

			<section aria-labelledby="room-trophies" className="mt-8">
				<div className="flex items-baseline justify-between gap-3">
					<h2 id="room-trophies" className="font-[family-name:var(--font-cormorant)] text-[26px] font-semibold leading-tight">Trophies</h2>
					<span className={LABEL}>
						{earnedTrophies} of {trophies.length}
					</span>
				</div>
				<ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
					{trophies.map(({ trophy, done, of, earned, verseText }) => {
						const whole = trophy.chapters[0] === 1 && trophy.chapters[1] === chapters.length;
						const span = whole ? `All ${of} chapters` : `Matthew ${trophy.chapters[0]}–${trophy.chapters[1]}`;
						return (
							<li
								key={trophy.slug}
								data-trophy={trophy.slug}
								data-earned={earned ? "true" : "false"}
								className={`relative flex flex-col p-3.5 ${CARD} ${earned ? GOLD : QUIET} ${whole ? "col-span-2 sm:col-span-3" : ""}`}
							>
								{fresh.has(trophy.slug) ? (
									<span className="absolute right-3 top-3 rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-neutral-950 dark:bg-amber-400">New</span>
								) : null}
								<Trophy
									size={whole ? 40 : 32}
									strokeWidth={earned ? 2.2 : 1.6}
									aria-hidden
									className={earned ? "fill-[#e5b664]/40 text-amber-700 dark:text-[#e5b664]" : "text-neutral-400 dark:text-[#6f6a60]"}
								/>
								<h3 className={`mt-2 font-[family-name:var(--font-cormorant)] font-semibold leading-tight ${whole ? "text-[24px]" : "text-[20px]"}`}>{trophy.title}</h3>
								<p className="text-xs font-bold uppercase tracking-[.12em] text-amber-800 dark:text-[#e5b664]">{span}</p>
								{earned ? (
									<blockquote className="mt-2 text-sm italic leading-snug text-neutral-700 dark:text-[#d9d1c3]">
										{verseText}
										<span className="mt-1 block text-xs font-bold not-italic text-neutral-600 dark:text-[#b3ad9e]">
											Matthew {trophy.verse[0]}:{trophy.verse[1]}
										</span>
									</blockquote>
								) : (
									<div className="mt-auto pt-3">
										<p className="text-xs font-bold text-neutral-600 dark:text-[#b3ad9e]">
											{done} of {of} chapters complete
										</p>
										<div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-black/[.07] dark:bg-white/[.08]">
											<div className="h-full rounded-full bg-amber-500 dark:bg-amber-400" style={{ width: `${Math.round((done / of) * 100)}%` }} />
										</div>
									</div>
								)}
							</li>
						);
					})}
				</ul>
			</section>

			<section aria-labelledby="room-chapters" className="mt-8">
				<h2 id="room-chapters" className="font-[family-name:var(--font-cormorant)] text-[26px] font-semibold leading-tight">Chapters</h2>
				<ol className="mt-3 space-y-2">
					{chapters.map((standing) => {
						const { game, award, quiz, read, complete } = standing;
						const step = nextStep(standing);
						return (
							<li key={game.slug} data-plaque={standing.chapter} data-complete={complete ? "true" : "false"}>
								<Link
									href={step.href}
									aria-label={`Matthew ${standing.chapter}, ${game.title}: ${step.label === "Complete" ? "complete" : `next, ${step.label.toLowerCase()}`}`}
									className={`flex min-h-11 items-center gap-3 p-3 hover:bg-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:hover:bg-white/[.05] ${CARD} ${complete ? GOLD : QUIET}`}
								>
									{award ? (
										<AwardMedal grade={award.grade} emblem={game.emblem} size={44} title={`${award.grade} medal`} />
									) : (
										<span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-black/15 font-[family-name:var(--font-cormorant)] text-lg font-bold text-neutral-500 dark:border-white/15 dark:text-[#9c9586]">
											{standing.chapter}
										</span>
									)}
									<span className="min-w-0 flex-1">
										<span className="block text-xs font-bold uppercase tracking-[.14em] text-amber-800 dark:text-[#e5b664]">
											Matthew {standing.chapter}
											{award ? <span className="normal-case tracking-normal"> · {game.grades[award.grade]}</span> : null}
										</span>
										<span className="block font-[family-name:var(--font-cormorant)] text-[19px] font-semibold leading-tight">{game.title}</span>
										<span className="mt-1 flex flex-wrap gap-1">
											<Part done={read === "complete"} started={read === "started"} label="Read" />
											<Part done={award !== null} label={award ? `Game ${award.bestFaith}%` : "Game"} />
											<Part done={quiz !== null} label={quiz ? `Quiz ${quiz.correct}/${quiz.total}` : "Quiz"} />
										</span>
									</span>
									{complete ? (
										<span title="Complete" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500 text-neutral-950 dark:bg-amber-400">
											<Check size={16} strokeWidth={3} aria-hidden />
										</span>
									) : (
										<ChevronRight size={20} aria-hidden className="shrink-0 text-neutral-500 dark:text-[#9c9586]" />
									)}
								</Link>
							</li>
						);
					})}
				</ol>
				{chapters.some((standing) => standing.quiz && quizPercent(standing.quiz) < 100) ? (
					<p className="mt-3 text-sm text-neutral-600 dark:text-[#b3ad9e]">Your best try counts. Take a quiz or play a game again to raise your grade.</p>
				) : null}
			</section>
		</main>
	);
}

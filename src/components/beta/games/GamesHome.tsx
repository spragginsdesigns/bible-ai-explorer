"use client";

import Link from "next/link";
import { ArrowLeft, Gamepad2 } from "lucide-react";
import AwardMedal from "./AwardMedal";
import { DESTINATION_TILE, IconTile } from "../visuals";
import { CHAPTER_GAMES, gameHref, type GameAward } from "@/lib/beta/games/games-rules";

/**
 * Chapter Games' home (LC-17850, docs/beta/games.md): a game for every
 * chapter of Matthew, each opening on its own page (LC-17905), with the
 * founder's medal once it is won.
 */
export default function GamesHome({ awards }: { awards: Record<string, GameAward> }) {
	const earned = CHAPTER_GAMES.filter((game) => awards[game.slug]).length;
	return (
		<main className="mx-auto w-full max-w-3xl px-5 pb-[calc(var(--sureword-mobile-tab-clearance)+24px)] pt-4 lg:px-8 lg:pb-16 lg:pt-10">
			<Link href="/beta/bible" className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-bold text-neutral-600 hover:bg-black/5 dark:text-[#bbb3a7] dark:hover:bg-white/5">
				<ArrowLeft size={18} aria-hidden /> Bible
			</Link>
			<header className="mt-3 flex items-start gap-4">
				<IconTile Icon={Gamepad2} tone={DESTINATION_TILE.bible} size="lg" />
				<div className="min-w-0">
					<h1 className="font-[family-name:var(--font-cormorant)] text-[clamp(2.2rem,8vw,2.9rem)] font-semibold leading-[1.02]">Chapter Games</h1>
					<p className="mt-1.5 text-base text-neutral-700 dark:text-[#d9d1c3]">A quick game for every chapter of Matthew. Win it to earn its award.</p>
					<p className="mt-2 text-xs font-bold uppercase tracking-[.16em] text-neutral-600 dark:text-[#b3ad9e]">
						{earned} of {CHAPTER_GAMES.length} awards earned
					</p>
				</div>
			</header>

			<ol className="mt-6 space-y-3">
				{CHAPTER_GAMES.map((game) => {
					const award = awards[game.slug];
					return (
						<li key={game.slug} className="rounded-[22px] border border-black/[.09] bg-white/35 p-3 dark:border-white/[.09] dark:bg-white/[.025]">
							<div className="flex items-center gap-3">
								{award ? (
									<AwardMedal grade={award.grade} emblem={game.emblem} size={52} title={`${award.grade} medal`} />
								) : (
									<span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full border-2 border-dashed border-black/15 font-[family-name:var(--font-cormorant)] text-xl font-bold text-neutral-500 dark:border-white/15 dark:text-[#9c9586]">
										{game.chapter}
									</span>
								)}
								<span className="min-w-0 flex-1">
									<span className="block text-xs font-bold uppercase tracking-[.14em] text-amber-800 dark:text-[#e5b664]">Matthew {game.chapter}</span>
									<span className="block font-[family-name:var(--font-cormorant)] text-[22px] font-semibold leading-tight">{game.title}</span>
									<span className="block text-sm text-neutral-700 dark:text-[#d9d1c3]">
										{award ? `${game.award}: ${game.grades[award.grade]} · best ${award.bestFaith}%` : game.tagline}
									</span>
								</span>
								<Link
									href={gameHref(game)}
									aria-label={`${award ? "Play again" : "Play"} ${game.title}`}
									className="flex min-h-11 shrink-0 items-center rounded-xl bg-amber-500 px-4 text-[15px] font-bold text-neutral-950 hover:bg-amber-400 dark:bg-amber-400 dark:hover:bg-amber-300"
								>
									{award ? "Play again" : "Play"}
								</Link>
							</div>
						</li>
					);
				})}
			</ol>
		</main>
	);
}

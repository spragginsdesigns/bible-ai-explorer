import Link from "next/link";
import { ArrowLeft, Gamepad2 } from "lucide-react";
import AwardMedal from "./AwardMedal";
import { DESTINATION_TILE, IconTile } from "../visuals";
import { CHAPTER_GAMES, gameHref, type GameAward } from "@/lib/beta/games/games-rules";

/**
 * Chapter Games' home (LC-17850, docs/beta/games.md): every chapter with a
 * game, each with the founder's award once it is earned.
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
					<p className="mt-1.5 text-base text-neutral-700 dark:text-[#d9d1c3]">Play the chapter you just read, and earn its award.</p>
					<p className="mt-2 text-xs font-bold uppercase tracking-[.16em] text-neutral-600 dark:text-[#b3ad9e]">
						{earned} of {CHAPTER_GAMES.length} {CHAPTER_GAMES.length === 1 ? "award" : "awards"} earned
					</p>
				</div>
			</header>

			<ul className="mt-7 space-y-3">
				{CHAPTER_GAMES.map((game) => {
					const award = awards[game.slug];
					return (
						<li key={game.slug}>
							<Link
								href={gameHref(game)}
								className="flex items-center gap-4 rounded-[22px] border border-black/[.09] bg-white/35 p-4 hover:bg-white/60 dark:border-white/[.09] dark:bg-white/[.025] dark:hover:bg-white/[.05]"
							>
								{award ? (
									<AwardMedal grade={award.grade} size={56} title={`${award.grade} medal`} />
								) : (
									<span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-black/15 text-xs font-bold text-neutral-500 dark:border-white/15 dark:text-[#9c9586]">
										Award
									</span>
								)}
								<span className="min-w-0 flex-1">
									<span className="block text-xs font-bold uppercase tracking-[.16em] text-amber-800 dark:text-[#e5b664]">{game.reference}</span>
									<span className="mt-0.5 block font-[family-name:var(--font-cormorant)] text-2xl font-semibold leading-tight">{game.title}</span>
									<span className="mt-0.5 block text-sm text-neutral-700 dark:text-[#d9d1c3]">{game.tagline}</span>
									<span className="mt-1.5 block text-sm font-semibold text-neutral-600 dark:text-[#bbb3a7]">
										{award
											? `${game.award}: ${game.grades[award.grade]} · faith kept ${award.bestFaith}% · best ${award.bestSeconds}s · finished ${award.completions} ${award.completions === 1 ? "time" : "times"}`
											: `Finish it to earn ${game.award}`}
									</span>
								</span>
								<span aria-hidden className="text-xl text-neutral-400">
									›
								</span>
							</Link>
						</li>
					);
				})}
			</ul>
			<p className="mt-6 text-sm leading-6 text-neutral-600 dark:text-[#bbb3a7]">
				More chapters are on the way. Reading a chapter that has a game? Its card is at the end of the chapter.
			</p>
		</main>
	);
}

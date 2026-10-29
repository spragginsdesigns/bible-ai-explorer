"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useAuth } from "@clerk/nextjs";
import { Gamepad2 } from "lucide-react";
import AwardMedal from "./AwardMedal";
import { chapterGameFor, type GameAward } from "@/lib/beta/games/games-rules";

/** The player loads only when Play is pressed, so the reader carries none of the games' code. */
const ChapterGamePlayer = dynamic(() => import("./ChapterGamePlayer"), {
	loading: () => <div className="mx-auto aspect-square w-full max-w-[520px] animate-pulse rounded-[20px] bg-[#0b0f17]" aria-label="Loading the game" />,
});

/**
 * The reader's way into SureWord Beta's Chapter Games (LC-17850,
 * docs/beta/games.md): at the end of a chapter that has a game, for founders
 * only, a card whose Play opens the game right here in the page (LC-17851),
 * with the founder's medal once it is won.
 *
 * Chapters without a game never ask anything. On one that has a game, the
 * founders-only probe (GET /api/beta/access, the one beta route every account
 * may ask) is made at most once per account per session, the same pattern as
 * the atlas's verse links and the settings menu's own check (each surface
 * keeps its own, docs/beta/README.md: a module touches only its own files).
 */
const betaAccess = new Map<string, boolean>();
const asking = new Map<string, Promise<boolean>>();

function probeBeta(userId: string): Promise<boolean> {
	const known = betaAccess.get(userId);
	if (known !== undefined) return Promise.resolve(known);
	let pending = asking.get(userId);
	if (!pending) {
		pending = fetch("/api/beta/access", { cache: "no-store" })
			.then((response) => (response.ok ? response.json() : null))
			.then((data: { beta?: unknown } | null) => {
				const beta = data?.beta === true;
				if (data) betaAccess.set(userId, beta);
				return beta;
			})
			.catch(() => false)
			.finally(() => asking.delete(userId));
		asking.set(userId, pending);
	}
	return pending;
}

export default function ChapterGameCard({ order, chapter, parchment }: { order: number; chapter: number; parchment: boolean }) {
	const { userId } = useAuth();
	const game = chapterGameFor(order, chapter);
	const [allowed, setAllowed] = useState<string | null>(null);
	const [open, setOpen] = useState(false);
	const [award, setAward] = useState<GameAward | null>(null);

	useEffect(() => {
		if (!userId || !game) return;
		let live = true;
		probeBeta(userId).then((beta) => {
			if (live && beta) setAllowed(userId);
		});
		return () => {
			live = false;
		};
	}, [userId, game]);

	// The founder's medal for this chapter, read once the card shows.
	useEffect(() => {
		if (!game || !userId || allowed !== userId) return;
		let live = true;
		fetch(`/api/beta/games/${game.slug}/award`, { cache: "no-store" })
			.then((response) => (response.ok ? response.json() : null))
			.then((data: { award?: GameAward | null } | null) => {
				if (live && data?.award) setAward(data.award);
			})
			.catch(() => {});
		return () => {
			live = false;
		};
	}, [game, userId, allowed, open]);

	if (!game || !userId || allowed !== userId) return null;
	const muted = parchment ? "opacity-75" : "text-neutral-500 dark:text-neutral-400";
	return (
		<section
			aria-label={`Chapter game: ${game.title}`}
			className={`mt-8 rounded-2xl border px-4 py-4 ${
				parchment ? "border-amber-800/40 bg-white/30 dark:border-amber-400/40 dark:bg-black/30" : "border-amber-500/50 bg-[hsl(var(--card))] dark:border-amber-400/40"
			}`}
		>
			<div className="flex items-center gap-4">
				{award ? (
					<AwardMedal grade={award.grade} emblem={game.emblem} size={48} title={`${game.award}: ${game.grades[award.grade]}`} />
				) : (
					<span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-amber-500/[.14] text-amber-800 dark:bg-amber-300/[.12] dark:text-amber-200">
						<Gamepad2 size={24} strokeWidth={1.7} />
					</span>
				)}
				<span className="min-w-0 flex-1">
					<span className={`block text-xs font-bold uppercase tracking-[.14em] ${parchment ? "opacity-70" : "text-neutral-500 dark:text-neutral-400"}`}>
						Chapter game · {game.seconds} seconds
					</span>
					<span className={`block text-lg font-bold leading-tight ${parchment ? "" : "text-neutral-900 dark:text-neutral-100"}`}>{game.title}</span>
					<span className={`block text-sm ${muted}`}>{award ? `${game.award}: ${game.grades[award.grade]}` : game.tagline}</span>
				</span>
				{open ? null : (
					<button
						type="button"
						onClick={() => setOpen(true)}
						className="flex min-h-11 shrink-0 items-center rounded-xl bg-amber-500 px-4 text-[15px] font-bold text-neutral-950 hover:bg-amber-400 dark:bg-amber-400 dark:hover:bg-amber-300"
					>
						{award ? "Play again" : "Play"}
					</button>
				)}
			</div>
			{open ? (
				<div className="-mx-3 mt-4 sm:mx-0">
					<ChapterGamePlayer game={game} initialAward={award} onClose={() => setOpen(false)} />
				</div>
			) : null}
		</section>
	);
}

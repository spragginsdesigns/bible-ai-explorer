"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { Gamepad2 } from "lucide-react";
import { chapterGamesFor, gameHref } from "@/lib/beta/games/games-rules";

/**
 * The reader's way into SureWord Beta's Chapter Games (LC-17850,
 * docs/beta/games.md): at the end of a chapter that has a game, for founders
 * only, a card that opens it, or each way to play it when the passage has more
 * than one (LC-17851).
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
	const games = chapterGamesFor(order, chapter);
	const hasGame = games.length > 0;
	const [allowed, setAllowed] = useState<string | null>(null);

	useEffect(() => {
		if (!userId || !hasGame) return;
		let live = true;
		probeBeta(userId).then((beta) => {
			if (live && beta) setAllowed(userId);
		});
		return () => {
			live = false;
		};
	}, [userId, hasGame]);

	if (!hasGame || !userId || allowed !== userId) return null;
	const [first] = games;
	const muted = parchment ? "opacity-75" : "text-neutral-500 dark:text-neutral-400";
	const play = "flex min-h-11 shrink-0 items-center rounded-xl bg-amber-500 px-4 text-[15px] font-bold text-neutral-950 hover:bg-amber-400 dark:bg-amber-400 dark:hover:bg-amber-300";
	return (
		<section
			aria-label={games.length === 1 ? `Chapter game: ${first.title}` : `Chapter games: ${first.reference}`}
			className={`mt-8 rounded-2xl border px-4 py-4 ${
				parchment ? "border-amber-800/40 bg-white/30 dark:border-amber-400/40 dark:bg-black/30" : "border-amber-500/50 bg-[hsl(var(--card))] dark:border-amber-400/40"
			}`}
		>
			<div className="flex items-center gap-4">
				<span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-amber-500/[.14] text-amber-800 dark:bg-amber-300/[.12] dark:text-amber-200">
					<Gamepad2 size={24} strokeWidth={1.7} />
				</span>
				<span className="min-w-0 flex-1">
					<span className={`block text-xs font-bold uppercase tracking-[.14em] ${parchment ? "opacity-70" : "text-neutral-500 dark:text-neutral-400"}`}>
						{games.length === 1 ? "Chapter game" : `Chapter games · ${games.length} ways to play`} · {first.reference}
					</span>
					{games.length === 1 ? (
						<>
							<span className={`block text-lg font-bold leading-tight ${parchment ? "" : "text-neutral-900 dark:text-neutral-100"}`}>{first.title}</span>
							<span className={`block text-sm ${muted}`}>{first.tagline}</span>
						</>
					) : (
						<span className={`block text-lg font-bold leading-tight ${parchment ? "" : "text-neutral-900 dark:text-neutral-100"}`}>{first.story}</span>
					)}
				</span>
				{games.length === 1 ? (
					<Link href={gameHref(first)} className={play}>
						Play
					</Link>
				) : null}
			</div>
			{games.length > 1 ? (
				<ul className="mt-3 divide-y divide-black/[.08] dark:divide-white/[.08]">
					{games.map((game) => (
						<li key={game.slug} className="flex items-center gap-3 py-2.5">
							<span className="min-w-0 flex-1">
								<span className={`block font-bold leading-tight ${parchment ? "" : "text-neutral-900 dark:text-neutral-100"}`}>{game.title}</span>
								<span className={`block text-sm ${muted}`}>{game.style}</span>
							</span>
							<Link href={gameHref(game)} aria-label={`Play ${game.title}`} className={play}>
								Play
							</Link>
						</li>
					))}
				</ul>
			) : null}
		</section>
	);
}

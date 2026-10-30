"use client";

import Link from "next/link";
import { Gamepad2 } from "lucide-react";
import { useBetaAccess, useGameProgress } from "./betaProbe";
import { chapterGameFor, gameHref } from "@/lib/beta/games/games-rules";

/**
 * On the quiz results, for founders (SureWord Beta, LC-17905): the chapter's
 * game, while it is not yet won, beside "Continue to the next chapter". Shows
 * nothing on a chapter without a game, off the founders' list, or once won.
 */
export default function QuizGameStep({ book, chapter, className }: { book: number; chapter: number; className: string }) {
	const game = chapterGameFor(book, chapter);
	const allowed = useBetaAccess(game !== null);
	const progress = useGameProgress(game?.slug ?? null, allowed);
	if (!game || allowed !== true || !progress || progress.award) return null;
	return (
		<Link href={gameHref(game)} className={className}>
			<Gamepad2 size={20} aria-hidden className="mr-2" /> Play {game.title}
		</Link>
	);
}

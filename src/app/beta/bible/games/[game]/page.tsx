import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ChapterGamePlayer from "@/components/beta/games/ChapterGamePlayer";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";
import { getKjvChapter } from "@/lib/bible/kjv";
import { listGameAwards } from "@/lib/beta/games/awards";
import { findChapterGame } from "@/lib/beta/games/games-rules";

/**
 * One chapter game (LC-17850, docs/beta/games.md). The passage it plays is
 * read from the bundled KJV here and handed to the game, so every verse it
 * quotes is the text itself. An unknown game is the ordinary 404.
 */
type Props = { params: Promise<{ game: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
	const game = findChapterGame((await params).game);
	return betaMetadata(game ? { title: game.title } : {});
}

export default async function BetaChapterGamePage({ params }: Props) {
	const userId = await requireBetaPage();
	const game = findChapterGame((await params).game);
	if (!game) notFound();
	const [chapter, awards] = await Promise.all([getKjvChapter(game.book, game.chapter), listGameAwards(userId)]);
	const [from, to] = game.verses;
	const verses = chapter.slice(from - 1, to).map((text, index) => ({ verse: from + index, text }));
	// Each game's component is chosen, and loaded on its own, by slug (ChapterGamePlayer).
	return <ChapterGamePlayer game={game} verses={verses} initialAward={awards[game.slug] ?? null} />;
}

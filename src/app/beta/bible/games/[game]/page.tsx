import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ChapterGameScreen from "@/components/beta/games/ChapterGameScreen";
import { nextChapterAfter } from "@/components/quiz/quizView";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";
import { listGameAwards } from "@/lib/beta/games/awards";
import { findChapterGame } from "@/lib/beta/games/games-rules";
import { bookByOrder } from "@/lib/bible/books";
import { hasQuizAttempt } from "@/lib/quiz";

/**
 * One chapter game on its own page (LC-17905, docs/beta/games.md), opened
 * from the end of its chapter in the reader or from the games list. After a
 * win it offers the chapter's quiz if the founder has not taken it, and the
 * next chapter. An unknown game is the ordinary 404.
 */
type Props = { params: Promise<{ game: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
	const game = findChapterGame((await params).game);
	return betaMetadata(game ? { title: game.title } : {});
}

export default async function BetaChapterGamePage({ params }: Props) {
	const userId = await requireBetaPage();
	const game = findChapterGame((await params).game);
	const book = game ? bookByOrder(game.book) : null;
	if (!game || !book) notFound();
	const [awards, quizTaken] = await Promise.all([listGameAwards(userId), hasQuizAttempt(userId, game.book, game.chapter)]);
	const next = nextChapterAfter(game.book, game.chapter, book.chapters);
	const nextBook = next ? bookByOrder(next.book) : null;
	return (
		<ChapterGameScreen
			game={game}
			initialAward={awards[game.slug] ?? null}
			quizTaken={quizTaken}
			next={next && nextBook ? { book: next.book, chapter: next.chapter, label: `${nextBook.name} ${next.chapter}` } : null}
		/>
	);
}

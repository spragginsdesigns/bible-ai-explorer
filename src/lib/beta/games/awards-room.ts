import "server-only";

import { prisma } from "@/lib/prisma";
import { getKjvBook } from "@/lib/bible/kjv";
import { foldBookCoverage } from "@/lib/reading-overview-rules";
import { listGameAwards } from "@/lib/beta/games/awards";
import { CHAPTER_GAMES } from "@/lib/beta/games/games-rules";
import {
	MATTHEW_TROPHIES,
	bestQuiz,
	chapterStandings,
	roomScorecard,
	trophyStandings,
	type ChapterRead,
	type ChapterStanding,
	type QuizScore,
	type RoomScorecard,
	type TrophyStanding,
} from "@/lib/beta/games/awards-room-rules";

/**
 * The Awards Room's data (LC-17906, docs/beta/games.md): the founder's game
 * awards (the study store, through `listGameAwards`), their quizzes on
 * Matthew (`QuizAttempt`) and the chapters they have read (the reading log's
 * per-chapter summary), read only. Nothing here writes, and nothing is kept
 * twice: the room is worked out from those records every time it opens.
 */

const MATTHEW = 40;

export interface AwardsRoom {
	chapters: ChapterStanding[];
	trophies: (TrophyStanding & { verseText: string })[];
	scorecard: RoomScorecard;
}

export async function loadAwardsRoom(userId: string): Promise<AwardsRoom> {
	const [awards, attempts, readRows, book] = await Promise.all([
		listGameAwards(userId),
		prisma.quizAttempt.findMany({
			where: { userId, book: MATTHEW },
			select: { chapter: true, correct: true, total: true },
			take: 5000,
		}),
		prisma.readingLogChapter.findMany({
			where: { userId, book: MATTHEW },
			select: { book: true, chapter: true, entries: true, chapterReadings: true },
			take: 28,
		}),
		getKjvBook(MATTHEW),
	]);

	const byChapter = new Map<number, QuizScore[]>();
	for (const attempt of attempts) byChapter.set(attempt.chapter, [...(byChapter.get(attempt.chapter) ?? []), attempt]);
	const quizzes: Record<number, QuizScore> = {};
	for (const [chapter, list] of byChapter) {
		const best = bestQuiz(list);
		if (best) quizzes[chapter] = { correct: best.correct, total: best.total };
	}

	const read: Record<number, ChapterRead> = {};
	const coverage = foldBookCoverage(readRows).find((entry) => entry.book === MATTHEW);
	for (const chapter of coverage?.started ?? []) read[chapter] = "started";
	for (const chapter of coverage?.complete ?? []) read[chapter] = "complete";

	const chapters = chapterStandings(
		CHAPTER_GAMES.filter((game) => game.book === MATTHEW),
		{ awards, quizzes, read },
	);
	return {
		chapters,
		trophies: trophyStandings(MATTHEW_TROPHIES, chapters).map((standing) => ({
			...standing,
			verseText: book[standing.trophy.verse[0] - 1]?.[standing.trophy.verse[1] - 1] ?? "",
		})),
		scorecard: roomScorecard(chapters),
	};
}

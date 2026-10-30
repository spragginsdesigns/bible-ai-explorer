/**
 * The Awards Room (LC-17906, docs/beta/games.md): what a founder has
 * accomplished in Matthew, folded from what SureWord already records. A
 * chapter has three parts: read it whole (the reading log), win its chapter
 * game (the game's award) and take its quiz (`QuizAttempt`). A chapter is
 * complete when all three are done; a trophy is earned when every chapter in
 * its passage is complete; the grade is the average of the founder's best
 * game scores and best quiz scores.
 * Type imports only on purpose: the tests load it with Node's type stripping.
 */
import type { ChapterGame, GameAward, GameGrade } from "./games-rules";

/** Where the room is: Bible → Chapter Games → Awards Room. */
export const AWARDS_ROOM_HREF = "/beta/bible/games/awards";

/** The reading log's view of a chapter (`foldBookCoverage`): read whole once, some of it, or not at all. */
export type ChapterRead = "complete" | "started" | null;

export interface QuizScore {
	correct: number;
	total: number;
}

export interface ChapterStanding {
	chapter: number;
	game: ChapterGame;
	read: ChapterRead;
	award: GameAward | null;
	/** The founder's best quiz on the chapter, or null before one is finished. */
	quiz: QuizScore | null;
	/** How many of read, game and quiz are done (0-3). */
	parts: number;
	complete: boolean;
}

export interface Trophy {
	slug: string;
	title: string;
	/** The chapters it covers, first and last. */
	chapters: readonly [number, number];
	/** The KJV verse it carries, as chapter and verse; the page reads the text from the bundled KJV. */
	verse: readonly [number, number];
}

/** Matthew in seven passages, each with a verse from it, and the whole book last. */
export const MATTHEW_TROPHIES: readonly Trophy[] = [
	{ slug: "follow-me", title: "Follow Me", chapters: [1, 4], verse: [4, 19] },
	{ slug: "sermon-on-the-mount", title: "The Sermon on the Mount", chapters: [5, 7], verse: [5, 16] },
	{ slug: "what-manner-of-man", title: "What Manner of Man", chapters: [8, 12], verse: [8, 27] },
	{ slug: "thou-art-the-christ", title: "Thou Art the Christ", chapters: [13, 18], verse: [16, 16] },
	{ slug: "my-words-shall-not-pass", title: "My Words Shall Not Pass Away", chapters: [19, 25], verse: [24, 35] },
	{ slug: "he-is-risen", title: "He Is Risen", chapters: [26, 28], verse: [28, 6] },
	{ slug: "gospel-of-matthew", title: "The Gospel of Matthew", chapters: [1, 28], verse: [28, 20] },
];

export interface TrophyStanding {
	trophy: Trophy;
	/** Complete chapters in its passage, and how many it has. */
	done: number;
	of: number;
	earned: boolean;
}

export interface RoomScorecard {
	chapters: number;
	complete: number;
	read: number;
	medals: Record<GameGrade, number>;
	quizzes: number;
	/** The average of the best quiz scores, 0-100, or null before any quiz. */
	quizAverage: number | null;
	/** The average of every best game score and best quiz score, 0-100, or null before either. */
	score: number | null;
	grade: string | null;
}

/** A quiz's share right, 0-100; an empty quiz counts as nothing. */
export function quizPercent(quiz: QuizScore): number {
	return quiz.total > 0 ? Math.round((Math.min(quiz.correct, quiz.total) / quiz.total) * 100) : 0;
}

/** The best of a chapter's quiz attempts by share right, or null when there are none. */
export function bestQuiz(attempts: readonly QuizScore[]): QuizScore | null {
	let best: QuizScore | null = null;
	for (const attempt of attempts) {
		if (!(attempt.total > 0)) continue;
		if (!best || quizPercent(attempt) > quizPercent(best)) best = attempt;
	}
	return best;
}

/** One standing per game, in the registry's chapter order. */
export function chapterStandings(
	games: readonly ChapterGame[],
	input: {
		awards: Readonly<Record<string, GameAward>>;
		quizzes: Readonly<Record<number, QuizScore>>;
		read: Readonly<Record<number, ChapterRead>>;
	},
): ChapterStanding[] {
	return [...games]
		.sort((a, b) => a.chapter - b.chapter)
		.map((game) => {
			const award = input.awards[game.slug] ?? null;
			const quiz = input.quizzes[game.chapter] ?? null;
			const read = input.read[game.chapter] ?? null;
			const parts = (read === "complete" ? 1 : 0) + (award ? 1 : 0) + (quiz ? 1 : 0);
			return { chapter: game.chapter, game, read, award, quiz, parts, complete: parts === 3 };
		});
}

export function trophyStandings(trophies: readonly Trophy[], chapters: readonly ChapterStanding[]): TrophyStanding[] {
	return trophies.map((trophy) => {
		const [first, last] = trophy.chapters;
		const inside = chapters.filter((standing) => standing.chapter >= first && standing.chapter <= last);
		const of = last - first + 1;
		const done = inside.filter((standing) => standing.complete).length;
		return { trophy, done, of, earned: done === of };
	});
}

/** The usual school scale, A+ at 97 down to F under 60. */
export function letterGrade(score: number): string {
	const scale: [number, string][] = [
		[97, "A+"], [93, "A"], [90, "A-"], [87, "B+"], [83, "B"], [80, "B-"],
		[77, "C+"], [73, "C"], [70, "C-"], [67, "D+"], [63, "D"], [60, "D-"],
	];
	return scale.find(([floor]) => score >= floor)?.[1] ?? "F";
}

export function roomScorecard(chapters: readonly ChapterStanding[]): RoomScorecard {
	const medals: Record<GameGrade, number> = { gold: 0, silver: 0, bronze: 0 };
	const quizScores: number[] = [];
	const scores: number[] = [];
	for (const standing of chapters) {
		if (standing.award) {
			medals[standing.award.grade] += 1;
			scores.push(Math.max(0, Math.min(100, standing.award.bestFaith)));
		}
		if (standing.quiz) {
			quizScores.push(quizPercent(standing.quiz));
			scores.push(quizPercent(standing.quiz));
		}
	}
	const average = (values: number[]) => (values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null);
	const score = average(scores);
	return {
		chapters: chapters.length,
		complete: chapters.filter((standing) => standing.complete).length,
		read: chapters.filter((standing) => standing.read === "complete").length,
		medals,
		quizzes: quizScores.length,
		quizAverage: average(quizScores),
		score,
		grade: score === null ? null : letterGrade(score),
	};
}

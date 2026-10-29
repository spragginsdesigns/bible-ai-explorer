/**
 * Chapter Games (LC-17850, docs/beta/games.md): the chapters of the Bible that
 * have a game, and the award a finished game earns. No imports on purpose: the
 * reader (a client component), the server and the tests all load it, the
 * tests with Node's type stripping.
 */

export type GameGrade = "gold" | "silver" | "bronze";

export interface ChapterGame {
	/** URL segment: /beta/bible/games/<slug>. */
	slug: string;
	title: string;
	tagline: string;
	/** Canonical book order (Matthew is 40), chapter, and the verses the game plays. */
	book: number;
	chapter: number;
	verses: readonly [number, number];
	/** "Matthew 14:22-33". */
	reference: string;
	/** What finishing it earns. */
	award: string;
	/** The award's three grades, named from the passage. */
	grades: Record<GameGrade, string>;
}

export const CHAPTER_GAMES: readonly ChapterGame[] = [
	{
		slug: "water-walk",
		title: "Peter's Water Walk",
		tagline: "Step out of the ship and walk the storm to Jesus",
		book: 40,
		chapter: 14,
		verses: [22, 33],
		reference: "Matthew 14:22-33",
		award: "Walked on the Water",
		grades: { gold: "Eyes on Jesus", silver: "Of Good Cheer", bronze: "Be Not Afraid" },
	},
];

export function findChapterGame(slug: string): ChapterGame | null {
	return CHAPTER_GAMES.find((game) => game.slug === slug) ?? null;
}

export function chapterGameFor(book: number, chapter: number): ChapterGame | null {
	return CHAPTER_GAMES.find((game) => game.book === book && game.chapter === chapter) ?? null;
}

export function gameHref(game: Pick<ChapterGame, "slug">): string {
	return `/beta/bible/games/${game.slug}`;
}

/** The lowest faith of the walk decides the grade. */
export function gradeFor(faithKept: number): GameGrade {
	return faithKept >= 70 ? "gold" : faithKept >= 40 ? "silver" : "bronze";
}

const GRADE_RANK: Record<GameGrade, number> = { gold: 3, silver: 2, bronze: 1 };

export function betterGrade(a: GameGrade, b: GameGrade): GameGrade {
	return GRADE_RANK[a] >= GRADE_RANK[b] ? a : b;
}

/** A finished game as the client reports it. */
export interface GameRun {
	faithKept: number;
	seconds: number;
	swellsCleared: number;
}

/**
 * Checks a reported run. `minSeconds` is the soonest the game can be finished
 * flat out, so a faster time was not played.
 */
export function checkGameRun(input: unknown, minSeconds: number): { ok: true; value: GameRun } | { ok: false; error: string } {
	if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "expected a run" };
	const { faithKept, seconds, swellsCleared } = input as Record<string, unknown>;
	if (typeof faithKept !== "number" || !Number.isInteger(faithKept) || faithKept < 0 || faithKept > 100) {
		return { ok: false, error: "faithKept must be a whole number from 0 to 100" };
	}
	if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < minSeconds || seconds > 3600) {
		return { ok: false, error: `seconds must be between ${minSeconds} and 3600` };
	}
	if (typeof swellsCleared !== "number" || !Number.isInteger(swellsCleared) || swellsCleared < 0 || swellsCleared > 500) {
		return { ok: false, error: "swellsCleared must be a whole number from 0 to 500" };
	}
	return { ok: true, value: { faithKept, seconds: Math.round(seconds * 10) / 10, swellsCleared } };
}

/** The award as it is kept in the study store's `data`. */
export interface GameAward {
	game: string;
	grade: GameGrade;
	bestFaith: number;
	bestSeconds: number;
	completions: number;
	firstAt: string;
	lastAt: string;
}

/** Reads a stored award back, or null when `data` is not one for `game`. */
export function readGameAward(data: unknown, game: string): GameAward | null {
	if (!data || typeof data !== "object" || Array.isArray(data)) return null;
	const award = data as Record<string, unknown>;
	if (award.game !== game) return null;
	if (award.grade !== "gold" && award.grade !== "silver" && award.grade !== "bronze") return null;
	const numbers = [award.bestFaith, award.bestSeconds, award.completions];
	if (!numbers.every((value) => typeof value === "number" && Number.isFinite(value))) return null;
	if (typeof award.firstAt !== "string" || typeof award.lastAt !== "string") return null;
	return {
		game,
		grade: award.grade,
		bestFaith: award.bestFaith as number,
		bestSeconds: award.bestSeconds as number,
		completions: award.completions as number,
		firstAt: award.firstAt,
		lastAt: award.lastAt,
	};
}

/** Folds a finished run into the award: the best grade, faith and time stand, completions count up. */
export function mergeGameAward(previous: GameAward | null, game: string, run: GameRun, at: string): GameAward {
	const grade = gradeFor(run.faithKept);
	if (!previous) {
		return { game, grade, bestFaith: run.faithKept, bestSeconds: run.seconds, completions: 1, firstAt: at, lastAt: at };
	}
	return {
		game,
		grade: betterGrade(previous.grade, grade),
		bestFaith: Math.max(previous.bestFaith, run.faithKept),
		bestSeconds: Math.min(previous.bestSeconds, run.seconds),
		completions: previous.completions + 1,
		firstAt: previous.firstAt,
		lastAt: at,
	};
}

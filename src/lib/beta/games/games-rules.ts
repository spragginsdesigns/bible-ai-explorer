/**
 * Chapter Games (LC-17850, docs/beta/games.md): the chapters of the Bible that
 * have a game, and the award a finished game earns. A passage can be played
 * more than one way (LC-17851): each way is its own game with its own slug and
 * award item, and the ways of one passage share its award name and grades. No
 * imports on purpose: the reader (a client component), the server and the
 * tests all load it, the tests with Node's type stripping.
 */

export type GameGrade = "gold" | "silver" | "bronze";

export interface ChapterGame {
	/** URL segment: /beta/bible/games/<slug>. */
	slug: string;
	title: string;
	tagline: string;
	/** How this way of playing the passage plays, told apart from its siblings ("Arcade"). */
	style: string;
	/** Canonical book order (Matthew is 40), chapter, and the verses the game plays. */
	book: number;
	chapter: number;
	verses: readonly [number, number];
	/** "Matthew 14:22-33". */
	reference: string;
	/** The passage's story in a few words, shared by every way to play it ("Peter walks on the water"). */
	story: string;
	/** What finishing it earns. */
	award: string;
	/** The award's three grades, named from the passage. */
	grades: Record<GameGrade, string>;
	/** What the run's 0-100 score (`faithKept`) measures, in lower case ("faith kept"). */
	measure: string;
	/** The medal's mark, from the passage. */
	emblem: GameEmblem;
	/** The award item's study-store topics. */
	topics: readonly string[];
}

export type GameEmblem = "wave" | "star";

const WATER_WALK = {
	book: 40,
	chapter: 14,
	verses: [22, 33] as const,
	reference: "Matthew 14:22-33",
	story: "Peter walks on the water",
	award: "Walked on the Water",
	grades: { gold: "Eyes on Jesus", silver: "Of Good Cheer", bronze: "Be Not Afraid" },
	measure: "faith kept",
	emblem: "wave",
	topics: ["chapter game", "faith"],
} as const;

const WISE_MEN = {
	book: 40,
	chapter: 2,
	verses: [1, 12] as const,
	reference: "Matthew 2:1-12",
	story: "The wise men follow the star",
	award: "Come to Worship Him",
	grades: { gold: "Exceeding Great Joy", silver: "The Star Went Before Them", bronze: "We Have Seen His Star" },
	measure: "kept to the star",
	emblem: "star",
	topics: ["chapter game", "worship"],
} as const;

export const CHAPTER_GAMES: readonly ChapterGame[] = [
	{
		...WATER_WALK,
		slug: "water-walk",
		title: "Peter's Water Walk",
		tagline: "Step out of the ship and walk the storm to Jesus",
		style: "The storm, side on",
	},
	{
		...WATER_WALK,
		slug: "through-the-storm",
		title: "Through the Storm",
		tagline: "See the storm through Peter's eyes, and keep them on Jesus",
		style: "First person",
	},
	{
		...WATER_WALK,
		slug: "crest-hopper",
		title: "Crest Hopper",
		tagline: "Hop the swells to Jesus, arcade style",
		style: "Arcade",
	},
	{
		...WISE_MEN,
		slug: "follow-the-star",
		title: "Follow the Star",
		tagline: "Steer by the star through the night to the young child",
		style: "Night sky",
	},
	{
		...WISE_MEN,
		slug: "the-caravan",
		title: "The Caravan",
		tagline: "Lead the wise men from the east to Bethlehem",
		style: "Side-scroller",
	},
	{
		...WISE_MEN,
		slug: "star-chart",
		title: "Star Chart",
		tagline: "Chart the way from the east to where the star stood",
		style: "Puzzle",
	},
];

export function findChapterGame(slug: string): ChapterGame | null {
	return CHAPTER_GAMES.find((game) => game.slug === slug) ?? null;
}

/** Every way to play a chapter, in the registry's order; empty when it has no game. */
export function chapterGamesFor(book: number, chapter: number): ChapterGame[] {
	return CHAPTER_GAMES.filter((game) => game.book === book && game.chapter === chapter);
}

/** The registry's games grouped by chapter, each group in the registry's order. */
export function chapterGameGroups(): ChapterGame[][] {
	const groups = new Map<string, ChapterGame[]>();
	for (const game of CHAPTER_GAMES) {
		const key = `${game.book}.${game.chapter}`;
		groups.set(key, [...(groups.get(key) ?? []), game]);
	}
	return [...groups.values()];
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

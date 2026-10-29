import type { ChapterGame, GameAward } from "@/lib/beta/games/games-rules";

/** A verse of the passage a game plays, read from the bundled KJV by the game's page. */
export interface GameVerse {
	verse: number;
	text: string;
}

/** What the game page hands every chapter game (docs/beta/games.md). */
export interface ChapterGameProps {
	game: ChapterGame;
	verses: readonly GameVerse[];
	initialAward: GameAward | null;
}

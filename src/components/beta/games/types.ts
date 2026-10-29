import type { ChapterGame, GameAward } from "@/lib/beta/games/games-rules";

/** A verse of the passage a game plays, read from the bundled KJV. */
export interface GameVerse {
	verse: number;
	text: string;
}

/** What the player (ChapterGamePlayer) is handed: the game and the founder's award so far. */
export interface ChapterGameProps {
	game: ChapterGame;
	initialAward: GameAward | null;
	/** Closes the game, where the page offers a way back (the reader card). */
	onClose?: () => void;
}

/**
 * The keyboard as the player hands it to a stage: what is held now and what
 * was pressed since the stage last took the presses. Keys are
 * `KeyboardEvent.key` in lower case, with " " for Space ("arrowleft", "a",
 * "1"). Only keys pressed while the game has focus arrive, and the page never
 * scrolls on them.
 */
export interface StageKeys {
	held: Set<string>;
	presses: string[];
}

/** How a round ended. */
export interface StageResult {
	won: boolean;
	/** 0-100, what the game's `measure` names; it sets the award's grade (70 gold, 40 silver). */
	score: number;
	/** The game's count of what it cleared (fish caught, stones laid), 0-500. */
	count: number;
	/** Seconds the round ran, from the simulation's own clock. */
	seconds: number;
}

/**
 * What the player hands each game's stage (docs/beta/games.md, "A game's
 * stage"). The player owns the start screen, the countdown, the timer bar,
 * pausing, the outcome, the award and the voice; the stage owns its picture,
 * its input and its rules, and calls `onEnd` once.
 */
export interface StageProps {
	game: ChapterGame;
	/** A new seed every round. */
	seed: number;
	/** True on the countdown and while paused: draw, but do not advance. */
	paused: boolean;
	muted: boolean;
	reducedMotion: boolean;
	keys: StageKeys;
	/** Seconds left in the round, for the timer bar; call it as the clock runs (cheap, no re-render). */
	onTime: (secondsLeft: number) => void;
	/** The round is over. Call once. */
	onEnd: (result: StageResult) => void;
}

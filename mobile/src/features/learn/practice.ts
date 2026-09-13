/**
 * Practice modes for Learn: four ways the same verse can come back.
 *
 * The ladder in learn.ts decides how well a verse is known. This module decides
 * how that verse is practiced today, so a card met a second time is a different
 * exercise rather than the same blanks again. Nothing here reaches the server:
 * the mode is chosen from the card already on screen and the review still sends
 * "again" or "good" exactly as before.
 *
 * Like suggestions.ts this module imports nothing, so both clients and both test
 * runners load it directly. Fill the blanks keeps using verseWords/maskVerse in
 * learn.ts; the other three modes need a word's parts, which verseTokens gives.
 */

export type LearnMode = "blanks" | "letters" | "order" | "typed";

/** Switcher order: the same four modes, in the same places, on every client. */
export const LEARN_MODES: readonly LearnMode[] = ["blanks", "letters", "order", "typed"];

export const LEARN_MODE_LABELS: Readonly<Record<LearnMode, string>> = {
	blanks: "Fill the blanks",
	letters: "First letters",
	order: "Tap the next word",
	typed: "Type it out",
};

/** Enough for the card to be identified and staged; LearnCard satisfies it. */
export interface LearnModeCard {
	id: string;
	revision: number;
	stage: number;
}

export function isLearnMode(value: unknown): value is LearnMode {
	return typeof value === "string" && (LEARN_MODES as readonly string[]).includes(value);
}

/** One sentence naming the job. Fill the blanks keeps the ladder's existing wording. */
export function learnModeHint(mode: LearnMode, stage: number): string {
	switch (mode) {
		case "letters":
			return "Say the verse from its first letters. Tap a word to see it.";
		case "order":
			return "Tap the words in the order they are written. A wrong tap shows the right word.";
		case "typed":
			return "Type the verse, then check it. Capitals and punctuation do not count.";
		default:
			return stage === 0
				? "Read the verse, then continue."
				: stage === 3
					? "Say the verse from its reference. Tap a blank for help."
					: "Recall the missing words. Tap a blank for help, then continue.";
	}
}

export interface VerseToken {
	/** The word as written, punctuation included. */
	text: string;
	/** Punctuation before the first letter, such as an opening quote. */
	prefix: string;
	/** The word itself. */
	core: string;
	/** Punctuation after the last letter, such as a comma. */
	suffix: string;
}

/** Whitespace defines a word, the same rule maskVerse follows. */
export function verseTokens(text: string): VerseToken[] {
	return text.trim().split(/\s+/).filter(Boolean).map((word) => {
		const prefix = word.match(/^[^\p{L}\p{N}]+/u)?.[0] ?? "";
		const rest = word.slice(prefix.length);
		const suffix = rest.match(/[^\p{L}\p{N}]+$/u)?.[0] ?? "";
		return { text: word, prefix, core: rest.slice(0, rest.length - suffix.length), suffix };
	});
}

/**
 * How two words are compared everywhere in this module: capitals, punctuation
 * and hyphenation are how a verse is printed, not what it says. A translation's
 * own spelling is never normalized away, so "believeth" still has to be
 * "believeth".
 */
export function normalizeWord(word: string): string {
	return word.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Escapes, not the characters: tooling on this repo flattens hyphen-like code points. */
const HYPHEN = /([-\u2010\u2011])/;

export interface LetterWord {
	/** The word as written, shown once it is revealed. */
	text: string;
	/** First letters only: "well-beloved," becomes "w-b,". */
	clue: string;
}

/** Every word collapses to its first letter; punctuation and hyphens stay put. */
export function firstLetterWords(text: string): LetterWord[] {
	return verseTokens(text).map((token) => {
		const clue = token.core.split(HYPHEN).map((part, index) =>
			index % 2 === 1 ? part : part.match(/[\p{L}\p{N}]/u)?.[0] ?? "",
		).join("");
		return { text: token.text, clue: `${token.prefix}${clue}${token.suffix}` };
	});
}

/**
 * A long verse is practiced a part at a time. Past two dozen tiles the round
 * stops being recall and becomes a search, so the seed walks the parts and a
 * verse returning later opens at its next part.
 */
export const LEARN_ORDER_WORD_CAP = 24;

export interface OrderRound {
	/** The words to tap, in the order they are written. */
	answer: string[];
	/** The same words, shuffled, as they are offered. */
	choices: string[];
	/** The verse is longer than the cap, so this round covers one part of it. */
	partial: boolean;
	/** Where this part starts in the verse; 0 unless the verse is long. */
	start: number;
}

function safeSeed(seed: number): number {
	return Number.isFinite(seed) ? Math.abs(Math.trunc(seed)) : 0;
}

function randomizer(seed: number): () => number {
	let state = (safeSeed(seed) + 0x6d2b79f5) >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let value = Math.imul(state ^ (state >>> 15), 1 | state);
		value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
	};
}

function shuffle(words: readonly string[], seed: number): string[] {
	const next = randomizer(seed);
	const shuffled = [...words];
	for (let index = shuffled.length - 1; index > 0; index -= 1) {
		const target = Math.floor(next() * (index + 1));
		const held = shuffled[index];
		shuffled[index] = shuffled[target];
		shuffled[target] = held;
	}
	// Offering the verse already in order is not a round.
	if (shuffled.length > 1 && shuffled.every((word, index) => word === words[index])) {
		return [...shuffled.slice(1), shuffled[0]];
	}
	return shuffled;
}

export function orderRound(text: string, seed: number): OrderRound {
	const words = verseTokens(text).map((token) => token.text);
	const parts = Math.max(1, Math.ceil(words.length / LEARN_ORDER_WORD_CAP));
	// Even parts, so a verse one word over the cap does not end in a round of one.
	const size = Math.max(1, Math.ceil(words.length / parts));
	const start = (safeSeed(seed) % parts) * size;
	const answer = words.slice(start, start + size);
	return { answer, choices: shuffle(answer, seed), partial: parts > 1, start };
}

export interface OrderTap {
	/** The tapped word was the next one in the verse. */
	correct: boolean;
	/** Choice positions placed so far, in the order the verse is written. */
	placed: number[];
	/** After a wrong tap, the choice that was expected, so it can be shown. */
	expected: number | null;
	/** Every word of this part is placed. */
	done: boolean;
}

/** A wrong tap shows the word that belongs next and leaves the round standing. */
export function tapOrderWord(round: OrderRound, placed: readonly number[], choice: number): OrderTap {
	const expectedWord = round.answer[placed.length];
	const taken = new Set(placed);
	const correct = expectedWord !== undefined && !taken.has(choice) &&
		normalizeWord(round.choices[choice] ?? "") === normalizeWord(expectedWord);
	const next = correct ? [...placed, choice] : [...placed];
	const expected = correct || expectedWord === undefined
		? -1
		: round.choices.findIndex((word, index) =>
			!taken.has(index) && normalizeWord(word) === normalizeWord(expectedWord));
	return {
		correct,
		placed: next,
		expected: expected < 0 ? null : expected,
		done: next.length === round.answer.length && round.answer.length > 0,
	};
}

export type TypedWordResult = "match" | "missed" | "extra";

export interface TypedWord {
	result: TypedWordResult;
	/** The verse's word, or null for a word that is not in the verse. */
	expected: string | null;
	/** What the reader typed, or null for a word they left out. */
	typed: string | null;
}

export interface TypedScore {
	/** The verse and what was typed, aligned, so a missed word is named where it belongs. */
	words: TypedWord[];
	/** Every word of the verse was typed, and nothing else was. */
	perfect: boolean;
	/** Nothing has been typed yet. */
	empty: boolean;
}

/** Hyphens separate words here so "wellbeloved" and "well beloved" both land. */
function comparableWords(text: string): string[] {
	return text.split(/[\s\u2010\u2011-]+/).filter((word) => normalizeWord(word).length > 0);
}

/**
 * Word by word against the verse, aligned by longest common subsequence so one
 * missing word does not mark every word after it wrong.
 */
export function scoreTypedVerse(text: string, typed: string): TypedScore {
	const expected = comparableWords(text);
	const written = comparableWords(typed);
	const expectedKeys = expected.map(normalizeWord);
	const writtenKeys = written.map(normalizeWord);
	const table: number[][] = Array.from(
		{ length: expected.length + 1 },
		() => new Array<number>(written.length + 1).fill(0),
	);
	for (let row = expected.length - 1; row >= 0; row -= 1) {
		for (let column = written.length - 1; column >= 0; column -= 1) {
			table[row][column] = expectedKeys[row] === writtenKeys[column]
				? table[row + 1][column + 1] + 1
				: Math.max(table[row + 1][column], table[row][column + 1]);
		}
	}
	const words: TypedWord[] = [];
	let row = 0;
	let column = 0;
	while (row < expected.length && column < written.length) {
		if (expectedKeys[row] === writtenKeys[column]) {
			words.push({ result: "match", expected: expected[row], typed: written[column] });
			row += 1;
			column += 1;
		} else if (table[row + 1][column] >= table[row][column + 1]) {
			words.push({ result: "missed", expected: expected[row], typed: null });
			row += 1;
		} else {
			words.push({ result: "extra", expected: null, typed: written[column] });
			column += 1;
		}
	}
	for (; row < expected.length; row += 1) {
		words.push({ result: "missed", expected: expected[row], typed: null });
	}
	for (; column < written.length; column += 1) {
		words.push({ result: "extra", expected: null, typed: written[column] });
	}
	return {
		words,
		perfect: expected.length > 0 && words.every((word) => word.result === "match"),
		empty: written.length === 0,
	};
}

function cardSeed(id: string): number {
	let seed = 0;
	for (let index = 0; index < id.length; index += 1) {
		seed = (Math.imul(seed, 31) + id.charCodeAt(index)) | 0;
	}
	return Math.abs(seed);
}

/**
 * How well a verse is known picks the mode. A verse being met opens in blanks;
 * one being recalled alternates the two recall modes, so it rarely returns the
 * same way twice; one that is nearly known is written out.
 */
export function defaultLearnMode(card: LearnModeCard): LearnMode {
	if (card.stage === 3) return "typed";
	if (card.stage !== 2) return "blanks";
	return (cardSeed(card.id) + safeSeed(card.revision)) % 2 === 0 ? "letters" : "order";
}

export interface LearnModeSelection {
	cardId: string;
	revision: number;
	mode: LearnMode;
	/** The reader picked this mode by hand for this card. */
	chosen: boolean;
}

/**
 * A hand-picked mode lasts as long as the card in front of the reader. A review
 * moves the card on, and the next stage brings its own default. Nothing here is
 * sent to the server, and nothing here touches the card.
 */
export function resolveLearnMode(
	card: LearnModeCard,
	previous: LearnModeSelection | null | undefined,
): LearnModeSelection {
	if (previous?.chosen && previous.cardId === card.id && previous.revision === card.revision) {
		return previous;
	}
	return { cardId: card.id, revision: card.revision, mode: defaultLearnMode(card), chosen: false };
}

export function chooseLearnMode(card: LearnModeCard, mode: LearnMode): LearnModeSelection {
	return { cardId: card.id, revision: card.revision, mode, chosen: true };
}

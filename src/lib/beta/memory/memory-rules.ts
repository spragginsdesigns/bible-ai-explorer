/**
 * Pure rules for Scripture Memory (LC-17651, docs/beta/memory.md), the beta's
 * richer practice over Learn a verse.
 *
 * The cards and the schedule are Learn a verse's own (`VerseMemory`,
 * `src/lib/learn-schedule.ts`): this file never decides when a verse comes
 * back. It decides how a verse is practised (which exercise, which word is
 * blanked, which wrong answers are offered), how an answer is graded into the
 * "again" or "good" Learn already understands, how verses group into the
 * passages the founder learns together, and which verses from their own study
 * are offered as new cards.
 *
 * No imports on purpose: `tests/beta-memory.test.mjs` loads this file with
 * Node's type stripping, which cannot resolve `@/` paths.
 */

/** The longest passage learned as one card: Ephesians 2:8-9 fits, a chapter does not. */
export const MEMORY_PASSAGE_MAX_VERSES = 6;

/** Units in one review session, like the concept board's "1/10". */
export const MEMORY_SESSION_LIMIT = 10;

/** Suggestions offered per source in "Make cards from my study". */
export const MEMORY_CANDIDATES_PER_SOURCE = 8;

export type MemoryExercise = "choice" | "blank" | "letters" | "typed" | "question";

/** Switcher order, easiest recall first. */
export const MEMORY_EXERCISES: readonly MemoryExercise[] = ["choice", "blank", "letters", "typed", "question"];

export const MEMORY_EXERCISE_LABELS: Readonly<Record<MemoryExercise, string>> = {
	choice: "Multiple choice",
	blank: "Fill in the blank",
	letters: "First letters",
	typed: "Type the whole verse",
	question: "Comprehension",
};

/* ------------------------------------------------------------------------ */
/* Passages                                                                  */
/* ------------------------------------------------------------------------ */

export interface PassageRange {
	/** Canonical book order, 1-66. */
	book: number;
	chapter: number;
	start: number;
	end: number;
}

/**
 * The verse span at the end of a reference: "Ephesians 2:8-9" is 8 to 9,
 * "John 3:16" is 16 to 16. A span across chapters ("John 3:16-4:2"), a
 * reversed one, or one longer than a memory passage is not a card.
 */
export function parseVerseSpan(reference: string): { start: number; end: number } | null {
	const colon = reference.indexOf(":");
	if (colon < 0) return null;
	// Everything after the first colon, so "John 3:16-4:2" cannot pass as 4:2.
	const match = /^\s*(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?\s*$/.exec(reference.slice(colon + 1));
	if (!match) return null;
	const start = Number(match[1]);
	const end = match[2] === undefined ? start : Number(match[2]);
	if (start < 1 || end < start || end - start + 1 > MEMORY_PASSAGE_MAX_VERSES) return null;
	return { start, end };
}

export function rangeLength(range: Pick<PassageRange, "start" | "end">): number {
	return range.end - range.start + 1;
}

/** "Ephesians 2:8-9" or "John 3:16", from the book's display name. */
export function rangeReference(bookName: string, range: Pick<PassageRange, "chapter" | "start" | "end">): string {
	const tail = range.start === range.end ? `${range.start}` : `${range.start}-${range.end}`;
	return `${bookName} ${range.chapter}:${tail}`;
}

/** A stable key for a unit: "49.2.8-9" or "43.3.16". */
export function rangeKey(range: PassageRange): string {
	const base = `${range.book}.${range.chapter}.${range.start}`;
	return range.start === range.end ? base : `${base}-${range.end}`;
}

export function rangesOverlap(a: PassageRange, b: PassageRange): boolean {
	return a.book === b.book && a.chapter === b.chapter && a.start <= b.end && b.start <= a.end;
}

/**
 * Adding a passage that overlaps ones already saved joins them, so a verse
 * belongs to one passage at most and is never practised twice in a session.
 * Null when the joined passage would be longer than a memory passage.
 */
export function joinRanges(range: PassageRange, existing: readonly PassageRange[]): PassageRange | null {
	let start = range.start;
	let end = range.end;
	for (const other of existing) {
		if (!rangesOverlap(range, other)) continue;
		start = Math.min(start, other.start);
		end = Math.max(end, other.end);
	}
	const joined = { book: range.book, chapter: range.chapter, start, end };
	return rangeLength(joined) > MEMORY_PASSAGE_MAX_VERSES ? null : joined;
}

/**
 * Consecutive verses of one chapter, in order, as passages of at most
 * `max` verses. Highlighting Ephesians 2:8 and 2:9 is one passage.
 */
export function groupConsecutiveVerses<T extends { book: number; chapter: number; verse: number }>(
	verses: readonly T[],
	max = MEMORY_PASSAGE_MAX_VERSES,
): { range: PassageRange; members: T[] }[] {
	const sorted = [...verses].sort((a, b) => a.book - b.book || a.chapter - b.chapter || a.verse - b.verse);
	const groups: { range: PassageRange; members: T[] }[] = [];
	for (const verse of sorted) {
		const last = groups.at(-1);
		if (
			last &&
			last.range.book === verse.book &&
			last.range.chapter === verse.chapter &&
			verse.verse <= last.range.end + 1 &&
			(verse.verse === last.range.end || rangeLength(last.range) < max)
		) {
			if (verse.verse > last.range.end) last.range.end = verse.verse;
			last.members.push(verse);
			continue;
		}
		groups.push({
			range: { book: verse.book, chapter: verse.chapter, start: verse.verse, end: verse.verse },
			members: [verse],
		});
	}
	return groups;
}

/* ------------------------------------------------------------------------ */
/* Units: what one exercise practises                                        */
/* ------------------------------------------------------------------------ */

/** The schedule fields of one Learn a verse card, as the server returns them. */
export interface MemoryCardState {
	id: string;
	revision: number;
	book: number;
	chapter: number;
	verse: number;
	stage: number;
	intervalDays: number;
	/** ISO instant: midnight of the day it comes back, in the user's zone. */
	dueAt: string;
	knownAt: string | null;
}

export interface MemoryPassageRecord extends PassageRange {
	id: string;
}

export interface MemoryUnitPlan<T extends MemoryCardState = MemoryCardState> {
	range: PassageRange;
	/** The cards of the unit in verse order. */
	cards: T[];
	/** The saved passage this unit is, or null for a single verse. */
	passageId: string | null;
}

/**
 * Split a deck into units. A saved passage whose cards are all present is one
 * unit; if one of its verses was removed in Learn a verse, what is left falls
 * back to consecutive runs, so a unit is always continuous text. Every card
 * lands in exactly one unit.
 */
export function planUnits<T extends MemoryCardState>(
	cards: readonly T[],
	passages: readonly MemoryPassageRecord[],
): MemoryUnitPlan<T>[] {
	const byVerse = new Map(cards.map((card) => [`${card.book}.${card.chapter}.${card.verse}`, card]));
	const used = new Set<string>();
	const units: MemoryUnitPlan<T>[] = [];
	const ordered = [...passages].sort((a, b) => a.book - b.book || a.chapter - b.chapter || a.start - b.start);
	for (const passage of ordered) {
		const present: T[] = [];
		for (let verse = passage.start; verse <= passage.end; verse += 1) {
			const card = byVerse.get(`${passage.book}.${passage.chapter}.${verse}`);
			if (card && !used.has(card.id)) present.push(card);
		}
		if (present.length < 2) continue;
		for (const group of groupConsecutiveVerses(present)) {
			if (group.members.length < 2) continue;
			for (const card of group.members) used.add(card.id);
			const whole = group.range.start === passage.start && group.range.end === passage.end;
			units.push({ range: group.range, cards: group.members, passageId: whole ? passage.id : null });
		}
	}
	for (const card of cards) {
		if (used.has(card.id)) continue;
		units.push({
			range: { book: card.book, chapter: card.chapter, start: card.verse, end: card.verse },
			cards: [card],
			passageId: null,
		});
	}
	return units.sort(
		(a, b) => a.range.book - b.range.book || a.range.chapter - b.range.chapter || a.range.start - b.range.start,
	);
}

export type MemoryStatus = "due" | "learning" | "known";

/**
 * Where a card stands. "Due" wins (it needs you today); otherwise a card is
 * known once Learn a verse has set knownAt (the 16-day interval), and learning
 * until then. Known is the same number Learn a verse shows as verses you know.
 */
export function cardStatus(card: Pick<MemoryCardState, "dueAt" | "knownAt">, dueBeforeMs: number): MemoryStatus {
	if (Date.parse(card.dueAt) < dueBeforeMs) return "due";
	return card.knownAt ? "known" : "learning";
}

export function isCardDue(card: Pick<MemoryCardState, "dueAt">, dueBeforeMs: number): boolean {
	return Date.parse(card.dueAt) < dueBeforeMs;
}

/** The unit's place on the ladder: the lowest stage among the cards it reviews. */
export function unitStage(cards: readonly Pick<MemoryCardState, "stage">[]): number {
	if (cards.length === 0) return 0;
	return Math.min(...cards.map((card) => Math.min(Math.max(Math.trunc(card.stage) || 0, 0), 3)));
}

/** Changes with every review, so a verse met again is a different exercise. */
export function unitSeed(cards: readonly Pick<MemoryCardState, "id" | "revision">[]): number {
	let seed = 0;
	for (const card of cards) seed = (Math.imul(seed, 31) + hashText(card.id) + card.revision) | 0;
	return Math.abs(seed);
}

/**
 * The exercise a unit opens with, climbing with the Learn ladder: a new verse
 * is met as multiple choice with the verse in view, stage 1 fills its blanks,
 * stage 2 recalls it from first letters, stage 3 types it from the reference
 * alone. Comprehension questions, when the founder has asked for them, take
 * every other turn at stages 1 and 2.
 */
export function defaultExercise(stage: number, seed: number, hasQuestions: boolean): MemoryExercise {
	if (stage <= 0) return "choice";
	if (stage >= 3) return "typed";
	if (hasQuestions && seed % 2 === 1) return "question";
	return stage === 1 ? "blank" : "letters";
}

/* ------------------------------------------------------------------------ */
/* Words                                                                     */
/* ------------------------------------------------------------------------ */

export interface MemoryToken {
	/** The token as written. */
	text: string;
	prefix: string;
	/** The word without the punctuation around it; empty for punctuation alone. */
	core: string;
	suffix: string;
}

/** Whitespace makes a word, as in Learn a verse's ladder. */
export function memoryTokens(text: string): MemoryToken[] {
	return text
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.map((word) => {
			const prefix = word.match(/^[^\p{L}\p{N}]+/u)?.[0] ?? "";
			const rest = word.slice(prefix.length);
			const suffix = rest.match(/[^\p{L}\p{N}]+$/u)?.[0] ?? "";
			return { text: word, prefix, core: rest.slice(0, rest.length - suffix.length), suffix };
		});
}

/** Capitals and punctuation are how a verse is printed, not what it says. */
export function foldWord(word: string): string {
	return word.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

const ARTICLES = new Set(["a", "an", "the"]);

/** What a comprehension answer says, so "The substance" and "Substance" are one answer asked twice. */
export function answerKey(answer: string): string {
	return answer
		.split(/\s+/)
		.map(foldWord)
		.filter((word) => word && !ARTICLES.has(word))
		.join(" ");
}

/** The letter a first-letters round asks for: "well-beloved" is "w". */
export function firstLetter(word: string): string {
	return foldWord(word).slice(0, 1);
}

/**
 * Words too common to carry a verse, in modern and KJV English. A blank on
 * "the" tests nothing, and "unto" is no plausible wrong answer.
 */
const STOPWORDS = new Set(
	(
		"a an and are as at be been but by did do does for from had has have he her him his how i if in into is it its " +
		"me my no not of on or our she so than that the their them then there these they this those to up us was we " +
		"were what when where which who whom why will with would you your ye thee thou thy thine unto hath doth shall " +
		"must one all any also again upon even more should could may might let lest yet nor said saith through according " +
		"therefore wherefore without within before after because against toward towards among about until neither either " +
		"whether while"
	).split(" "),
);

export function isStopword(word: string): boolean {
	return STOPWORDS.has(foldWord(word));
}

function hashText(text: string): number {
	let hash = 2166136261;
	for (let index = 0; index < text.length; index += 1) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}

/* ------------------------------------------------------------------------ */
/* Multiple choice                                                           */
/* ------------------------------------------------------------------------ */

export interface ChoiceRound {
	tokens: MemoryToken[];
	/** The token blanked in the verse. */
	blankIndex: number;
	/** Four words, the right one at `answerIndex`. */
	options: string[];
	answerIndex: number;
}

/** Common KJV words of each shape, for a passage whose chapter offers too few. */
const FALLBACK_POOL = [
	"faith", "grace", "works", "glory", "mercy", "truth", "peace", "spirit", "heaven", "earth", "light",
	"darkness", "righteousness", "salvation", "wisdom", "kingdom", "commandment", "covenant", "promise",
	"believeth", "loveth", "walketh", "knoweth", "keepeth", "abideth", "saved", "called", "given", "chosen",
	"blessed", "redeemed", "perish", "boast", "rejoice", "forgive", "Lord", "Christ", "Israel", "Moses", "David",
];

function suffixClass(word: string): string {
	const folded = foldWord(word);
	for (const ending of ["eth", "est", "ness", "ing", "ed", "ly", "s"]) {
		if (folded.length > ending.length + 2 && folded.endsWith(ending)) return ending;
	}
	return "";
}

function isCapitalized(word: string): boolean {
	return /^\p{Lu}/u.test(word);
}

/**
 * The words of the chapter around a passage, as candidates for wrong answers.
 * A word that opens a verse or a sentence is lowercased, so "Wherefore" is not
 * mistaken for a name; a capital anywhere else is kept ("God", "Abraham").
 */
export function choicePool(verses: readonly string[], limit = 400): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const verse of verses) {
		let sentenceStart = true;
		for (const token of memoryTokens(verse)) {
			const core = sentenceStart ? token.core.toLowerCase() : token.core;
			sentenceStart = /[.?!:;]$/.test(token.suffix);
			const key = foldWord(core);
			if (!key || seen.has(key)) continue;
			seen.add(key);
			out.push(core);
			if (out.length >= limit) return out;
		}
	}
	return out;
}

/** Which word the choice round blanks: a meaningful word, a different one as the card moves. */
export function choiceBlankIndex(tokens: readonly MemoryToken[], seed: number): number {
	const candidates = tokens
		.map((token, index) => ({ index, core: token.core }))
		.filter(({ core }) => /^\p{L}+$/u.test(core) && core.length >= 4 && !isStopword(core));
	const fallback = tokens
		.map((token, index) => ({ index, core: token.core }))
		.filter(({ core }) => /\p{L}/u.test(core));
	const pool = candidates.length > 0 ? candidates : fallback;
	if (pool.length === 0) return -1;
	// The longer words carry the verse; the seed walks through the top few.
	const ranked = [...pool].sort((a, b) => b.core.length - a.core.length || a.index - b.index);
	const top = ranked.slice(0, Math.min(5, ranked.length));
	return top[Math.abs(seed) % top.length].index;
}

/**
 * Three wrong answers that look like the right one: the same ending (a verb
 * that "-eth" is offered "-eth" verbs), the same capitals (a name is offered
 * names), a similar length, drawn from the passage's own chapter so they
 * sound like Scripture. Never a word of the passage itself.
 */
export function choiceDistractors(
	answer: string,
	pool: readonly string[],
	passageWords: readonly string[],
	seed: number,
): string[] {
	const answerKey = foldWord(answer);
	const taken = new Set(passageWords.map(foldWord));
	taken.add(answerKey);
	const capital = isCapitalized(answer);
	const ending = suffixClass(answer);
	const seen = new Set<string>();
	const scored: { word: string; score: number; tie: number }[] = [];
	const consider = (word: string, bonus: number) => {
		const core = word.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
		const key = foldWord(core);
		if (!/^\p{L}+$/u.test(core) || key.length < 3 || taken.has(key) || seen.has(key) || STOPWORDS.has(key)) return;
		seen.add(key);
		// Lowercase candidates take the answer's capitals only when it is a name.
		const shaped = capital ? core : core.toLowerCase();
		if (capital !== isCapitalized(core)) return;
		const score =
			bonus + (suffixClass(core) === ending ? 8 : 0) - Math.min(Math.abs(key.length - answerKey.length), 6);
		scored.push({ word: shaped, score, tie: hashText(`${key}:${seed}`) });
	};
	for (const word of pool) consider(word, 2);
	for (const word of FALLBACK_POOL) consider(word, 0);
	scored.sort((a, b) => b.score - a.score || a.tie - b.tie);
	return scored.slice(0, 3).map((item) => item.word);
}

/** The board's card: the passage with one word blanked and four words to choose from. */
export function choiceRound(text: string, pool: readonly string[], seed: number): ChoiceRound | null {
	const tokens = memoryTokens(text);
	const blankIndex = choiceBlankIndex(tokens, seed);
	if (blankIndex < 0) return null;
	const answer = tokens[blankIndex].core;
	const wrong = choiceDistractors(answer, pool, tokens.map((token) => token.core), seed);
	if (wrong.length < 3) return null;
	const answerIndex = hashText(`${answer}:${seed}`) % 4;
	const options = [...wrong];
	options.splice(answerIndex, 0, isCapitalized(answer) ? answer : answer.toLowerCase());
	return { tokens, blankIndex, options, answerIndex };
}

/* ------------------------------------------------------------------------ */
/* Grading                                                                   */
/* ------------------------------------------------------------------------ */

/**
 * right: send "good". wrong: send "again". close: a slip or two in a long
 * recall (a typo, one word), where the founder decides, the way Learn a
 * verse lets them decide on every self-checked mode.
 */
export type MemoryGrade = "right" | "close" | "wrong";

export function gradeRecall(mistakes: number, total: number): MemoryGrade {
	if (total <= 0 || mistakes < 0) return "wrong";
	if (mistakes === 0) return "right";
	return mistakes <= Math.max(1, Math.floor(total / 10)) ? "close" : "wrong";
}

/** Each typed blank against the word it hides. */
export function gradeBlanks(expected: readonly string[], typed: readonly string[]): { correct: boolean[]; mistakes: number } {
	const correct = expected.map((word, index) => foldWord(word) !== "" && foldWord(word) === foldWord(typed[index] ?? ""));
	return { correct, mistakes: correct.filter((ok) => !ok).length };
}

/** The tokens a first-letters round asks for: every token with a letter or digit in it. */
export function letterTargets(tokens: readonly MemoryToken[]): number[] {
	return tokens.flatMap((token, index) => (firstLetter(token.core) ? [index] : []));
}

/* ------------------------------------------------------------------------ */
/* The next review, in words                                                 */
/* ------------------------------------------------------------------------ */

/** Whole days between two "YYYY-MM-DD" keys. */
export function daysBetween(fromDay: string, toDay: string): number {
	return Math.round((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / 86_400_000);
}

/**
 * What happens next, read off the card as Learn a verse's scheduler left it.
 * A card still due today comes back later in this session at its next step
 * (steps 1 to 4 are stages 0 to 3); otherwise it leaves for its interval.
 */
export function describeNextReview(card: { stage: number; dueDay: string }, today: string): { later: boolean; days: number; text: string } {
	const days = daysBetween(today, card.dueDay);
	if (days <= 0) {
		const step = Math.min(Math.max(Math.trunc(card.stage) || 0, 0), 3) + 1;
		return { later: false, days: 0, text: `Back later in this session, step ${step} of 4` };
	}
	if (days === 1) return { later: true, days, text: "Next review tomorrow" };
	return { later: true, days, text: `Next review in ${days} days` };
}

/* ------------------------------------------------------------------------ */
/* Cards made from the founder's own study                                    */
/* ------------------------------------------------------------------------ */

export type MemorySource = "highlight" | "study" | "note" | "module" | "chat";

/** The order sources are shown in, the founder's own hand first. */
export const MEMORY_SOURCES: readonly MemorySource[] = ["highlight", "study", "note", "module", "chat"];

export const MEMORY_SOURCE_LABELS: Readonly<Record<MemorySource, string>> = {
	highlight: "From your highlights",
	study: "From your studies",
	note: "From your notes",
	module: "From SureWord Beta",
	chat: "From your chats",
};

export interface MemorySignal {
	source: MemorySource;
	range: PassageRange;
	/** When it happened, in ms. */
	at: number;
	/** The note, study, chat or beta item it came from. */
	title?: string;
}

export interface MemoryCandidatePlan extends MemorySignal {
	key: string;
	/** Verses of the passage not yet in the deck. */
	newVerses: number;
}

/**
 * Turn the signals into what the preview offers: one entry per passage,
 * from its strongest source (the order above) and newest mention, without
 * passages already wholly in the deck, at most `perSource` per source, newest
 * first within each.
 */
export function planCandidates(
	signals: readonly MemorySignal[],
	queued: ReadonlySet<string>,
	perSource = MEMORY_CANDIDATES_PER_SOURCE,
): MemoryCandidatePlan[] {
	const rank = (source: MemorySource) => MEMORY_SOURCES.indexOf(source);
	const best = new Map<string, MemoryCandidatePlan>();
	for (const signal of signals) {
		if (rangeLength(signal.range) < 1 || rangeLength(signal.range) > MEMORY_PASSAGE_MAX_VERSES) continue;
		let newVerses = 0;
		for (let verse = signal.range.start; verse <= signal.range.end; verse += 1) {
			if (!queued.has(`${signal.range.book}.${signal.range.chapter}.${verse}`)) newVerses += 1;
		}
		if (newVerses === 0) continue;
		const key = rangeKey(signal.range);
		const held = best.get(key);
		if (held && (rank(held.source) < rank(signal.source) || (held.source === signal.source && held.at >= signal.at))) continue;
		best.set(key, { ...signal, key, newVerses });
	}
	const out: MemoryCandidatePlan[] = [];
	for (const source of MEMORY_SOURCES) {
		const group = [...best.values()]
			.filter((candidate) => candidate.source === source)
			.sort((a, b) => b.at - a.at || a.key.localeCompare(b.key))
			.slice(0, perSource);
		out.push(...group);
	}
	return out;
}

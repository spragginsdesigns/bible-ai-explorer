/**
 * Pure rules for "Quiz me" (docs/FEATURES.md, "Quiz me"): what makes a
 * generated question safe to show, how the five are chosen and ordered, and
 * which depth a reader gets by default.
 *
 * The point of the quiz is that every answer is the verse. A question whose
 * right answer the verse does not actually say, or whose wrong answer the
 * verse does say, would teach something false with SureWord's name on it, so
 * those are dropped here mechanically rather than trusted to the prompt.
 *
 * No runtime imports, so `tests/quiz-rules.test.mjs` loads it under plain
 * `node --test` like `reading-plan-presets.ts`.
 */
import type { QuizAttemptInput, QuizDepth, QuizQuestion } from "./quiz-contract";

/** One question as the model wrote it, before validation. */
export interface DraftQuestion {
	prompt: string;
	correct: string;
	wrong: string[];
	verses: number[];
	note: string | null;
}

/**
 * Words that carry no meaning of their own, in modern and KJV English. An
 * answer made only of these ("He must") cannot be checked against a verse.
 */
const STOPWORDS = new Set(
	(
		"a an and are as at be been but by did do does for from had has have he her him his how i if in into is it its " +
		"me my no not of on or our she so than that the their them then there these they this those to up us was we " +
		"were what when where which who whom why will with would you your ye thee thou thy thine unto hath doth shall " +
		"must one all any also again"
	).split(" ")
);

/** Lowercase words with punctuation removed, apostrophes folded away. */
export function foldWords(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/['’]s\b/g, "")
		.replace(/[^a-z0-9\s]/g, " ")
		.split(/\s+/)
		.filter(Boolean);
}

function contentWords(text: string): string[] {
	return foldWords(text).filter((word) => word.length >= 3 && !STOPWORDS.has(word));
}

/**
 * Loose stem: the first five letters, so "believeth", "believe" and
 * "believed" meet, and "born" still matches "born".
 */
function stem(word: string): string {
	return word.slice(0, 5);
}

/** Share of the text's content words that also occur in the verse. */
export function overlapWithVerse(text: string, verseText: string): { words: number; share: number } {
	const words = contentWords(text);
	if (words.length === 0) return { words: 0, share: 0 };
	const verseStems = new Set(contentWords(verseText).map(stem));
	const hits = words.filter((word) => verseStems.has(stem(word))).length;
	return { words: words.length, share: hits / words.length };
}

/** The right answer must be words the verse actually says: at least half, at least one. */
export function answerIsGrounded(answer: string, verseText: string): boolean {
	const { words, share } = overlapWithVerse(answer, verseText);
	return words > 0 && share >= 0.5;
}

/**
 * A wrong answer the verse fully says would be marked wrong while the verse
 * calls it right. Short distractors made of one or two verse words are fine
 * ("Moses" when the answer is "the serpent"), so only an all-match with the
 * right answer's own words missing is rejected.
 */
export function distractorContradictsVerse(distractor: string, correct: string, verseText: string): boolean {
	const words = contentWords(distractor);
	if (words.length === 0) return true;
	const { share } = overlapWithVerse(distractor, verseText);
	if (share < 1) return false;
	const correctStems = new Set(contentWords(correct).map(stem));
	// Every word of it is in the verse and it repeats the answer: an echo of the right choice.
	return words.some((word) => correctStems.has(stem(word))) || words.length >= 3;
}

/** A small stable hash, so a chapter's option order is the same for every reader. */
export function seedHash(seed: string): number {
	let hash = 2166136261;
	for (let index = 0; index < seed.length; index += 1) {
		hash ^= seed.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}

/** Place the right answer at a seeded position among the wrong ones. */
export function arrangeOptions(correct: string, wrong: string[], seed: string): { options: string[]; answerIndex: number } {
	const answerIndex = seedHash(seed) % (wrong.length + 1);
	const options = [...wrong];
	options.splice(answerIndex, 0, correct);
	return { options, answerIndex };
}

/** "John 3:3", "John 3:3-5" or "John 3:3, 5". */
export function formatReference(bookName: string, chapter: number, verses: number[]): string {
	const sorted = [...new Set(verses)].sort((a, b) => a - b);
	if (sorted.length === 0) return `${bookName} ${chapter}`;
	const contiguous = sorted.every((verse, index) => index === 0 || verse === sorted[index - 1] + 1);
	const tail =
		sorted.length === 1
			? `${sorted[0]}`
			: contiguous
				? `${sorted[0]}-${sorted[sorted.length - 1]}`
				: sorted.join(", ");
	return `${bookName} ${chapter}:${tail}`;
}

function clean(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

export interface ValidationContext {
	book: number;
	chapter: number;
	bookName: string;
	/** Plain KJV text of every verse, index 0 is verse 1. */
	verses: string[];
}

/** Why a draft was dropped, for the logs and the tests. */
export type DropReason =
	| "empty"
	| "bad_verses"
	| "wrong_count"
	| "duplicate_options"
	| "ungrounded_answer"
	| "distractor_in_verse"
	| "too_long"
	| "answer_stands_out";

/**
 * A right answer far longer than every wrong one gives itself away: the
 * reader picks the long KJV quotation without having read anything.
 */
export function answerStandsOut(correct: string, wrong: string[]): boolean {
	const longestWrong = Math.max(...wrong.map((option) => option.length));
	return correct.length > Math.max(longestWrong * 1.6, longestWrong + 12);
}

/**
 * Validate one draft against the chapter. Returns the question ready to show,
 * or the reason it was dropped. Verse numbers are clamped to the chapter and
 * the verse text always comes from `ctx.verses`, never from the model.
 */
export function validateDraft(
	draft: DraftQuestion,
	ctx: ValidationContext,
	id: string
): { question: QuizQuestion } | { dropped: DropReason } {
	const prompt = clean(draft.prompt);
	const correct = clean(draft.correct);
	const wrong = draft.wrong.map(clean).filter(Boolean);
	if (!prompt || !correct) return { dropped: "empty" };
	if (prompt.length > 220 || correct.length > 90 || wrong.some((option) => option.length > 90)) {
		return { dropped: "too_long" };
	}
	const verses = [...new Set(draft.verses)]
		.filter((verse) => Number.isInteger(verse))
		.sort((a, b) => a - b);
	if (verses.length === 0 || verses.length > 3 || verses.some((verse) => verse < 1 || verse > ctx.verses.length)) {
		return { dropped: "bad_verses" };
	}
	if (wrong.length !== 3) return { dropped: "wrong_count" };
	const folded = [correct, ...wrong].map((option) => foldWords(option).join(" "));
	if (new Set(folded).size !== folded.length || folded.some((option) => !option)) {
		return { dropped: "duplicate_options" };
	}
	if (answerStandsOut(correct, wrong)) return { dropped: "answer_stands_out" };
	const verseText = verses.map((verse) => ctx.verses[verse - 1]).join(" ");
	if (!answerIsGrounded(correct, verseText)) return { dropped: "ungrounded_answer" };
	if (wrong.some((option) => distractorContradictsVerse(option, correct, verseText))) {
		return { dropped: "distractor_in_verse" };
	}
	const { options, answerIndex } = arrangeOptions(correct, wrong, `${ctx.book}:${ctx.chapter}:${prompt}`);
	const note = draft.note ? clean(draft.note) : "";
	return {
		question: {
			id,
			prompt,
			options,
			answerIndex,
			verses,
			reference: formatReference(ctx.bookName, ctx.chapter, verses),
			verseText,
			note: note && note.length <= 240 ? note : null,
		},
	};
}

/**
 * Choose `count` questions from the valid ones: one per primary verse first,
 * so the quiz walks the whole chapter instead of circling one verse, then in
 * chapter order. Ids are reassigned "q1".."qN" in that order.
 */
export function selectQuestions(valid: QuizQuestion[], count: number): QuizQuestion[] {
	const seen = new Set<number>();
	const spread: QuizQuestion[] = [];
	const rest: QuizQuestion[] = [];
	for (const question of valid) {
		if (seen.has(question.verses[0])) rest.push(question);
		else {
			seen.add(question.verses[0]);
			spread.push(question);
		}
	}
	return [...spread, ...rest]
		.slice(0, count)
		.sort((a, b) => a.verses[0] - b.verses[0])
		.map((question, index) => ({ ...question, id: `q${index + 1}` }));
}

/**
 * The depth someone gets when they have not chosen, from their own words
 * (About me and profile memories). Someone who says they are still seeking,
 * not saved yet, or exploring is asked the foundations; everyone else is
 * asked to go a step deeper. Absent any words, growing: a reader who opened
 * a chapter and finished it is reading on purpose.
 */
export function defaultDepthFromProfile(texts: string[]): QuizDepth {
	const joined = texts.join(" \n ").toLowerCase();
	const seeking =
		/\b(still seeking|seeking god|seeker|not (yet )?saved|not a (born.again |saved )?(believer|christian)|unbeliev|agnostic|atheist|skeptic|sceptic|exploring (the )?(faith|christianity|god)|new to (the bible|faith|christianity)|questioning)\b/;
	return seeking.test(joined) ? "seeking" : "growing";
}

export function isQuizDepth(value: unknown): value is QuizDepth {
	return value === "seeking" || value === "growing";
}

/**
 * Read a `POST /api/quiz/attempt` body. Returns the attempt, or an error code
 * the route answers 400 with. Counts must agree with each other and with the
 * quiz length bounds, and missed verses must be plausible verse numbers.
 */
export function parseAttempt(body: unknown): QuizAttemptInput | { error: string } {
	if (typeof body !== "object" || body === null) return { error: "invalid_body" };
	const data = body as Record<string, unknown>;
	const int = (value: unknown) => (typeof value === "number" && Number.isInteger(value) ? value : null);
	const book = int(data.book);
	const chapter = int(data.chapter);
	const total = int(data.total);
	const correct = int(data.correct);
	if (book === null || book < 1 || book > 66 || chapter === null || chapter < 1 || chapter > 150) {
		return { error: "invalid_reference" };
	}
	if (!isQuizDepth(data.depth)) return { error: "invalid_depth" };
	if (total === null || total < 1 || total > 10 || correct === null || correct < 0 || correct > total) {
		return { error: "invalid_score" };
	}
	const rawMissed = Array.isArray(data.missedVerses) ? data.missedVerses : [];
	const missedVerses = [...new Set(rawMissed.map(int))]
		.filter((verse): verse is number => verse !== null && verse >= 1 && verse <= 176)
		.sort((a, b) => a - b)
		.slice(0, 10);
	return { book, chapter, depth: data.depth, total, correct, missedVerses };
}

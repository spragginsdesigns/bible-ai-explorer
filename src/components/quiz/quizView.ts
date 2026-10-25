/**
 * Pure view logic for the web "Quiz me" screens (docs/quiz/PLAN.md). Kept free
 * of React, Next and "@/" imports so tests/quiz-view.test.mjs can run it under
 * plain node; the only import is the type-only contract, which is erased.
 */
import type {
	ChapterQuiz,
	QuizAttemptInput,
	QuizDepth,
	QuizQuestion,
	QuizReflection,
} from "../../lib/quiz-contract";

const LETTERS = ["A", "B", "C", "D", "E", "F"] as const;

/** The letter drawn in an option row's circle. */
export function optionLetter(index: number): string {
	return LETTERS[index] ?? String(index + 1);
}

/**
 * "From verse 3", "From verses 3-5" or "From verses 3, 5", read from the part
 * of `reference` after its colon. The screen sets it in uppercase with CSS so
 * a screen reader still says the words. Falls back to `verses` when the
 * reference carries no verse part.
 */
export function verseLabel(reference: string, verses: readonly number[] = []): string {
	const colon = reference.lastIndexOf(":");
	let part = colon >= 0 ? reference.slice(colon + 1).trim() : "";
	// Any dash (or other joiner) between numbers becomes a plain hyphen, and
	// commas get one space, whatever spacing the reference arrived with.
	part = part.replace(/\s+/g, "").replace(/[^0-9,]+/g, "-").replace(/,/g, ", ");
	if (!part) {
		if (verses.length === 0) return "";
		part = verses.join(", ");
	}
	const plural = /[-,]/.test(part);
	return `${plural ? "From verses" : "From verse"} ${part}`;
}

/**
 * Keyboard choice on the question screen: A-D (either case) or 1-4. Returns
 * the option index, or null for any other key or one past `count`.
 */
export function keyToOption(key: string, count: number): number | null {
	if (key.length !== 1) return null;
	const upper = key.toUpperCase();
	let index = -1;
	if (upper >= "A" && upper <= "Z") index = upper.charCodeAt(0) - 65;
	else if (upper >= "1" && upper <= "9") index = upper.charCodeAt(0) - 49;
	return index >= 0 && index < count ? index : null;
}

export function resultsHeadline(correct: number, total: number): string {
	return `You remembered ${correct} of ${total}`;
}

export function resultsSubline(missed: number): string {
	if (missed <= 0) return "Every answer, straight from the Word.";
	return missed === 1 ? "Here is the one worth another look." : "Here are the ones worth another look.";
}

export function loadingLine(title: string): string {
	return `Writing your questions from ${title}...`;
}

/** The question chat opens with from "Ask about this". */
export function askPrompt(question: Pick<QuizQuestion, "reference" | "prompt">): string {
	return `Help me understand ${question.reference}: ${question.prompt}`;
}

/** Index of the question's first answer-bearing verse, the one Read in context and Learn use. */
export function primaryVerse(question: Pick<QuizQuestion, "verses">): number {
	return question.verses[0] ?? 1;
}

/** How many answers matched, given one chosen index (or null) per question. */
export function countCorrect(questions: readonly QuizQuestion[], answers: readonly (number | null)[]): number {
	return questions.reduce((sum, question, i) => sum + (answers[i] === question.answerIndex ? 1 : 0), 0);
}

/**
 * `POST /api/quiz/attempt` body: coordinates and counts only. A missed
 * question contributes its primary verse, once, in quiz order.
 */
export function attemptBody(quiz: ChapterQuiz, answers: readonly (number | null)[]): QuizAttemptInput {
	const missedVerses: number[] = [];
	quiz.questions.forEach((question, i) => {
		if (answers[i] === question.answerIndex) return;
		const verse = primaryVerse(question);
		if (!missedVerses.includes(verse)) missedVerses.push(verse);
	});
	return {
		book: quiz.book,
		chapter: quiz.chapter,
		depth: quiz.depth,
		total: quiz.questions.length,
		correct: countCorrect(quiz.questions, answers),
		missedVerses,
	};
}

/**
 * The chapter after this one in canon order, crossing into the next book, or
 * null after Revelation 22. `lastBook` is the canon's last book order.
 */
export function nextChapterAfter(
	book: number,
	chapter: number,
	chaptersInBook: number,
	lastBook = 66
): { book: number; chapter: number } | null {
	if (chapter < chaptersInBook) return { book, chapter: chapter + 1 };
	if (book < lastBook) return { book: book + 1, chapter: 1 };
	return null;
}

/* ------------------------------------------------------------------------ */
/* "Not now" dismissals, kept on this device                                 */
/* ------------------------------------------------------------------------ */

export const DISMISSED_LIMIT = 200;

export function dismissalKey(book: number, chapter: number): string {
	return `${book}:${chapter}`;
}

/** Reads the stored list defensively: anything that is not a string array is empty. */
export function parseDismissed(raw: string | null): string[] {
	if (!raw) return [];
	try {
		const value: unknown = JSON.parse(raw);
		return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
	} catch {
		return [];
	}
}

/** Adds a key at the end (most recent), dropping the oldest past the cap. */
export function addDismissed(list: readonly string[], key: string, limit = DISMISSED_LIMIT): string[] {
	const next = list.filter((item) => item !== key);
	next.push(key);
	return next.length > limit ? next.slice(next.length - limit) : next;
}

/* ------------------------------------------------------------------------ */
/* Response parsing                                                          */
/* ------------------------------------------------------------------------ */

function isDepth(value: unknown): value is QuizDepth {
	return value === "seeking" || value === "growing";
}

function isQuestion(value: unknown): value is QuizQuestion {
	if (!value || typeof value !== "object") return false;
	const q = value as Record<string, unknown>;
	return (
		typeof q.id === "string" &&
		typeof q.prompt === "string" &&
		Array.isArray(q.options) &&
		q.options.length >= 2 &&
		q.options.every((option) => typeof option === "string") &&
		typeof q.answerIndex === "number" &&
		q.answerIndex >= 0 &&
		q.answerIndex < q.options.length &&
		Array.isArray(q.verses) &&
		q.verses.every((verse) => typeof verse === "number") &&
		typeof q.reference === "string" &&
		typeof q.verseText === "string" &&
		(q.note === null || q.note === undefined || typeof q.note === "string")
	);
}

function isReflection(value: unknown): value is QuizReflection {
	if (!value || typeof value !== "object") return false;
	const r = value as Record<string, unknown>;
	return (
		typeof r.verse === "number" &&
		typeof r.reference === "string" &&
		typeof r.verseText === "string" &&
		typeof r.prompt === "string"
	);
}

/**
 * Validates a `POST /api/quiz` body. A quiz with no usable question is null,
 * since the screen has nothing to ask; a malformed reflection is dropped.
 */
export function parseChapterQuiz(value: unknown): ChapterQuiz | null {
	if (!value || typeof value !== "object") return null;
	const quiz = value as Record<string, unknown>;
	if (typeof quiz.book !== "number" || typeof quiz.chapter !== "number") return null;
	if (!Array.isArray(quiz.questions)) return null;
	const questions = quiz.questions.filter(isQuestion).map((q) => ({ ...q, note: q.note ?? null }));
	if (questions.length === 0) return null;
	const depth = isDepth(quiz.depth) ? quiz.depth : "seeking";
	return {
		book: quiz.book,
		chapter: quiz.chapter,
		bookName: typeof quiz.bookName === "string" ? quiz.bookName : "",
		title: typeof quiz.title === "string" ? quiz.title : "",
		depth,
		suggestedDepth: isDepth(quiz.suggestedDepth) ? quiz.suggestedDepth : depth,
		questions,
		reflection: isReflection(quiz.reflection) ? quiz.reflection : null,
		model: typeof quiz.model === "string" ? quiz.model : null,
		cached: quiz.cached === true,
	};
}

/** What the screen says for a failed `POST /api/quiz`, by status and body. */
export function quizErrorMessage(status: number, body: { error?: unknown; code?: unknown } | null): string {
	const serverText = typeof body?.error === "string" && body.error.trim() ? body.error : null;
	if (status === 502 || body?.code === "unavailable") return "This quiz could not be written right now.";
	if (serverText && (status === 400 || status === 403 || status === 429)) return serverText;
	return "This quiz could not be written right now.";
}

/* ------------------------------------------------------------------------ */
/* Reflection note                                                           */
/* ------------------------------------------------------------------------ */

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

export interface ReflectionNote {
	title: string;
	htmlContent: string;
	plainText: string;
	wordCount: number;
}

/**
 * The "Save as a note" body: the verse as a Scripture blockquote (reference in
 * bold), the prompt in italics, then the reader's own words, one paragraph per
 * line they wrote.
 */
export function reflectionNote(quizTitle: string, reflection: QuizReflection, words: string): ReflectionNote {
	const lines = words
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	const htmlContent =
		`<blockquote><p><strong>${escapeHtml(reflection.reference)}</strong></p>` +
		`<p>${escapeHtml(reflection.verseText.trim())}</p></blockquote>` +
		`<p><em>${escapeHtml(reflection.prompt.trim())}</em></p>` +
		lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("");
	const plainText = [
		`${reflection.reference} "${reflection.verseText.trim()}"`,
		reflection.prompt.trim(),
		lines.join("\n"),
	].join("\n\n");
	return {
		title: `${quizTitle} reflection`,
		htmlContent,
		plainText,
		wordCount: plainText.split(/\s+/).filter(Boolean).length,
	};
}

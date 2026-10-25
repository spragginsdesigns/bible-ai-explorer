/**
 * Pure view model for "Quiz me" (docs/quiz/PLAN.md): every string and rule the
 * quiz screens and the reader's offer card render, kept free of React and the
 * network so vitest can pin the copy every platform shares.
 */
import { bookByOrder } from "@/features/bible/books";
import type { ChapterQuiz, QuizAttemptInput, QuizQuestion, QuizReflection } from "./quizContract";

/** "Not now" is remembered per chapter on this device, newest last, this many at most. */
export const DISMISSED_CAP = 200;

/** After this long on the loading screen a second line explains the wait. */
export const LOADING_HINT_MS = 4000;

/** Generation takes 7-10 s on a cache miss; the route's own budget is 60 s. */
export const QUIZ_TIMEOUT_MS = 60_000;

export const OFFER_BODY = "5 questions from what you just read. Every answer comes with its verse.";
export const KJV_NOTICE = "Questions come from the King James text.";
export const UNAVAILABLE_MESSAGE = "This quiz could not be written right now.";
export const OFFLINE_MESSAGE = "You appear to be offline. Check your connection and try again.";
export const LOADING_HINT = "Every answer is checked against the King James text.";

export const DEPTH_LABELS = { seeking: "Foundations", growing: "Going deeper" } as const;

const LETTERS = ["A", "B", "C", "D", "E", "F"];

export function offerTitle(bookName: string, chapter: number): string {
	return `Quiz me on ${bookName} ${chapter}`;
}

/** The quiz text is always the KJV, so any other text on screen gets a note. */
export function showsKjvNotice(textOnScreen: string): boolean {
	return textOnScreen !== "KJV";
}

export function loadingLine(title: string): string {
	return `Writing your questions from ${title}...`;
}

export function dismissKey(book: number, chapter: number): string {
	return `${book}:${chapter}`;
}

/** Adds a dismissed chapter, moving a repeat to the end and dropping the oldest past the cap. */
export function addDismissed(list: readonly string[], key: string, cap = DISMISSED_CAP): string[] {
	const next = [...list.filter((entry) => entry !== key), key];
	return next.length > cap ? next.slice(next.length - cap) : next;
}

export function optionLetter(index: number): string {
	return LETTERS[index] ?? String(index + 1);
}

export function optionAccessibilityLabel(index: number, text: string): string {
	return `Option ${optionLetter(index)}: ${text}`;
}

export function progressLabel(index: number, count: number): string {
	return `${index + 1} of ${count}`;
}

export function progressAccessibilityLabel(index: number, count: number): string {
	return `Question ${index + 1} of ${count}`;
}

/**
 * "From verse 3", "From verses 3-5" or "From verses 3, 5", read from the part
 * of the reference after the colon (the screen sets it in uppercase). Falls
 * back to the verse list when the reference has no verse part.
 */
export function verseLabel(question: Pick<QuizQuestion, "reference" | "verses">): string {
	const colon = question.reference.lastIndexOf(":");
	const raw = colon >= 0 ? question.reference.slice(colon + 1).trim() : "";
	const part = raw
		? raw
				.split(",")
				.map((piece) => piece.trim())
				.filter(Boolean)
				.join(", ")
		: question.verses.join(", ");
	if (!part) return "";
	const plural = /[-,]/.test(part);
	return `${plural ? "From verses" : "From verse"} ${part}`;
}

export function isCorrect(question: QuizQuestion, choice: number | null): boolean {
	return choice !== null && choice === question.answerIndex;
}

/** The verse a "Read in context" or "Learn this verse" opens: the primary one. */
export function primaryVerse(question: Pick<QuizQuestion, "verses">): number | null {
	return question.verses[0] ?? null;
}

export function askAboutPrompt(reference: string, prompt: string): string {
	return `Help me understand ${reference}: ${prompt}`;
}

export function quizHeaderTitle(title: string): string {
	return `${title} quiz`;
}

export function correctCount(quiz: ChapterQuiz, answers: readonly (number | null)[]): number {
	return quiz.questions.reduce((sum, question, index) => sum + (isCorrect(question, answers[index] ?? null) ? 1 : 0), 0);
}

export interface MissedQuestion {
	question: QuizQuestion;
	chosen: number | null;
}

export function missedQuestions(quiz: ChapterQuiz, answers: readonly (number | null)[]): MissedQuestion[] {
	return quiz.questions
		.map((question, index) => ({ question, chosen: answers[index] ?? null }))
		.filter(({ question, chosen }) => !isCorrect(question, chosen));
}

export function resultsHeadline(correct: number, total: number): string {
	return `You remembered ${correct} of ${total}`;
}

export function resultsSubline(missed: number): string {
	if (missed <= 0) return "Every answer, straight from the Word.";
	return missed === 1 ? "Here is the one worth another look." : "Here are the ones worth another look.";
}

/** The attempt record: counts and the primary verse of each miss, never text. */
export function buildAttempt(quiz: ChapterQuiz, answers: readonly (number | null)[]): QuizAttemptInput {
	const missedVerses: number[] = [];
	for (const { question } of missedQuestions(quiz, answers)) {
		const verse = primaryVerse(question);
		if (verse !== null && !missedVerses.includes(verse)) missedVerses.push(verse);
	}
	return {
		book: quiz.book,
		chapter: quiz.chapter,
		depth: quiz.depth,
		total: quiz.questions.length,
		correct: correctCount(quiz, answers),
		missedVerses,
	};
}

export interface ChapterTarget {
	book: number;
	chapter: number;
	label: string;
}

/** The next chapter in canon order, crossing into the next book; null after Revelation 22. */
export function nextChapterAfter(book: number, chapter: number): ChapterTarget | null {
	const current = bookByOrder(book);
	if (!current) return null;
	if (chapter < current.chapters) {
		return { book, chapter: chapter + 1, label: `${current.name} ${chapter + 1}` };
	}
	const next = bookByOrder(book + 1);
	return next ? { book: next.order, chapter: 1, label: `${next.name} 1` } : null;
}

export function continueLabel(target: ChapterTarget): string {
	return `Continue to ${target.label}`;
}

/** What the error screen says, from the failure's status. Shaped like ApiError, not tied to it. */
export function quizErrorMessage(error: unknown): string {
	if (!error || typeof error !== "object") return UNAVAILABLE_MESSAGE;
	const failure = error as { status?: unknown; isNetworkError?: unknown; isTimeout?: unknown; message?: unknown };
	const message = typeof failure.message === "string" ? failure.message.trim() : "";
	if (failure.isNetworkError === true) return OFFLINE_MESSAGE;
	if (failure.isTimeout === true) return UNAVAILABLE_MESSAGE;
	// 400 (bad reference), 403 (consent or credential) and 429 (rate limit)
	// explain themselves; anything else is a server failure only Retry can fix.
	if ((failure.status === 400 || failure.status === 403 || failure.status === 429) && message) return message;
	return UNAVAILABLE_MESSAGE;
}

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
 * The "Carry it with you" note: the verse as a Scripture blockquote, the
 * prompt in italics, then the reader's own words, one paragraph per line.
 */
export function reflectionNote(quizTitle: string, reflection: QuizReflection, words: string): ReflectionNote {
	const lines = words
		.trim()
		.split(/\n+/)
		.map((line) => line.trim())
		.filter(Boolean);
	const htmlContent =
		`<blockquote><p><strong>${escapeHtml(reflection.reference)}</strong></p>` +
		`<p>${escapeHtml(reflection.verseText)}</p></blockquote>` +
		`<p><em>${escapeHtml(reflection.prompt)}</em></p>` +
		lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("");
	const plainText = [`${reflection.reference}`, reflection.verseText, reflection.prompt, ...lines].join("\n\n");
	return {
		title: `${quizTitle} reflection`,
		htmlContent,
		plainText,
		wordCount: plainText.split(/\s+/).filter(Boolean).length,
	};
}

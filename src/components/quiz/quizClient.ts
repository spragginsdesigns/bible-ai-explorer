"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { consentFetch } from "@/lib/ai-consent-gate";
import { readModelPref } from "@/lib/preferences";
import type { ChapterQuiz, QuizAttemptInput, QuizDepth, QuizReflection } from "@/lib/quiz-contract";
import {
	addDismissed,
	dismissalKey,
	parseChapterQuiz,
	parseDismissed,
	quizErrorMessage,
	reflectionNote,
} from "./quizView";

/** A cache miss writes the quiz with a model, which takes several seconds. */
const QUIZ_TIMEOUT_MS = 60_000;
const DISMISSED_KEY = "sureword-quiz-dismissed";

export type QuizLoadState =
	| { status: "idle" }
	| { status: "loading"; depth: QuizDepth | null }
	/** `run` changes on every load, so a refetched quiz starts from question one. */
	| { status: "ready"; quiz: ChapterQuiz; run: number }
	| { status: "error"; message: string; code: string | null };

/**
 * `POST /api/quiz` for one chapter. The request is an AI call started by a
 * tap, so it goes through the consent gate. Same stale guard as
 * useVerseInsight: only the newest load may write state, so a slow
 * "Foundations" answer cannot land after the reader switched to "Going deeper".
 */
export function useChapterQuiz(book: number, chapter: number) {
	const [state, setState] = useState<QuizLoadState>({ status: "idle" });
	const abortRef = useRef<AbortController | null>(null);
	const runIdRef = useRef(0);

	useEffect(
		() => () => {
			runIdRef.current += 1;
			abortRef.current?.abort();
		},
		[]
	);

	const load = useCallback(
		(depth: QuizDepth | null) => {
			const id = ++runIdRef.current;
			abortRef.current?.abort();
			const controller = new AbortController();
			abortRef.current = controller;
			const timeout = setTimeout(() => controller.abort(), QUIZ_TIMEOUT_MS);
			setState({ status: "loading", depth });
			const modelId = readModelPref();
			void (async () => {
				try {
					const response = await consentFetch("/api/quiz", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							book,
							chapter,
							...(depth ? { depth } : {}),
							...(modelId ? { modelId } : {}),
						}),
						signal: controller.signal,
					});
					let body: unknown = null;
					try {
						body = await response.json();
					} catch {
						// An empty or non-JSON body falls through to the generic message.
					}
					if (runIdRef.current !== id) return;
					if (!response.ok) {
						const detail = body && typeof body === "object" ? (body as { error?: unknown; code?: unknown }) : null;
						setState({
							status: "error",
							message: quizErrorMessage(response.status, detail),
							code: typeof detail?.code === "string" ? detail.code : null,
						});
						return;
					}
					const quiz = parseChapterQuiz(body);
					if (!quiz) throw new Error("Malformed quiz");
					setState({ status: "ready", quiz, run: id });
				} catch {
					if (runIdRef.current !== id) return;
					// A timeout aborts too; only an abort from a newer load is silent,
					// and that case returned above.
					setState({ status: "error", message: "This quiz could not be written right now.", code: null });
				} finally {
					clearTimeout(timeout);
				}
			})();
		},
		[book, chapter]
	);

	return { state, load };
}

/** Sent once when the results first appear. A failure is not the reader's problem. */
export async function postQuizAttempt(body: QuizAttemptInput): Promise<void> {
	try {
		const response = await fetch("/api/quiz/attempt", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		if (!response.ok) console.warn("[quiz] attempt not recorded", response.status);
	} catch (error) {
		console.warn("[quiz] attempt not recorded", error);
	}
}

/**
 * Creates the reflection note, the same two-step create-then-PATCH flow as
 * saveVerseToNote (src/lib/bible/verseActions.ts), deleting the empty note if
 * its content could not be written. Returns the new note id.
 */
export async function saveReflectionNote(quizTitle: string, reflection: QuizReflection, words: string): Promise<string> {
	const note = reflectionNote(quizTitle, reflection, words);
	const createRes = await fetch("/api/notes", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ title: note.title, folderId: null }),
	});
	if (!createRes.ok) throw new Error("Failed to create note");
	const created: { id: string } = await createRes.json();
	try {
		const patchRes = await fetch(`/api/notes/${created.id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				htmlContent: note.htmlContent,
				plainText: note.plainText,
				wordCount: note.wordCount,
			}),
		});
		if (!patchRes.ok) throw new Error("Failed to save note content");
	} catch (error) {
		try {
			await fetch(`/api/notes/${created.id}`, { method: "DELETE" });
		} catch {
			// Keep the original failure.
		}
		throw error;
	}
	return created.id;
}

/* "Not now" is remembered on this device only. Storage can be blocked
   (private windows, site data off), so every access is guarded. */

export function isChapterDismissed(book: number, chapter: number): boolean {
	try {
		return parseDismissed(window.localStorage.getItem(DISMISSED_KEY)).includes(dismissalKey(book, chapter));
	} catch {
		return false;
	}
}

export function dismissChapter(book: number, chapter: number): void {
	try {
		const list = parseDismissed(window.localStorage.getItem(DISMISSED_KEY));
		window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(addDismissed(list, dismissalKey(book, chapter))));
	} catch {
		// The card still hides for this visit.
	}
}

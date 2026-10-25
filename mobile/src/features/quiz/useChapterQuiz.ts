import { useCallback, useEffect, useRef, useState } from "react";
import { useStableGetToken } from "@/features/notes/useStableGetToken";
import { getSettings } from "@/features/settings/settingsStore";
import { apiJson } from "@/lib/api";
import type { ChapterQuiz, QuizDepth } from "./quizContract";
import { QUIZ_TIMEOUT_MS, quizErrorMessage } from "./quizView";

export type ChapterQuizState =
	| { status: "loading"; depth: QuizDepth | null }
	| { status: "ready"; quiz: ChapterQuiz }
	| { status: "error"; message: string; depth: QuizDepth | null };

/**
 * Loads one chapter's quiz from `POST /api/quiz`. The first load omits the
 * depth so the server picks this reader's default; a depth switch refetches
 * with that depth. Only the newest request may write: a switch aborts the one
 * in flight, and so does leaving the screen.
 */
export function useChapterQuiz(book: number, chapter: number) {
	const getToken = useStableGetToken();
	const [state, setState] = useState<ChapterQuizState>({ status: "loading", depth: null });
	const requestId = useRef(0);
	const controller = useRef<AbortController | null>(null);

	const load = useCallback(
		(depth: QuizDepth | null) => {
			const id = ++requestId.current;
			controller.current?.abort();
			const abort = new AbortController();
			controller.current = abort;
			setState({ status: "loading", depth });
			const modelId = getSettings().chatModelId;
			void apiJson<ChapterQuiz>(
				getToken,
				"/api/quiz",
				{
					method: "POST",
					body: {
						book,
						chapter,
						...(depth ? { depth } : {}),
						// The reader's chat model, as the other reader AI calls send it.
						...(modelId ? { modelId } : {}),
					},
				},
				{ timeoutMs: QUIZ_TIMEOUT_MS, signal: abort.signal },
			)
				.then((quiz) => {
					if (requestId.current !== id) return;
					if (!quiz || !Array.isArray(quiz.questions) || quiz.questions.length === 0) {
						setState({ status: "error", message: quizErrorMessage(null), depth });
						return;
					}
					setState({ status: "ready", quiz });
				})
				.catch((error: unknown) => {
					if (requestId.current !== id) return;
					setState({ status: "error", message: quizErrorMessage(error), depth });
				});
		},
		[getToken, book, chapter],
	);

	useEffect(() => {
		load(null);
		return () => {
			// Invalidates the run, which also covers unmount.
			requestId.current += 1;
			controller.current?.abort();
		};
	}, [load]);

	const retry = useCallback(() => {
		load(state.status === "ready" ? state.quiz.depth : state.depth);
	}, [load, state]);

	return { state, load, retry };
}

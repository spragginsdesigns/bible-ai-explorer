"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { commonQuestionSuggestions } from "@/utils/commonQuestions";
import {
	parseSuggestedQuestionsResponse,
	type SuggestedQuestionInput,
} from "@/utils/questionPresentation";

/**
 * The personalized opening questions (`GET /api/suggested-questions`).
 *
 * Cached at module scope, not in state: the welcome screen remounts every time
 * the user starts a new chat, and one generation per page session is plenty.
 * Deliberately not persisted to localStorage — these questions quote the user's
 * own study, and a shared browser must not hand them to the next account. The
 * in-memory copy is keyed by user id for the same reason: signing out and back
 * in as someone else does not necessarily tear down this module.
 */

const DEFAULTS: SuggestedQuestionInput[] = commonQuestionSuggestions.slice(0, 6);
/** The route allows itself 60s; the screen should not wait that long to fall back. */
const TIMEOUT_MS = 25_000;

type QuestionSet = { questions: SuggestedQuestionInput[]; personalized: boolean };

let cached: { userId: string; result: QuestionSet } | null = null;
let inFlight: { userId: string; promise: Promise<QuestionSet> } | null = null;

function load(userId: string): Promise<QuestionSet> {
	if (inFlight?.userId === userId) return inFlight.promise;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
	const promise = fetch("/api/suggested-questions", { signal: controller.signal })
		.then(async (res) => {
			if (!res.ok) throw new Error("Suggested questions request failed.");
			const data: unknown = await res.json();
			const questions = parseSuggestedQuestionsResponse(data);
			const personalized = typeof data === "object" && data !== null &&
				"personalized" in data && data.personalized === true;
			return { questions: questions.length > 0 ? questions : DEFAULTS, personalized: personalized && questions.length > 0 };
		})
		.catch(() => ({ questions: DEFAULTS, personalized: false }))
		.then((result) => {
			clearTimeout(timer);
			cached = { userId, result };
			inFlight = null;
			return result;
		});
	inFlight = { userId, promise };
	return promise;
}

export function useSuggestedQuestions(): {
	questions: SuggestedQuestionInput[];
	loading: boolean;
	personalized: boolean;
} {
	const { userId } = useAuth();
	const [state, setState] = useState<{ userId: string; result: QuestionSet } | null>(
		cached && cached.userId === userId ? cached : null
	);

	useEffect(() => {
		if (!userId || state?.userId === userId) return;
		let active = true;
		void load(userId).then((loaded) => {
			if (active) setState({ userId, result: loaded });
		});
		return () => {
			active = false;
		};
	}, [userId, state]);

	const current = state && state.userId === userId ? state.result : null;
	return { questions: current?.questions ?? DEFAULTS, loading: false, personalized: current?.personalized ?? false };
}

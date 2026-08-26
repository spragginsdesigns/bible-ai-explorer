import { useEffect, useState } from "react";
import { useAuth } from "@clerk/expo";
import { apiJson, type GetToken } from "@/lib/api";
import { useStableGetToken } from "@/features/notes/useStableGetToken";
import { commonQuestionSuggestions } from "./commonQuestions";
import {
	parseSuggestedQuestionsResponse,
	type SuggestedQuestionInput,
} from "./questionPresentation";

/**
 * The personalized opening questions (`GET /api/suggested-questions`).
 * Mirrors `src/components/useSuggestedQuestions.ts` on web.
 *
 * Cached at module scope, not in state: the welcome screen remounts on every
 * new chat, and one generation per app session is plenty. Nothing is written to
 * AsyncStorage — these questions quote the user's own study — and the in-memory
 * copy is keyed by user id so signing out and back in as someone else cannot
 * inherit them.
 */

const DEFAULTS: SuggestedQuestionInput[] = commonQuestionSuggestions.slice(0, 6);
/** The route allows itself 60s; the screen should not wait that long to fall back. */
const TIMEOUT_MS = 25_000;

let cached: { userId: string; questions: SuggestedQuestionInput[] } | null = null;
let inFlight: { userId: string; promise: Promise<SuggestedQuestionInput[]> } | null = null;

function load(userId: string, getToken: GetToken): Promise<SuggestedQuestionInput[]> {
	if (inFlight?.userId === userId) return inFlight.promise;
	const promise = apiJson<{ questions?: unknown; items?: unknown }>(
		getToken,
		"/api/suggested-questions",
		undefined,
		{ timeoutMs: TIMEOUT_MS }
	)
		.then((data) => {
			const questions = parseSuggestedQuestionsResponse(data);
			return questions.length > 0 ? questions : DEFAULTS;
		})
		.catch(() => DEFAULTS)
		.then((questions) => {
			cached = { userId, questions };
			inFlight = null;
			return questions;
		});
	inFlight = { userId, promise };
	return promise;
}

export function useSuggestedQuestions(): {
	questions: SuggestedQuestionInput[];
	loading: boolean;
} {
	const { userId } = useAuth();
	const getToken = useStableGetToken();
	const [questions, setQuestions] = useState<SuggestedQuestionInput[] | null>(
		cached && cached.userId === userId ? cached.questions : null
	);

	useEffect(() => {
		if (!userId || questions) return;
		let active = true;
		void load(userId, getToken).then((loaded) => {
			if (active) setQuestions(loaded);
		});
		return () => {
			active = false;
		};
	}, [userId, getToken, questions]);

	return { questions: questions ?? [], loading: questions === null };
}

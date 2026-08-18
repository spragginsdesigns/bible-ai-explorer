import { useEffect, useState } from "react";
import { useAuth } from "@clerk/expo";
import { apiJson, type GetToken } from "@/lib/api";
import { useStableGetToken } from "@/features/notes/useStableGetToken";
import { commonQuestions } from "./commonQuestions";

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

const DEFAULTS = commonQuestions.slice(0, 6);
/** The route allows itself 60s; the screen should not wait that long to fall back. */
const TIMEOUT_MS = 25_000;

let cached: { userId: string; questions: string[] } | null = null;
let inFlight: { userId: string; promise: Promise<string[]> } | null = null;

function load(userId: string, getToken: GetToken): Promise<string[]> {
	if (inFlight?.userId === userId) return inFlight.promise;
	const promise = apiJson<{ questions?: unknown }>(
		getToken,
		"/api/suggested-questions",
		undefined,
		{ timeoutMs: TIMEOUT_MS }
	)
		.then((data) => {
			const questions = Array.isArray(data.questions)
				? data.questions.filter(
						(question): question is string => typeof question === "string" && question.length > 0
					)
				: [];
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

export function useSuggestedQuestions(): { questions: string[]; loading: boolean } {
	const { userId } = useAuth();
	const getToken = useStableGetToken();
	const [questions, setQuestions] = useState<string[] | null>(
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

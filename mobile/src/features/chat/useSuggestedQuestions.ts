import { useEffect, useState, useSyncExternalStore } from "react";
import { useAuth } from "@clerk/expo";
import { apiJson, type GetToken } from "@/lib/api";
import { aiConsentGate } from "@/lib/aiConsentGate";
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

function hasCurrentConsent(): boolean {
	const { record, required } = aiConsentGate.getSnapshot();
	return record?.version === required;
}

export function useSuggestedQuestions(): {
	questions: SuggestedQuestionInput[];
	loading: boolean;
} {
	const { userId } = useAuth();
	const getToken = useStableGetToken();
	const consented = useSyncExternalStore(aiConsentGate.subscribe, hasCurrentConsent);
	const [questions, setQuestions] = useState<SuggestedQuestionInput[] | null>(
		cached && cached.userId === userId ? cached.questions : null
	);

	useEffect(() => {
		// Wait for the consent gate to hold this account's recorded consent. The
		// chat screen mounts before AIConsentPresenter configures the gate, so
		// asking earlier was refused on the device, never reached the server, and
		// the static six were cached as this user's questions for the session.
		if (!userId || !consented || questions) return;
		let active = true;
		void load(userId, getToken).then((loaded) => {
			if (active) setQuestions(loaded);
		});
		return () => {
			active = false;
		};
	}, [userId, consented, getToken, questions]);

	// Without consent the static six are the answer, not an endless skeleton.
	if (!consented && !questions) return { questions: DEFAULTS, loading: false };
	return { questions: questions ?? [], loading: questions === null };
}

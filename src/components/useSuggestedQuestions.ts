"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { commonQuestions } from "@/utils/commonQuestions";

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

const DEFAULTS = commonQuestions.slice(0, 6);
/** The route allows itself 60s; the screen should not wait that long to fall back. */
const TIMEOUT_MS = 25_000;

let cached: { userId: string; questions: string[] } | null = null;
let inFlight: { userId: string; promise: Promise<string[]> } | null = null;

function load(userId: string): Promise<string[]> {
	if (inFlight?.userId === userId) return inFlight.promise;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
	const promise = fetch("/api/suggested-questions", { signal: controller.signal })
		.then(async (res) => {
			if (!res.ok) throw new Error("Suggested questions request failed.");
			const data: unknown = await res.json();
			const questions =
				typeof data === "object" && data !== null && Array.isArray((data as { questions?: unknown }).questions)
					? (data as { questions: unknown[] }).questions.filter(
							(question): question is string => typeof question === "string" && question.length > 0
						)
					: [];
			return questions.length > 0 ? questions : DEFAULTS;
		})
		.catch(() => DEFAULTS)
		.then((questions) => {
			clearTimeout(timer);
			cached = { userId, questions };
			inFlight = null;
			return questions;
		});
	inFlight = { userId, promise };
	return promise;
}

export function useSuggestedQuestions(): { questions: string[]; loading: boolean } {
	const { userId } = useAuth();
	const [questions, setQuestions] = useState<string[] | null>(
		cached && cached.userId === userId ? cached.questions : null
	);

	useEffect(() => {
		if (!userId || questions) return;
		let active = true;
		void load(userId).then((loaded) => {
			if (active) setQuestions(loaded);
		});
		return () => {
			active = false;
		};
	}, [userId, questions]);

	return { questions: questions ?? [], loading: questions === null };
}

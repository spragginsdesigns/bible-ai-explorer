import { useCallback, useEffect, useRef, useState } from "react";
import { API_URL, makeAuthedFetch, type GetToken } from "@/lib/api";
import { getSettings } from "@/features/settings/settingsStore";
import type { TranslationId } from "@/features/bible/translations";

export type VerseInsightStatus = "idle" | "loading" | "streaming" | "done" | "error";

export interface VerseInsightTarget {
	reference: string;
	text: string;
	translation: TranslationId;
}

/** Session cache so re-tapping a verse never re-bills the model. */
const insightCache = new Map<string, string>();

function cacheKey(target: VerseInsightTarget): string {
	return `${target.translation}:${target.reference}`;
}

/**
 * Tap-a-verse explanation stream for the reader sheet. Mirrors the web hook in
 * src/components/bible/useVerseInsight.ts. Reads the plain-text stream from
 * /api/verse-insight over the expo/fetch-backed authed fetch (the same
 * transport requirement as chat — RN's built-in fetch cannot stream).
 */
export function useVerseInsight(getToken: GetToken) {
	const [status, setStatus] = useState<VerseInsightStatus>("idle");
	const [text, setText] = useState("");
	const [error, setError] = useState<string | null>(null);
	const abortRef = useRef<AbortController | null>(null);
	// Guards state writes: only the most recent start()/reset() may touch state,
	// so a slow stream for verse A can never bleed into an open sheet for verse B.
	const runIdRef = useRef(0);

	useEffect(() => () => abortRef.current?.abort(), []);

	const reset = useCallback(() => {
		runIdRef.current += 1;
		abortRef.current?.abort();
		abortRef.current = null;
		setStatus("idle");
		setText("");
		setError(null);
	}, []);

	const start = useCallback(
		(target: VerseInsightTarget) => {
			const id = ++runIdRef.current;
			abortRef.current?.abort();

			const cached = insightCache.get(cacheKey(target));
			if (cached) {
				abortRef.current = null;
				setText(cached);
				setError(null);
				setStatus("done");
				return;
			}

			const controller = new AbortController();
			abortRef.current = controller;
			setText("");
			setError(null);
			setStatus("loading");

			void (async () => {
				try {
					const authedFetch = makeAuthedFetch(getToken);
					const res = await authedFetch(`${API_URL}/api/verse-insight`, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							reference: target.reference,
							text: target.text,
							translation: target.translation,
							modelId: getSettings().chatModelId,
						}),
						signal: controller.signal,
					});
					if (runIdRef.current !== id) return;

					if (!res.ok) {
						let message = "The explanation could not be generated. Try again.";
						try {
							const data = (await res.json()) as { error?: string };
							if (data?.error) message = data.error;
						} catch {
							// keep default message
						}
						setError(message);
						setStatus("error");
						return;
					}

					const reader = res.body?.getReader();
					if (!reader) throw new Error("The response had no stream.");
					const decoder = new TextDecoder();
					let full = "";
					for (;;) {
						const { done, value } = await reader.read();
						if (runIdRef.current !== id) return;
						if (done) break;
						full += decoder.decode(value, { stream: true });
						if (full) {
							setText(full);
							setStatus("streaming");
						}
					}
					full += decoder.decode();
					if (runIdRef.current !== id) return;
					if (!full.trim()) throw new Error("The model returned nothing.");
					insightCache.set(cacheKey(target), full);
					setText(full);
					setStatus("done");
				} catch (err) {
					if (runIdRef.current !== id || controller.signal.aborted) return;
					setError(
						err instanceof Error
							? err.message
							: "The explanation could not be generated. Try again."
					);
					setStatus("error");
				}
			})();
		},
		[getToken]
	);

	return { status, text, error, start, reset };
}

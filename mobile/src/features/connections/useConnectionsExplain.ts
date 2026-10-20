import { useCallback, useEffect, useRef, useState } from "react";
import { API_URL, makeAuthedFetch, type GetToken } from "@/lib/api";
import { getSettings } from "@/features/settings/settingsStore";
import type { TranslationId } from "@/features/bible/translations";

export type ExplainStatus = "idle" | "loading" | "streaming" | "done" | "error";

export interface ExplainTarget {
	reference: string;
	translation: TranslationId;
	/** A CONNECTION_SECTIONS id to explain only that section's links. */
	section: string | null;
}

/**
 * "Ask why these connect": streams /api/bible/connections/explain as plain
 * text, the same transport and run-id guard as useVerseInsight, so a slow
 * answer for one verse never lands in the sheet for another.
 */
export function useConnectionsExplain(getToken: GetToken) {
	const [status, setStatus] = useState<ExplainStatus>("idle");
	const [text, setText] = useState("");
	const [error, setError] = useState<string | null>(null);
	const abortRef = useRef<AbortController | null>(null);
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
		(target: ExplainTarget) => {
			const id = ++runIdRef.current;
			abortRef.current?.abort();
			const controller = new AbortController();
			abortRef.current = controller;
			setText("");
			setError(null);
			setStatus("loading");

			void (async () => {
				try {
					const authedFetch = makeAuthedFetch(getToken);
					const res = await authedFetch(`${API_URL}/api/bible/connections/explain`, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							reference: target.reference,
							translation: target.translation,
							section: target.section,
							modelId: getSettings().chatModelId,
						}),
						signal: controller.signal,
					});
					if (runIdRef.current !== id) return;
					if (!res.ok) {
						let message = "These connections could not be explained. Try again.";
						try {
							const data = (await res.json()) as { error?: string };
							if (data?.error) message = data.error;
						} catch {
							// keep the default message
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
					setText(full);
					setStatus("done");
				} catch (err) {
					if (runIdRef.current !== id || controller.signal.aborted) return;
					setError(err instanceof Error ? err.message : "These connections could not be explained. Try again.");
					setStatus("error");
				}
			})();
		},
		[getToken]
	);

	return { status, text, error, start, reset };
}

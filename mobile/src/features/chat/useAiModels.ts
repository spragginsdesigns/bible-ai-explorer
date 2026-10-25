import { useCallback, useEffect, useRef, useState } from "react";
import { fetchAiModels, type AiModelsResponse } from "@/features/settings/aiApi";
import type { GetToken } from "@/lib/api";

/**
 * The `/api/ai/models` payload for the chat screen, loaded once on mount and
 * shared by the composer's model chip and the picker sheet, so the chip can
 * name the model (and draw Pro's premium mark) before the sheet is ever opened.
 */
export function useAiModels(getToken: GetToken, enabled = true) {
	const [data, setData] = useState<AiModelsResponse | null>(null);
	const [loadFailed, setLoadFailed] = useState(false);
	const inFlight = useRef(false);
	// Bumped on sign-out so a response for the previous account is dropped.
	const generation = useRef(0);

	const reload = useCallback(async () => {
		if (inFlight.current) return;
		inFlight.current = true;
		const startedAt = generation.current;
		setLoadFailed(false);
		try {
			const next = await fetchAiModels(getToken);
			if (generation.current === startedAt) setData(next);
		} catch {
			if (generation.current === startedAt) setLoadFailed(true);
		} finally {
			inFlight.current = false;
		}
	}, [getToken]);

	useEffect(() => {
		// Signed out: drop the last account's plan so the next one never sees it.
		if (!enabled) {
			generation.current += 1;
			inFlight.current = false;
			setData(null);
			setLoadFailed(false);
			return;
		}
		void reload();
		// Once per sign-in (and mount); the sheet retries on open.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [enabled]);

	return { data, loadFailed, reload };
}

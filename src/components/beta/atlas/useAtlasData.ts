"use client";

import { useEffect, useState } from "react";
import type { AtlasCard, AtlasPassage, AtlasPersonLife, AtlasPersonStudies } from "@/lib/beta/atlas/types";

/**
 * Client fetches for SureWord Beta's Atlas & Timeline (LC-17655). Everything
 * the endpoints return is bundled, unchanging data, so each answer is kept for
 * the session and a card opened twice opens instantly. The founder's own
 * studies are the exception (`keep: false`): they change as they study.
 */

type Loadable<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error"; message: string };

const cache = new Map<string, unknown>();

function useCachedJson<T>(url: string | null, pick: (body: unknown) => T, keep = true): Loadable<T> | null {
	const [state, setState] = useState<{ url: string; value: Loadable<T> } | null>(null);
	useEffect(() => {
		if (!url) return;
		if (keep && cache.has(url)) {
			setState({ url, value: { status: "ready", data: cache.get(url) as T } });
			return;
		}
		const controller = new AbortController();
		setState({ url, value: { status: "loading" } });
		fetch(url, { signal: controller.signal, cache: "no-store" })
			.then(async (res) => {
				if (!res.ok) throw new Error(res.status === 404 ? "That is not in the atlas." : "The atlas could not load that just now.");
				const data = pick(await res.json());
				if (keep) cache.set(url, data);
				setState({ url, value: { status: "ready", data } });
			})
			.catch((error: unknown) => {
				if (controller.signal.aborted) return;
				setState({ url, value: { status: "error", message: error instanceof Error ? error.message : "Something went wrong." } });
			});
		return () => controller.abort();
		// `pick` is a stable shape-reader; the URL and `keep` are the only inputs.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [url, keep]);
	if (!url) return null;
	if (state?.url !== url) return keep && cache.has(url) ? { status: "ready", data: cache.get(url) as T } : { status: "loading" };
	return state.value;
}

export type AtlasSelection = { kind: "place" | "event"; id: string };

export function useAtlasCard(selection: AtlasSelection | null): Loadable<AtlasCard> | null {
	const url = selection ? `/api/beta/atlas/card?${selection.kind}=${encodeURIComponent(selection.id)}` : null;
	return useCachedJson(url, (body) => (body as { card: AtlasCard }).card);
}

export function useJourneyPassages(journeyId: string | null): Loadable<AtlasPassage[][]> | null {
	const url = journeyId ? `/api/beta/atlas/journey?id=${encodeURIComponent(journeyId)}` : null;
	return useCachedJson(url, (body) => (body as { stops: AtlasPassage[][] }).stops);
}

export function usePersonLife(personId: string | null): Loadable<AtlasPersonLife> | null {
	const url = personId ? `/api/beta/atlas/person?id=${encodeURIComponent(personId)}` : null;
	return useCachedJson(url, (body) => (body as { person: AtlasPersonLife }).person);
}

export function usePersonStudies(personId: string | null): Loadable<AtlasPersonStudies> | null {
	const url = personId ? `/api/beta/atlas/studies?person=${encodeURIComponent(personId)}` : null;
	return useCachedJson(url, (body) => body as AtlasPersonStudies, false);
}

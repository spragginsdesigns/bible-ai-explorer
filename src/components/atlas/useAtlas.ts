"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
	AtlasChapterView,
	AtlasEntityView,
	AtlasEraGroup,
	AtlasEventView,
	AtlasSearchHit,
} from "@/lib/bible/atlas-core";

/**
 * The atlas as the web client reads it: over `/api/bible/atlas` and
 * `/api/bible/atlas/timeline`, which serve the same bundled JSON the Android
 * app carries on the device. Fetching keeps the whole atlas out of the browser
 * bundle; the phone reads it locally because it must work offline.
 */

const GENERIC_FAILURE = "The Bible atlas could not be loaded. Try again.";

async function getJson<T>(path: string, signal: AbortSignal): Promise<T> {
	const res = await fetch(path, { signal });
	if (!res.ok) {
		const data = (await res.json().catch(() => null)) as { error?: string } | null;
		throw new Error(data?.error ?? GENERIC_FAILURE);
	}
	return (await res.json()) as T;
}

function messageFor(error: unknown): string {
	if (error instanceof DOMException && error.name === "AbortError") return "";
	return error instanceof Error && error.message ? error.message : GENERIC_FAILURE;
}

interface TimelineResponse {
	allEras: string[];
	eras: AtlasEraGroup[];
	events: AtlasEventView[];
}

export interface TimelineQuery {
	era?: string;
	book?: number;
	chapter?: number;
}

export interface UseAtlasTimeline {
	allEras: string[];
	eras: AtlasEraGroup[];
	events: AtlasEventView[];
	loading: boolean;
	error: string | null;
	reload: () => void;
}

/** The timeline for the current filter, refetched whenever the filter changes. */
export function useAtlasTimeline(query: TimelineQuery): UseAtlasTimeline {
	const [data, setData] = useState<TimelineResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [attempt, setAttempt] = useState(0);

	const search = useMemo(() => {
		const params = new URLSearchParams();
		if (query.era) params.set("era", query.era);
		if (query.book) params.set("book", String(query.book));
		if (query.book && query.chapter) params.set("chapter", String(query.chapter));
		const qs = params.toString();
		return qs ? `?${qs}` : "";
	}, [query.era, query.book, query.chapter]);

	useEffect(() => {
		const controller = new AbortController();
		setLoading(true);
		setError(null);
		getJson<TimelineResponse>(`/api/bible/atlas/timeline${search}`, controller.signal)
			.then((next) => {
				setData(next);
				setLoading(false);
			})
			.catch((err: unknown) => {
				const message = messageFor(err);
				if (!message) return; // aborted: a newer request owns the state
				setError(message);
				setLoading(false);
			});
		return () => controller.abort();
	}, [search, attempt]);

	return {
		allEras: data?.allEras ?? [],
		eras: data?.eras ?? [],
		events: data?.events ?? [],
		loading,
		error,
		reload: useCallback(() => setAttempt((value) => value + 1), []),
	};
}

/** Debounced name search. An empty query answers empty without a request. */
export function useAtlasSearch(query: string, delayMs = 180): {
	hits: AtlasSearchHit[];
	searching: boolean;
} {
	const [hits, setHits] = useState<AtlasSearchHit[]>([]);
	const [searching, setSearching] = useState(false);
	const trimmed = query.trim();
	const latest = useRef(0);

	useEffect(() => {
		if (!trimmed) {
			setHits([]);
			setSearching(false);
			return;
		}
		const controller = new AbortController();
		const id = ++latest.current;
		setSearching(true);
		const timer = setTimeout(() => {
			getJson<{ results: AtlasSearchHit[] }>(
				`/api/bible/atlas?q=${encodeURIComponent(trimmed)}`,
				controller.signal
			)
				.then((next) => {
					if (id !== latest.current) return;
					setHits(next.results);
					setSearching(false);
				})
				.catch(() => {
					if (id !== latest.current) return;
					setHits([]);
					setSearching(false);
				});
		}, delayMs);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	}, [trimmed, delayMs]);

	return { hits, searching };
}

/** One person or place, or null while nothing is selected. */
export function useAtlasEntity(id: string | null): {
	entity: AtlasEntityView | null;
	loading: boolean;
	error: string | null;
} {
	const [entity, setEntity] = useState<AtlasEntityView | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!id) {
			setEntity(null);
			setError(null);
			setLoading(false);
			return;
		}
		const controller = new AbortController();
		setLoading(true);
		setError(null);
		getJson<{ entity: AtlasEntityView }>(
			`/api/bible/atlas?id=${encodeURIComponent(id)}`,
			controller.signal
		)
			.then((next) => {
				setEntity(next.entity);
				setLoading(false);
			})
			.catch((err: unknown) => {
				const message = messageFor(err);
				if (!message) return;
				setEntity(null);
				setError(message);
				setLoading(false);
			});
		return () => controller.abort();
	}, [id]);

	return { entity, loading, error };
}

/** Who and where a chapter is about; null unless a chapter is in scope. */
export function useWhoIsIn(book: number | null, chapter: number | null): AtlasChapterView | null {
	const [view, setView] = useState<AtlasChapterView | null>(null);

	useEffect(() => {
		if (!book || !chapter) {
			setView(null);
			return;
		}
		const controller = new AbortController();
		getJson<AtlasChapterView>(
			`/api/bible/atlas?book=${book}&chapter=${chapter}`,
			controller.signal
		)
			.then(setView)
			.catch(() => setView(null));
		return () => controller.abort();
	}, [book, chapter]);

	return view;
}

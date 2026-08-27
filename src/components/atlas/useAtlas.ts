"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AtlasChapterView,
  AtlasEntityRef,
  AtlasEntityView,
  AtlasEraGroup,
  AtlasEventView,
  AtlasPersonConnectionPath,
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
    const data = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(data?.error ?? GENERIC_FAILURE);
  }
  return (await res.json()) as T;
}

function messageFor(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") return "";
  return error instanceof Error && error.message
    ? error.message
    : GENERIC_FAILURE;
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
  personId?: string;
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
    if (query.book && query.chapter)
      params.set("chapter", String(query.chapter));
    if (query.personId) params.set("personId", query.personId);
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  }, [query.era, query.book, query.chapter, query.personId]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    getJson<TimelineResponse>(
      `/api/bible/atlas/timeline${search}`,
      controller.signal,
    )
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
export function useAtlasSearch(
  query: string,
  delayMs = 180,
  limit = 12,
): {
  hits: AtlasSearchHit[];
  counts: Partial<Record<AtlasSearchHit["kind"], number>>;
  searching: boolean;
  error: string | null;
} {
  const [hits, setHits] = useState<AtlasSearchHit[]>([]);
  const [counts, setCounts] = useState<
    Partial<Record<AtlasSearchHit["kind"], number>>
  >({});
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = query.trim();
  const latest = useRef(0);

  useEffect(() => {
    if (!trimmed) {
      setHits([]);
      setCounts({});
      setSearching(false);
      setError(null);
      return;
    }
    const controller = new AbortController();
    const id = ++latest.current;
    setSearching(true);
    setError(null);
    const timer = setTimeout(() => {
      getJson<{
        results: AtlasSearchHit[];
        counts?: Partial<Record<AtlasSearchHit["kind"], number>>;
      }>(
        `/api/bible/atlas?q=${encodeURIComponent(trimmed)}&limit=${limit}`,
        controller.signal,
      )
        .then((next) => {
          if (id !== latest.current) return;
          setHits(next.results);
          setCounts(next.counts ?? {});
          setSearching(false);
        })
        .catch((err: unknown) => {
          if (id !== latest.current) return;
          setHits([]);
          setCounts({});
          setError(messageFor(err) || null);
          setSearching(false);
        });
    }, delayMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, delayMs, limit]);

  return { hits, counts, searching, error };
}

export interface AtlasEntityListResponse {
  results?: AtlasEntityRef[];
  items?: AtlasEntityRef[];
  nextCursor?: string | null;
  cursor?: string | null;
}

/** Directory data for the People and Places modes. */
export function useAtlasEntities(
  kind: "person" | "place" | null,
  era?: string | null,
  limit = 24,
): {
  items: AtlasEntityRef[];
  loading: boolean;
  error: string | null;
  nextCursor: string | null;
  reload: () => void;
  loadMore: () => void;
  loadingMore: boolean;
} {
  const [items, setItems] = useState<AtlasEntityRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!kind) {
      setItems([]);
      setNextCursor(null);
      setLoading(false);
      setError(null);
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({ kind, limit: String(limit) });
    if (era) params.set("era", era);
    setLoading(true);
    setError(null);
    getJson<AtlasEntityListResponse>(
      `/api/bible/atlas?${params.toString()}`,
      controller.signal,
    )
      .then((next) => {
        setItems(next.results ?? next.items ?? []);
        setNextCursor(next.nextCursor ?? next.cursor ?? null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        const message = messageFor(err);
        if (!message) return;
        setItems([]);
        setNextCursor(null);
        setError(message);
        setLoading(false);
      });
    return () => controller.abort();
  }, [kind, era, limit, attempt]);

  const loadMore = useCallback(() => {
    if (!kind || !nextCursor || loading || loadingMore) return;
    const controller = new AbortController();
    setLoadingMore(true);
    const params = new URLSearchParams({
      kind,
      limit: String(limit),
      cursor: nextCursor,
    });
    if (era) params.set("era", era);
    getJson<AtlasEntityListResponse>(
      `/api/bible/atlas?${params.toString()}`,
      controller.signal,
    )
      .then((next) => {
        setItems((current) => [
          ...current,
          ...(next.results ?? next.items ?? []),
        ]);
        setNextCursor(next.nextCursor ?? next.cursor ?? null);
      })
      .catch((err: unknown) => {
        const message = messageFor(err);
        if (message) setError(message);
      })
      .finally(() => setLoadingMore(false));
  }, [era, kind, limit, loading, loadingMore, nextCursor]);

  return {
    items,
    loading,
    error,
    nextCursor,
    loadingMore,
    loadMore,
    reload: useCallback(() => setAttempt((value) => value + 1), []),
  };
}

export type AtlasConnectionPath = AtlasPersonConnectionPath;

/** Shortest cited person-to-person path for the Trace connection panel. */
export function useAtlasConnection(
  from: string | null,
  to: string | null,
): {
  path: AtlasConnectionPath | null;
  loading: boolean;
  error: string | null;
} {
  const [path, setPath] = useState<AtlasConnectionPath | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!from || !to || from === to) {
      setPath(null);
      setLoading(false);
      setError(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    getJson<{ path?: AtlasConnectionPath; connection?: AtlasConnectionPath }>(
      `/api/bible/atlas/connection?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      controller.signal,
    )
      .then((next) => {
        setPath(next.path ?? next.connection ?? null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        const message = messageFor(err);
        if (!message) return;
        setPath(null);
        setError(message);
        setLoading(false);
      });
    return () => controller.abort();
  }, [from, to]);

  return { path, loading, error };
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
      controller.signal,
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

/** Fetches a complete event when global search finds one outside the loaded rail. */
export function useAtlasEvent(id: string | null): {
  event: AtlasEventView | null;
  loading: boolean;
  error: string | null;
} {
  const [event, setEvent] = useState<AtlasEventView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setEvent(null);
      setError(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    getJson<{ event: AtlasEventView }>(
      `/api/bible/atlas/event?id=${encodeURIComponent(id)}`,
      controller.signal,
    )
      .then((next) => {
        setEvent(next.event);
        setLoading(false);
      })
      .catch((err: unknown) => {
        const message = messageFor(err);
        if (!message) return;
        setEvent(null);
        setError(message);
        setLoading(false);
      });
    return () => controller.abort();
  }, [id]);

  return { event, loading, error };
}

/** Who and where a chapter is about; null unless a chapter is in scope. */
export function useWhoIsIn(
  book: number | null,
  chapter: number | null,
): AtlasChapterView | null {
  const [view, setView] = useState<AtlasChapterView | null>(null);

  useEffect(() => {
    if (!book || !chapter) {
      setView(null);
      return;
    }
    const controller = new AbortController();
    getJson<AtlasChapterView>(
      `/api/bible/atlas?book=${book}&chapter=${chapter}`,
      controller.signal,
    )
      .then(setView)
      .catch(() => setView(null));
    return () => controller.abort();
  }, [book, chapter]);

  return view;
}

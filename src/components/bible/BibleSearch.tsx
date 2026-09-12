"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { bookByOrder, resolveReference, type Reference } from "@/lib/bible/books";
import { searchBible, BIBLE_SEARCH_ERROR, type BibleSearchHit } from "@/lib/bible/search";
import type { TranslationId } from "@/lib/bible/translations";
import { readTranslationPref } from "@/lib/preferences";
import { usePreference } from "@/lib/preferencesSync";

const SEARCH_LIMIT = 100;
const DEBOUNCE_MS = 300;

/**
 * Translation-aware phrase search plus a reference quick-jump.
 * Superseded requests are cancelled and stale results are dropped.
 * Mirrors mobile/app/(app)/bible/search.tsx.
 */
const BibleSearch: React.FC = () => {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [hits, setHits] = useState<BibleSearchHit[]>([]);
  const [searched, setSearched] = useState("");
  const accountTranslation = usePreference<TranslationId>(readTranslationPref, "KJV");
  const [selectedTranslation, setSelectedTranslation] = useState<TranslationId | null>(null);
  const translation = selectedTranslation ?? accountTranslation;
  const [resultTranslation, setResultTranslation] = useState<TranslationId>(translation);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const trimmed = input.trim();
  const reference = useMemo<Reference | null>(
    () => (trimmed ? resolveReference(trimmed) : null),
    [trimmed]
  );

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setHits([]);
    setSearched("");
    setError(null);
    setLoading(trimmed.length >= 2 && !reference);
    const timer = setTimeout(() => {
      if (trimmed.length < 2 || reference) return;
      void searchBible(trimmed, translation, SEARCH_LIMIT, controller.signal).then((result) => {
        if (!active) return;
        setHits(result.hits);
        setResultTranslation(result.translation);
        setSearched(trimmed);
      }).catch(() => {
        if (active) setError(BIBLE_SEARCH_ERROR);
      }).finally(() => {
        if (active) setLoading(false);
      });
    }, DEBOUNCE_MS);
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [trimmed, reference, translation, attempt]);

  const openHit = (hit: { order: number; chapter: number; verse?: number; translation?: TranslationId }) => {
    router.push(
      `/bible/chapter?book=${hit.order}&chapter=${hit.chapter}` +
        (hit.verse ? `&verse=${hit.verse}` : "") + `&translation=${hit.translation ?? translation}`
    );
  };

  const referenceLabel = reference
    ? `${bookByOrder(reference.order)?.name ?? ""} ${reference.chapter}${
        reference.verse ? `:${reference.verse}` : ""
      }`
    : "";

  return (
    <div className="min-h-[100dvh] gradient-mesh">
      <div className="mx-auto w-full max-w-2xl lg:max-w-3xl px-5 pb-28 lg:pb-16">
        <div className="flex items-center gap-4 py-3 lg:py-6">
          <button
            type="button"
            onClick={() => router.back()}
            className="text-control font-semibold text-amber-600 dark:text-amber-400"
          >
            ‹ Back
          </button>
          <h1 className="flex-1 truncate text-center text-control font-semibold text-neutral-900 dark:text-neutral-100">
            Search
          </h1>
          <span className="w-11" aria-hidden />
        </div>

        <div className="mb-2 flex items-center rounded-xl border border-black/[0.08] dark:border-white/[0.06] bg-black/[0.03] dark:bg-white/[0.03] px-3">
          <input
            autoFocus
            aria-label="Search Bible verses"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder='Search verses or try "John 3:16"'
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="min-h-11 flex-1 bg-transparent text-body text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400/60 dark:placeholder:text-neutral-600 outline-none"
          />
          {input.length > 0 && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setInput("")}
              className="p-1 text-xl font-semibold text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
            >
              ×
            </button>
          )}
        </div>

        <div className="mb-2 flex items-center gap-2 text-metadata">
          <label htmlFor="search-translation">Search translation</label>
          <select id="search-translation" value={translation} onChange={(event) => setSelectedTranslation(event.target.value as TranslationId)} className="rounded-lg border border-neutral-500/30 bg-white dark:bg-neutral-900 px-3 py-2">
            <option value="KJV">KJV</option>
            <option value="NKJV">NKJV</option>
          </select>
        </div>

        {reference && (
          <button
            type="button"
            onClick={() => openHit(reference)}
            className="mb-2 w-full rounded-lg border border-amber-500/40 dark:border-amber-400/30 bg-amber-500/10 dark:bg-amber-400/10 px-3 py-3 text-left text-control font-semibold text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 dark:hover:bg-amber-400/20 transition-colors"
          >
            Go to {referenceLabel} →
          </button>
        )}

        {error ? (
          <p role="alert" className="py-2 text-metadata">
            {error} <button type="button" onClick={() => setAttempt((value) => value + 1)} className="underline">Retry</button>
          </p>
        ) : loading ? (
          <p role="status" className="py-2 text-metadata">Searching {translation} and checking other wording…</p>
        ) : searched ? (
          <p role="status" className="py-2 text-metadata text-neutral-400 dark:text-neutral-500">
            {hits.length === 0
              ? reference
                ? ""
                : "No phrase matches in KJV or NKJV. Try fewer words or a reference like Job 1:8."
              : hits.length >= SEARCH_LIMIT
                ? `First ${SEARCH_LIMIT} results. Refine your search.`
                : `${hits.length} result${hits.length === 1 ? "" : "s"}`}
            {hits.length > 0 && resultTranslation !== translation && ` in ${resultTranslation}. No phrase matches in ${translation}.`}
          </p>
        ) : (
          <p className="py-5 text-center text-metadata text-neutral-400 dark:text-neutral-500">
            Search {translation} by word or phrase. If there are no matches, we check {translation === "KJV" ? "NKJV" : "KJV"} too. NKJV requires a connection.
          </p>
        )}

        {searched &&
          hits.map((hit) => (
            <button
              key={`${hit.order}:${hit.chapter}:${hit.verse}`}
              type="button"
              onClick={() => openHit(hit)}
              className="mb-2 block w-full rounded-lg border border-black/[0.08] dark:border-white/[0.06] bg-black/[0.03] dark:bg-white/[0.03] px-3 py-3 text-left hover:bg-black/[0.06] dark:hover:bg-white/[0.06] transition-colors"
            >
              <span className="mb-1 block text-metadata font-bold text-amber-600 dark:text-amber-400">
                {bookByOrder(hit.order)?.name ?? `Book ${hit.order}`} {hit.chapter}:{hit.verse} {hit.translation}
              </span>
              <span className="line-clamp-2 block font-[family-name:var(--font-cormorant)] text-chat text-neutral-600 dark:text-neutral-300">
                {hit.text}
              </span>
            </button>
          ))}
      </div>
    </div>
  );
};

export default BibleSearch;

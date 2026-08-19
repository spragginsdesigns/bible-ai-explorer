"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { bookByOrder, resolveReference, type Reference } from "@/lib/bible/books";
import { searchKjv, type KjvSearchHit } from "@/lib/bible/kjv";

const SEARCH_LIMIT = 100;
const DEBOUNCE_MS = 300;

/**
 * Offline verse search over the bundled KJV plus a "John 3:16"-style reference
 * quick-jump. Search runs in a debounced effect (the first call loads every
 * book JSON) and stale results are dropped when the input has moved on.
 * Mirrors mobile/app/(app)/bible/search.tsx.
 */
const BibleSearch: React.FC = () => {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [hits, setHits] = useState<KjvSearchHit[]>([]);
  const [searched, setSearched] = useState("");

  const trimmed = input.trim();
  const reference = useMemo<Reference | null>(
    () => (trimmed ? resolveReference(trimmed) : null),
    [trimmed]
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      const query = input.trim();
      const snapshot = input;
      if (query.length < 2) {
        setHits([]);
        setSearched("");
        return;
      }
      void searchKjv(query, SEARCH_LIMIT).then((results) => {
        // Ignore the run if the input changed while the books were loading.
        setInput((current) => {
          if (current === snapshot) {
            setHits(results);
            setSearched(query);
          }
          return current;
        });
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input]);

  const openHit = (hit: { order: number; chapter: number; verse?: number }) => {
    router.push(
      `/bible/chapter?book=${hit.order}&chapter=${hit.chapter}` +
        (hit.verse ? `&verse=${hit.verse}` : "")
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
            className="text-[15px] font-semibold text-amber-600 dark:text-amber-400"
          >
            ‹ Back
          </button>
          <h1 className="flex-1 truncate text-center text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
            Search
          </h1>
          <span className="w-11" aria-hidden />
        </div>

        <div className="mb-2 flex items-center rounded-xl border border-black/[0.08] dark:border-white/[0.06] bg-black/[0.03] dark:bg-white/[0.03] px-3">
          <input
            autoFocus
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder='Search verses or try "John 3:16"'
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="min-h-11 flex-1 bg-transparent text-[15px] text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400/60 dark:placeholder:text-neutral-600 outline-none"
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

        {reference && (
          <button
            type="button"
            onClick={() => openHit(reference)}
            className="mb-2 w-full rounded-lg border border-amber-500/40 dark:border-amber-400/30 bg-amber-500/10 dark:bg-amber-400/10 px-3 py-3 text-left text-sm font-semibold text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 dark:hover:bg-amber-400/20 transition-colors"
          >
            Go to {referenceLabel} →
          </button>
        )}

        {searched ? (
          <p className="py-2 text-xs text-neutral-400 dark:text-neutral-500">
            {hits.length === 0
              ? reference
                ? ""
                : "No verses found."
              : hits.length >= SEARCH_LIMIT
                ? `First ${SEARCH_LIMIT} of many — refine your search`
                : `${hits.length} result${hits.length === 1 ? "" : "s"}`}
          </p>
        ) : (
          <p className="py-5 text-center text-[13px] text-neutral-400 dark:text-neutral-500">
            Search the King James text by word or phrase.
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
              <span className="mb-1 block text-[13px] font-bold text-amber-600 dark:text-amber-400">
                {bookByOrder(hit.order)?.name ?? `Book ${hit.order}`} {hit.chapter}:{hit.verse}
              </span>
              <span className="line-clamp-2 block font-[family-name:var(--font-cormorant)] text-base leading-[22px] text-neutral-600 dark:text-neutral-300">
                {hit.text}
              </span>
            </button>
          ))}
      </div>
    </div>
  );
};

export default BibleSearch;

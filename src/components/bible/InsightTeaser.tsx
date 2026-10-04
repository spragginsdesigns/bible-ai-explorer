"use client";

import React from "react";
import { ChevronUp } from "lucide-react";
import type { VerseInsightStatus } from "./useVerseInsight";

interface InsightTeaserProps {
  status: VerseInsightStatus;
  text: string;
  error: string | null;
  /** Expand to the study view. */
  onPress: () => void;
  onRetry: () => void;
}

const SKELETON =
  "h-3 animate-pulse rounded-full border border-amber-500/20 dark:border-amber-400/20 bg-amber-500/15 dark:bg-amber-400/15 glow-amber-sm";

/**
 * The verse sheet's peek body: the first two lines of the explanation and the
 * way into the study view. Mirrors
 * mobile/src/features/bible/verse-sheet/InsightTeaser.tsx.
 */
export default function InsightTeaser({ status, text, error, onPress, onRetry }: InsightTeaserProps) {
  const affordance = (
    <span className="flex items-center gap-0.5 self-end text-metadata font-bold text-amber-600 dark:text-amber-400">
      Study
      <ChevronUp className="h-3.5 w-3.5" aria-hidden />
    </span>
  );

  if (status === "error") {
    // Retry and Study are separate buttons, so retrying never also expands.
    return (
      <div className="flex flex-col gap-1 px-4 py-2">
        {error ? (
          <p className="text-metadata text-neutral-500 dark:text-neutral-400">{error}</p>
        ) : null}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onRetry}
            className="text-metadata font-bold text-amber-600 dark:text-amber-400"
          >
            Try again
          </button>
          <button type="button" aria-label="Open the study view" onClick={onPress} className="flex">
            {affordance}
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      aria-label="Open the study view"
      onClick={onPress}
      className="flex w-full flex-col gap-1 px-4 py-2 text-left transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
    >
      {status === "loading" ? (
        <span aria-label="Generating an explanation" className="flex w-full flex-col gap-2 py-1">
          <span className={`${SKELETON} block w-full`} />
          <span className={`${SKELETON} block w-[72%] [animation-delay:150ms]`} />
        </span>
      ) : (
        <>
          {text ? (
            <span className="line-clamp-2 text-[14px] leading-[21px] text-neutral-600 dark:text-neutral-300">
              {text}
            </span>
          ) : null}
          {affordance}
        </>
      )}
    </button>
  );
}

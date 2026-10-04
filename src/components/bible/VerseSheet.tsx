"use client";

import React, { useRef } from "react";
import { X } from "lucide-react";

export type VerseSheetTier = "peek" | "expanded";

interface VerseSheetProps {
  tier: VerseSheetTier;
  onTierChange: (tier: VerseSheetTier) => void;
  onClose: () => void;
  title: string;
  subtitle?: string;
  /** Rendered in the peek tier only, between the header and the footer. */
  peek: React.ReactNode;
  /** Rendered in the expanded tier only, in a scrolling body. */
  children: React.ReactNode;
  /** Pinned at the bottom in BOTH tiers (the action bar). */
  footer: React.ReactNode;
}

/** Vertical travel that counts as a swipe on the header rather than a tap. */
const SWIPE_PX = 40;

/**
 * Two-tier verse sheet, the web twin of
 * mobile/src/features/bible/verse-sheet/VerseSheet.tsx. Non-modal on purpose:
 * the peek leaves the chapter readable and clickable, so further verses can
 * join the selection while it is up. Only the expanded study view puts a scrim
 * over the chapter, and clicking that scrim collapses back to the peek, as the
 * Android backdrop does. The grabber toggles the tiers; on touch screens a
 * swipe on the header does the same (down from the peek closes). Escape is
 * handled by the reader, which owns the tier: expanded, then peek, then closed.
 *
 * Mounted only while a selection exists; the reader unmounts it to close.
 */
export default function VerseSheet({
  tier,
  onTierChange,
  onClose,
  title,
  subtitle,
  peek,
  children,
  footer,
}: VerseSheetProps) {
  const expanded = tier === "expanded";
  const touchStart = useRef<number | null>(null);

  const onTouchEnd = (endY: number) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (start === null) return;
    const delta = endY - start;
    if (delta < -SWIPE_PX && !expanded) onTierChange("expanded");
    else if (delta > SWIPE_PX) {
      if (expanded) onTierChange("peek");
      else onClose();
    }
  };

  return (
    <>
      {expanded ? (
        <button
          type="button"
          aria-label="Collapse details"
          onClick={() => onTierChange("peek")}
          className="fixed inset-0 z-40 cursor-default bg-black/35 animate-message-in"
        />
      ) : null}
      <div
        role="dialog"
        aria-modal={expanded}
        aria-label={`${title} actions`}
        // Centred over the reading column: on desktop that column starts
        // after the docked sidebar, so the sheet does too.
        className={`glass fixed inset-x-0 bottom-0 z-50 mx-auto flex w-full max-w-lg flex-col rounded-t-2xl border-t border-black/[0.08] dark:border-white/[0.08] animate-message-in lg:left-[268px] lg:max-w-xl ${
          expanded ? "h-[88dvh]" : "max-h-[60dvh]"
        }`}
      >
        <div
          className="flex-shrink-0 touch-none"
          onTouchStart={(event) => {
            touchStart.current = event.touches[0]?.clientY ?? null;
          }}
          onTouchEnd={(event) => onTouchEnd(event.changedTouches[0]?.clientY ?? 0)}
        >
          <button
            type="button"
            aria-label={expanded ? "Collapse details" : "Expand details"}
            aria-expanded={expanded}
            onClick={() => onTierChange(expanded ? "peek" : "expanded")}
            className="mx-auto flex px-8 pb-1 pt-2"
          >
            <span aria-hidden className="block h-1 w-9 rounded-full bg-black/20 dark:bg-white/25" />
          </button>
          <div className="flex items-center gap-3 px-4 pb-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-amber-600 dark:text-amber-400">{title}</p>
              {subtitle ? (
                <p className="truncate text-metadata text-neutral-500 dark:text-neutral-400">{subtitle}</p>
              ) : null}
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-neutral-500 dark:text-neutral-400 hover:bg-black/[0.05] dark:hover:bg-white/[0.06] transition-colors"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>

        {expanded ? (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        ) : (
          <div className="min-h-0 flex-shrink overflow-y-auto">{peek}</div>
        )}

        {footer}
      </div>
    </>
  );
}

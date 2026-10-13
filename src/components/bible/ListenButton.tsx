"use client";

import React, { useEffect, useRef, useState } from "react";
import { Headphones } from "lucide-react";
import { EDITION_CHOICES, RECOMMENDED_EDITION, RECOMMENDED_LABEL } from "@/lib/bible/audioBible";
import type { ChapterAudioPlayer } from "./useChapterAudio";

const BUTTON =
  "flex h-8 w-8 items-center justify-center gap-1.5 rounded-lg border lg:w-auto lg:px-2.5";
const BUTTON_IDLE =
  "border-black/[0.1] dark:border-white/[0.08] bg-black/[0.03] dark:bg-white/[0.03] text-neutral-600 dark:text-neutral-300 hover:bg-black/[0.06] dark:hover:bg-white/[0.06]";
const BUTTON_ON =
  "border-amber-500/40 dark:border-amber-400/30 bg-amber-500/10 dark:bg-amber-400/10 text-amber-600 dark:text-amber-400";

/**
 * The reader's headphones button. While listening it pauses and resumes; to
 * start, a chapter with one recording plays it at once, and a chapter with an
 * Alive recording too (Mark) first asks which one, listing Alive first,
 * highlighted and marked Recommended (LC-15842).
 */
export default function ListenButton({ player, reference }: { player: ChapterAudioPlayer; reference: string }) {
  const [choosing, setChoosing] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const hasChoice = player.editions.length > 1;

  useEffect(() => {
    if (!choosing) return;
    const onPointer = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setChoosing(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setChoosing(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [choosing]);

  // A chapter without the choice (paging on into Luke) closes a menu left open.
  useEffect(() => {
    if (!hasChoice) setChoosing(false);
  }, [hasChoice]);

  const onClick = () => {
    if (player.open) player.toggle();
    else if (hasChoice) setChoosing((open) => !open);
    else player.play();
  };

  return (
    <div ref={wrapper} className="relative">
      <button
        type="button"
        aria-label={player.open ? (player.playing ? "Pause listening" : "Resume listening") : `Listen to ${reference}`}
        aria-pressed={player.open}
        aria-haspopup={hasChoice && !player.open ? "menu" : undefined}
        aria-expanded={hasChoice && !player.open ? choosing : undefined}
        title="Listen"
        onClick={onClick}
        className={`${BUTTON} ${player.open || choosing ? BUTTON_ON : BUTTON_IDLE}`}
      >
        <Headphones className="h-4 w-4" aria-hidden />
        {/* Mobile keeps the icon in the crowded top bar; desktop names it, like Ask AI. */}
        <span className="hidden text-xs font-semibold lg:inline">Listen</span>
      </button>
      {choosing ? (
        <div
          role="menu"
          aria-label={`Listen to ${reference}`}
          // A phone's narrow top bar would push a button-anchored menu off the left
          // edge, so below sm it spans the screen under the header instead.
          className="fixed inset-x-3 top-14 z-50 sm:absolute sm:inset-x-auto sm:right-0 sm:top-10 sm:w-64 rounded-xl border border-black/[0.1] dark:border-white/[0.08] bg-white dark:bg-neutral-900 p-1.5 shadow-xl"
        >
          {player.editions.map((edition) => {
            const recommended = edition === RECOMMENDED_EDITION;
            return (
              <button
                key={edition}
                type="button"
                role="menuitem"
                onClick={() => {
                  setChoosing(false);
                  player.play(0, edition);
                }}
                className={`flex min-h-11 w-full flex-col items-start rounded-lg border px-3 py-2 text-left ${
                  recommended
                    ? "mb-1 border-amber-500/40 dark:border-amber-400/30 bg-amber-500/10 dark:bg-amber-400/10 hover:bg-amber-500/20 dark:hover:bg-amber-400/20 focus-visible:bg-amber-500/20 dark:focus-visible:bg-amber-400/20"
                    : "border-transparent hover:bg-black/[0.05] dark:hover:bg-white/[0.06] focus-visible:bg-black/[0.05] dark:focus-visible:bg-white/[0.06]"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span
                    className={`text-sm font-semibold ${
                      recommended ? "text-amber-700 dark:text-amber-300" : "text-neutral-900 dark:text-neutral-100"
                    }`}
                  >
                    {EDITION_CHOICES[edition].label}
                  </span>
                  {recommended ? (
                    <span className="rounded-full bg-amber-500/20 dark:bg-amber-400/20 px-2 py-0.5 text-metadata font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                      {RECOMMENDED_LABEL}
                    </span>
                  ) : null}
                </span>
                <span className="text-xs text-neutral-500 dark:text-neutral-400">{EDITION_CHOICES[edition].detail}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

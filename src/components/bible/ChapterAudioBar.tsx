"use client";

import React, { useEffect, useState } from "react";
import { Pause, Play, SkipBack, SkipForward, X } from "lucide-react";
import { formatClock, formatListenRate } from "@/components/cross/listen";
import type { ChapterAudioPlayer } from "./useChapterAudio";

const CHIP =
  "flex shrink-0 items-center justify-center rounded-full border border-amber-500/40 dark:border-amber-400/30 bg-amber-500/10 dark:bg-amber-400/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 dark:hover:bg-amber-400/20 transition-colors";
const ICON_BUTTON =
  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-neutral-600 dark:text-neutral-300 hover:bg-black/[0.05] dark:hover:bg-white/[0.06] transition-colors";

/** The element's clock, read here so a tick re-renders the bar, not the whole chapter. */
function usePlaybackClock(element: HTMLAudioElement | null) {
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  useEffect(() => {
    if (!element) return;
    const update = () => {
      setTime(element.currentTime);
      setDuration(Number.isFinite(element.duration) ? element.duration : 0);
    };
    update();
    const events = ["timeupdate", "loadedmetadata", "durationchange", "seeked", "emptied"];
    for (const event of events) element.addEventListener(event, update);
    return () => {
      for (const event of events) element.removeEventListener(event, update);
    };
  }, [element]);
  return { time, duration };
}

/**
 * The reader's floating Listen bar: chapter and verse being read, a scrubber,
 * verse-by-verse skips, the shared listening-speed chip and close. After an
 * hour with no interaction it turns into the "Still listening?" prompt, with
 * the audio already paused.
 */
export default function ChapterAudioBar({
  player,
  reference,
}: {
  player: ChapterAudioPlayer;
  reference: string;
}) {
  const element = player.elementRef.current;
  const { time, duration: loaded } = usePlaybackClock(element);
  const duration = loaded || player.audio?.duration || 0;

  return (
    <div
      role="region"
      aria-label="Audio Bible player"
      className="glass fixed inset-x-3 bottom-[calc(max(env(safe-area-inset-bottom),0.5rem)+4.25rem)] z-40 mx-auto max-w-lg rounded-2xl border border-black/[0.1] dark:border-white/[0.08] px-3 py-2.5 shadow-xl lg:bottom-6 lg:left-[268px] lg:max-w-xl"
    >
      {player.stillListeningPrompt ? (
        <div className="flex flex-col gap-2.5 px-1 py-1" role="alertdialog" aria-labelledby="still-listening-title">
          <div>
            <p id="still-listening-title" className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
              Still listening?
            </p>
            <p className="text-[13px] leading-5 text-neutral-500 dark:text-neutral-400">
              We paused {reference} after an hour without a tap.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              autoFocus
              onClick={player.keepListening}
              className={`${CHIP} h-10 flex-1 text-sm font-semibold`}
            >
              Keep listening
            </button>
            <button
              type="button"
              onClick={player.stop}
              className="h-10 flex-1 rounded-full border border-black/[0.1] dark:border-white/[0.08] text-sm font-semibold text-neutral-600 dark:text-neutral-300 hover:bg-black/[0.05] dark:hover:bg-white/[0.06] transition-colors"
            >
              Stop
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1">
            <div className="min-w-0 flex-1 pl-1">
              <p className="truncate text-[13.5px] font-semibold text-neutral-900 dark:text-neutral-100">
                {reference}
                {player.verse ? `:${player.verse}` : null}
              </p>
            </div>
            <button type="button" aria-label="Previous verse" onClick={() => player.skipVerse(-1)} className={ICON_BUTTON}>
              <SkipBack className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              aria-label={player.playing ? "Pause reading" : "Play reading"}
              onClick={player.toggle}
              className={`${CHIP} h-10 w-10`}
            >
              {player.playing ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4 translate-x-px" aria-hidden />}
            </button>
            <button type="button" aria-label="Next verse" onClick={() => player.skipVerse(1)} className={ICON_BUTTON}>
              <SkipForward className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={player.cycleRate}
              aria-label={`Playback speed ${formatListenRate(player.rate)}, tap to change`}
              className={`${CHIP} h-8 w-12 text-[12.5px] font-bold tabular-nums`}
            >
              {formatListenRate(player.rate)}
            </button>
            <button type="button" aria-label="Close player" onClick={player.stop} className={ICON_BUTTON}>
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <div className="flex items-center gap-2 px-1">
            <span className="w-10 text-metadata tabular-nums text-neutral-400 dark:text-neutral-500">{formatClock(time)}</span>
            <input
              type="range"
              min={0}
              max={duration}
              step={0.1}
              value={Math.min(time, duration)}
              disabled={!player.audio}
              onChange={(event) => {
                if (element && player.audio) element.currentTime = Number(event.target.value);
              }}
              aria-label="Position in chapter"
              aria-valuetext={`${formatClock(time)} of ${formatClock(duration)}`}
              className="h-1 flex-1 cursor-pointer rounded-full accent-amber-600 dark:accent-amber-400"
            />
            <span className="w-10 text-right text-metadata tabular-nums text-neutral-400 dark:text-neutral-500">{formatClock(duration)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { ReadAlongPiece } from "@/lib/bible/audioBible";
import type { ReadingWordStore } from "./useChapterAudio";

/**
 * One segment of the verse Listen is reading, cut into words, with the word
 * being read lit (LC-17909). Only these spans follow the word, so the rest of
 * the chapter does not re-render several times a second.
 */
export function ReadAlongWords({
  pieces,
  verse,
  store,
  parchment,
}: {
  pieces: ReadAlongPiece[];
  verse: number;
  store: ReadingWordStore;
  parchment: boolean;
}) {
  const readIndex = useCallback(() => {
    const word = store.get();
    return word?.verse === verse ? word.index : null;
  }, [store, verse]);
  const reading = useSyncExternalStore(store.subscribe, readIndex, () => null);
  const lit = parchment ? "bg-amber-700/30 dark:bg-amber-300/30" : "bg-amber-500/30 dark:bg-amber-300/25";
  return (
    <>
      {pieces.map((piece, i) =>
        piece.word === null ? (
          piece.text
        ) : (
          <span
            key={i}
            data-read-word={piece.word}
            className={piece.word === reading ? `rounded-sm [box-decoration-break:clone] ${lit}` : undefined}
          >
            {piece.text}
          </span>
        )
      )}
    </>
  );
}

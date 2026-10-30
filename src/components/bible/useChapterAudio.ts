"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_LISTEN_RATE, nextListenRate } from "@/components/cross/listen";
import {
  hasAlive,
  hasNarration,
  LISTEN_ORDER,
  needsStillListening,
  resumeFromHandoff,
  verseAt,
  verseStart,
  type AudioEdition,
  type ChapterAudio,
  type ChapterAudioResponse,
  type ListeningHandoff,
} from "@/lib/bible/audioBible";
import { readListenRatePref } from "@/lib/preferences";
import { setListenRatePreference, usePreference } from "@/lib/preferencesSync";

const ARTWORK_URL = "/web-app-manifest-512x512.png";
/** Same skip as the Listen card and Android's media service. */
const SKIP_SECONDS = 10;
/** A scroll or swipe this recent means the reader is looking elsewhere; don't pull them back. */
const FOLLOW_PAUSE_MS = 5000;

interface Options {
  book: number;
  chapter: number;
  /** Display name for the OS media card, e.g. "John 3". */
  reference: string;
  /** False when the chapter is shown in a translation other than the narrated KJV. */
  enabled: boolean;
  /** The chapter finished and the next one is narrated: page the reader there. */
  onChapterEnd: () => void;
  /** Whether the chapter after this one has narration, so playback can roll into it. */
  nextNarrated: boolean;
  /** The chapter after this one, so a session closed mid-read can carry on there. */
  next: { book: number; chapter: number } | null;
}

export interface ChapterAudioPlayer {
  /** This chapter has narration the reader can start. */
  available: boolean;
  /** The player bar is showing (a listening session is active). */
  open: boolean;
  playing: boolean;
  /** The verse being read, for the reader's highlight; null between chapters. */
  verse: number | null;
  /** Paused after an hour with no interaction, waiting for "Keep listening". */
  stillListeningPrompt: boolean;
  audio: ChapterAudio | null;
  /** The recordings this chapter has, in LISTEN_ORDER (Alive first); two means Listen offers a choice. */
  editions: AudioEdition[];
  /** The recording playing, or the one the next Listen continues with. */
  edition: AudioEdition;
  rate: number;
  elementRef: React.MutableRefObject<HTMLAudioElement | null>;
  /**
   * Play the chapter from the top (cue and heading first), or from a verse,
   * in the given recording (default: the current one).
   */
  play: (fromVerse?: number, edition?: AudioEdition) => void;
  toggle: () => void;
  stop: () => void;
  skipVerse: (delta: 1 | -1) => void;
  cycleRate: () => void;
  keepListening: () => void;
}

/**
 * One element for every reader the app opens, not one per reader (LC-17905).
 * Phones (iOS Safari above all) let a page start audio by itself only on an
 * element that once played from a tap; keeping that element across the game
 * and quiz pages lets a listening session carry on into the next chapter.
 */
let sharedElement: HTMLAudioElement | null = null;
function readerElement(): HTMLAudioElement {
  if (!sharedElement) {
    sharedElement = new Audio();
    sharedElement.preload = "metadata";
  }
  return sharedElement;
}

/** The session left playing when the last reader closed, until a reader carries it on. */
let handoff: ListeningHandoff | null = null;

/**
 * Seek once the new source's metadata is in: iOS Safari can ignore a
 * currentTime set straight after `src` changes.
 */
function seekWhenReady(element: HTMLAudioElement, seconds: number) {
  if (element.readyState >= HTMLMediaElement.HAVE_METADATA) {
    element.currentTime = seconds;
    return;
  }
  element.addEventListener("loadedmetadata", () => { element.currentTime = seconds; }, { once: true });
}

/** Where playback starts: the top of the chapter (0) or the start of a verse. */
function startAt(audio: ChapterAudio, fromVerse: number): number {
  return fromVerse > 0 ? verseStart(audio.verses, fromVerse) : 0;
}

async function readChapterAudio(book: number, chapter: number, edition: AudioEdition, signal: AbortSignal) {
  const query = edition === "alive" ? "&edition=alive" : "";
  const response = await fetch(`/api/bible/audio?book=${book}&chapter=${chapter}${query}`, { signal });
  if (!response.ok) return null;
  const body = (await response.json()) as ChapterAudioResponse;
  return body.status === "ready" ? body : null;
}

type Recordings = Partial<Record<AudioEdition, ChapterAudio>>;

/**
 * Every recording of the chapter, fetched together so choosing one on Listen
 * plays inside the tap (iOS Safari refuses a play() that waits on a fetch).
 * A missing Alive recording leaves just the regular one.
 */
async function readRecordings(book: number, chapter: number, signal: AbortSignal): Promise<Recordings> {
  const editions: AudioEdition[] = hasAlive(book) ? ["regular", "alive"] : ["regular"];
  const found = await Promise.all(
    editions.map((edition) => readChapterAudio(book, chapter, edition, signal).catch(() => null))
  );
  const recordings: Recordings = {};
  editions.forEach((edition, index) => {
    const recording = found[index];
    if (recording) recordings[edition] = recording;
  });
  return recordings;
}

/**
 * The reader's Listen player: the pre-rendered KJV narration for the chapter
 * on screen, read along with the text. One `<audio>` element lives for the
 * whole reading session, so finishing a chapter rolls into the next one on the
 * same element (which keeps playing with the screen off) instead of a new one
 * the browser might refuse to start without a fresh tap.
 */
export function useChapterAudio({
  book,
  chapter,
  reference,
  enabled,
  onChapterEnd,
  nextNarrated,
  next,
}: Options): ChapterAudioPlayer {
  const elementRef = useRef<HTMLAudioElement | null>(null);
  const [recordings, setRecordings] = useState<Recordings>({});
  const [audio, setAudio] = useState<ChapterAudio | null>(null);
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [verse, setVerse] = useState<number | null>(null);
  const [stillListeningPrompt, setStillListeningPrompt] = useState(false);
  const rate = usePreference(readListenRatePref, DEFAULT_LISTEN_RATE);

  const audioRef = useRef(audio);
  audioRef.current = audio;
  const recordingsRef = useRef(recordings);
  recordingsRef.current = recordings;
  /** The listener's Listen choice; it carries into the next chapter, or falls back to regular there. */
  const chosenEdition = useRef<AudioEdition>("regular");
  const openRef = useRef(open);
  openRef.current = open;
  /** Start playing (0 = from the top, else from this verse) once this chapter's audio loads. */
  const pendingPlay = useRef<number | null>(null);
  const lastActionAt = useRef(Date.now());
  const lastScrollAt = useRef(0);
  const endHandlers = useRef({ onChapterEnd, nextNarrated, next });
  endHandlers.current = { onChapterEnd, nextNarrated, next };

  const narrated = enabled && hasNarration(book);
  const playingEdition: AudioEdition = audio?.edition ?? "regular";
  const editions = useMemo(
    () => LISTEN_ORDER.filter((option) => recordings[option]),
    [recordings]
  );
  const markAction = useCallback(() => {
    lastActionAt.current = Date.now();
  }, []);

  // One element for the life of the app (readerElement); this reader listens to it while open.
  useEffect(() => {
    const element = readerElement();
    elementRef.current = element;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => {
      const current = audioRef.current;
      if (!current) return;
      setVerse(verseAt(current.verses, element.currentTime));
      if (!element.paused && needsStillListening(lastActionAt.current, Date.now())) {
        element.pause();
        setStillListeningPrompt(true);
      }
    };
    const onEnded = () => {
      setVerse(null);
      if (endHandlers.current.nextNarrated) {
        pendingPlay.current = 0;
        endHandlers.current.onChapterEnd();
      }
    };
    element.addEventListener("play", onPlay);
    element.addEventListener("pause", onPause);
    element.addEventListener("timeupdate", onTime);
    element.addEventListener("ended", onEnded);
    return () => {
      // Closing mid-read (the chapter's game or quiz, or anywhere else):
      // remember it, so the next chapter, or this one, carries on reading.
      const current = audioRef.current;
      if (openRef.current && !element.paused && current) {
        handoff = {
          book: current.book,
          chapter: current.chapter,
          verse: verseAt(current.verses, element.currentTime),
          edition: current.edition ?? "regular",
          next: endHandlers.current.next,
          at: Date.now(),
        };
      }
      element.pause();
      element.removeEventListener("play", onPlay);
      element.removeEventListener("pause", onPause);
      element.removeEventListener("timeupdate", onTime);
      element.removeEventListener("ended", onEnded);
      element.removeAttribute("src");
      element.load();
      elementRef.current = null;
    };
  }, []);

  // Load this chapter's narration. A session already listening carries on
  // into the new chapter from the top; a paused one waits there.
  useEffect(() => {
    setAudio(null);
    setRecordings({});
    setVerse(null);
    setStillListeningPrompt(false);
    if (!narrated) {
      // A chapter with no narration here (another translation) never carries a session on later.
      handoff = null;
      pendingPlay.current = null;
      const element = elementRef.current;
      if (element && openRef.current) {
        element.pause();
        element.removeAttribute("src");
        element.load();
      }
      setOpen(false);
      return;
    }
    const element = elementRef.current;
    if (element && openRef.current && !element.paused && pendingPlay.current === null) {
      pendingPlay.current = 0;
    }
    // A session closed mid-read carries on here: the next chapter from the
    // top, the same one from its verse (resumeFromHandoff). It is only read
    // here and cleared once playback starts, so an aborted load keeps it.
    const resumeAt = openRef.current ? null : resumeFromHandoff(handoff, book, chapter, Date.now());
    const resuming = resumeAt !== null && handoff !== null;
    // Any other chapter ends the session's claim, so a later visit never starts by itself.
    if (resumeAt === null) handoff = null;
    if (resuming && handoff) {
      pendingPlay.current = resumeAt;
      chosenEdition.current = handoff.edition;
    }
    element?.pause();
    const controller = new AbortController();
    readRecordings(book, chapter, controller.signal)
      .then((found) => {
        if (controller.signal.aborted) return;
        const next = found[chosenEdition.current] ?? found.regular ?? null;
        setRecordings(found);
        setAudio(next);
        if (!next) {
          pendingPlay.current = null;
          setOpen(false);
          return;
        }
        if (resuming) {
          handoff = null;
          openRef.current = true;
          setOpen(true);
        }
        if (!element || !openRef.current) return;
        // A new src resets playbackRate to the default, so the rate follows it.
        element.src = next.audioUrl;
        element.playbackRate = readListenRatePref();
        const from = pendingPlay.current;
        pendingPlay.current = null;
        if (from !== null) {
          seekWhenReady(element, startAt(next, from));
          void element.play().catch(() => setPlaying(false));
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setAudio(null);
      });
    return () => controller.abort();
  }, [book, chapter, narrated]);

  useEffect(() => {
    if (elementRef.current) elementRef.current.playbackRate = rate;
  }, [rate]);

  const play = useCallback(
    (fromVerse = 0, chosen?: AudioEdition) => {
      const element = elementRef.current;
      const picked = chosen ? recordingsRef.current[chosen] : undefined;
      if (chosen && picked) {
        chosenEdition.current = chosen;
        audioRef.current = picked;
        setAudio(picked);
      }
      const current = audioRef.current;
      if (!element || !current) return;
      markAction();
      setStillListeningPrompt(false);
      setOpen(true);
      if (element.getAttribute("src") !== current.audioUrl) element.src = current.audioUrl;
      element.playbackRate = readListenRatePref();
      seekWhenReady(element, startAt(current, fromVerse));
      void element.play().catch(() => setPlaying(false));
    },
    [markAction]
  );

  const toggle = useCallback(() => {
    const element = elementRef.current;
    // Between chapters the element still holds the finished one; wait for the next.
    if (!element || !audioRef.current) return;
    markAction();
    setStillListeningPrompt(false);
    if (element.paused) void element.play().catch(() => setPlaying(false));
    else element.pause();
  }, [markAction]);

  const stop = useCallback(() => {
    const element = elementRef.current;
    pendingPlay.current = null;
    setStillListeningPrompt(false);
    setOpen(false);
    setVerse(null);
    element?.pause();
  }, []);

  const skipVerse = useCallback(
    (delta: 1 | -1) => {
      const element = elementRef.current;
      const current = audioRef.current;
      if (!element || !current) return;
      markAction();
      const at = verseAt(current.verses, element.currentTime) ?? 0;
      const target = Math.min(current.verses.length, Math.max(1, at + delta));
      element.currentTime = verseStart(current.verses, target);
      setVerse(target);
    },
    [markAction]
  );

  const cycleRate = useCallback(() => {
    markAction();
    void setListenRatePreference(nextListenRate(readListenRatePref()));
  }, [markAction]);

  const keepListening = useCallback(() => {
    markAction();
    setStillListeningPrompt(false);
    void elementRef.current?.play().catch(() => setPlaying(false));
  }, [markAction]);

  // Any tap, key press or scroll while the session is open counts as "still here".
  useEffect(() => {
    if (!open) return;
    const onScroll = () => {
      lastScrollAt.current = Date.now();
      markAction();
    };
    const options = { capture: true, passive: true } as const;
    document.addEventListener("pointerdown", markAction, options);
    document.addEventListener("keydown", markAction, options);
    document.addEventListener("wheel", onScroll, options);
    document.addEventListener("touchmove", onScroll, options);
    return () => {
      document.removeEventListener("pointerdown", markAction, options);
      document.removeEventListener("keydown", markAction, options);
      document.removeEventListener("wheel", onScroll, options);
      document.removeEventListener("touchmove", onScroll, options);
    };
  }, [open, markAction]);

  // Keep the verse being read on screen, unless the reader has scrolled away.
  useEffect(() => {
    if (!open || !playing || verse === null) return;
    if (Date.now() - lastScrollAt.current < FOLLOW_PAUSE_MS) return;
    document
      .getElementById(`bible-verse-${verse}`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [open, playing, verse]);

  // Name the chapter on the OS media card; its buttons step by verse and count
  // as activity for the still-listening check, like a tap does. The handlers
  // read refs, so they stay live while the next chapter loads.
  useEffect(() => {
    if (!open) return;
    if (typeof navigator === "undefined" || !navigator.mediaSession) return;
    const session = navigator.mediaSession;
    if (typeof MediaMetadata !== "undefined") {
      session.metadata = new MediaMetadata({
        title: reference,
        artist: playingEdition === "alive" ? "SureWord Alive" : "King James Version",
        album: "SureWord",
        artwork: [{ src: ARTWORK_URL, sizes: "512x512", type: "image/png" }],
      });
    }
    const skip = (seconds: number) => {
      const element = elementRef.current;
      if (!element) return;
      markAction();
      element.currentTime = Math.max(0, Math.min(element.duration || Infinity, element.currentTime + seconds));
    };
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => { if (!audioRef.current) return; markAction(); setStillListeningPrompt(false); void elementRef.current?.play().catch(() => setPlaying(false)); }],
      ["pause", () => { markAction(); elementRef.current?.pause(); }],
      ["previoustrack", () => skipVerse(-1)],
      ["nexttrack", () => skipVerse(1)],
      ["seekbackward", () => skip(-SKIP_SECONDS)],
      ["seekforward", () => skip(SKIP_SECONDS)],
    ];
    for (const [action, handler] of handlers) {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // An action this browser does not support: skip it, keep the rest.
      }
    }
    return () => {
      for (const [action] of handlers) {
        try {
          session.setActionHandler(action, null);
        } catch {
          // Same guard on the way out.
        }
      }
      session.metadata = null;
    };
  }, [open, reference, playingEdition, markAction, skipVerse]);

  return {
    available: narrated && audio !== null,
    open,
    playing,
    verse,
    stillListeningPrompt,
    audio,
    editions,
    edition: playingEdition,
    rate,
    elementRef,
    play,
    toggle,
    stop,
    skipVerse,
    cycleRate,
    keepListening,
  };
}

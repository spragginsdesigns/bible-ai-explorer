import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer, type AudioStatus } from "expo-audio";
import { API_URL } from "@/lib/api";
import { setListenRate, useSettings } from "@/features/settings/settingsStore";
import { nextListenRate } from "@/features/cross/listen";
import { LISTEN_ORDER, adjacentVerse, hasNarration, needsStillListening, verseAt, verseStart, type AudioEdition, type ChapterAudio } from "./audioBible";

type Recordings = Partial<Record<AudioEdition, ChapterAudio>>;

/** One recording's timings, or null when the chapter has none (or a mismatched file). */
async function readRecording(book: number, chapter: number, edition: AudioEdition, signal: AbortSignal) {
  const query = edition === "alive" ? "&edition=alive" : "";
  const response = await fetch(`${API_URL}/api/bible/audio?book=${book}&chapter=${chapter}${query}`, { signal });
  if (!response.ok) throw new Error("Narration unavailable");
  const data = await response.json() as ChapterAudio | { status: "unavailable" };
  return data.status === "ready" && data.book === book && data.chapter === chapter ? data : null;
}

/** One active native player. Each chapter gets a distinct player identity so
 * a queued finish or error event from the old source cannot affect the new one. */
export function useChapterAudio(options: {
  book: number; chapter: number; reference: string; enabled: boolean;
  onChapterEnd: () => void; nextNarrated: boolean;
}) {
  const { listenRate: rate } = useSettings();
  const [audio, setAudio] = useState<ChapterAudio | null>(null);
  const [recordings, setRecordings] = useState<Recordings>({});
  /** The listener's Listen choice (LC-15532); it carries into the next chapter, or falls back to regular there. */
  const chosenEdition = useRef<AudioEdition>("regular");
  const recordingsRef = useRef<Recordings>({});
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [stillListeningPrompt, setStillListeningPrompt] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const latest = useRef({ options, rate }); latest.current = { options, rate };
  const audioRef = useRef<ChapterAudio | null>(null);
  const player = useRef<AudioPlayer | null>(null);
  const subscription = useRef<{ remove: () => void } | null>(null);
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionOpen = useRef(false);
  const pendingPlay = useRef<number | null>(null);
  const lastAction = useRef(Date.now());
  const run = useRef(0);
  const playOperation = useRef(0);
  const finishedPlayer = useRef<string | null>(null);
  const markAction = useCallback(() => { lastAction.current = Date.now(); }, []);

  const releasePlayer = useCallback(() => {
    if (watchdog.current) clearTimeout(watchdog.current);
    watchdog.current = null;
    subscription.current?.remove(); subscription.current = null;
    const old = player.current; player.current = null;
    if (old) { old.pause(); old.setActiveForLockScreen(false); old.remove(); }
  }, []);

  const installPlayer = useCallback((recording: ChapterAudio, startVerse: number | null) => {
    releasePlayer();
    const item = createAudioPlayer({ uri: recording.audioUrl }, { updateInterval: 250 });
    player.current = item;
    finishedPlayer.current = null;
    const generation = run.current;
    const operation = playOperation.current;
    let pendingStart = startVerse;
    let finished = false;
    let wasPlaying = false;
    let programmaticPlay = false;
    let lastTime = 0;
    setReady(false); setPlaying(false); setElapsed(0);
    item.setActiveForLockScreen(true, {
      title: latest.current.options.reference, artist: recording.edition === "alive" ? "SureWord · Alive" : "SureWord · KJV",
      artworkUrl: `${API_URL}/web-app-manifest-512x512.png`,
    }, { showSeekBackward: true, showSeekForward: true });
    const current = () => player.current === item && generation === run.current && sessionOpen.current;
    const handle = (status: AudioStatus) => {
      if (!current() || status.id !== item.id) return;
      if (status.error) {
        pendingStart = null; item.pause(); setPlaying(false); setReady(false);
        setError("Couldn't play narration. Try Listen again."); return;
      }
      setReady(status.isLoaded); setPlaying(status.playing); setElapsed(status.currentTime);
      if (status.isLoaded && watchdog.current) { clearTimeout(watchdog.current); watchdog.current = null; }
      if (status.playing && !wasPlaying) {
        if (!programmaticPlay) markAction();
        programmaticPlay = false;
      }
      if (Math.abs(status.currentTime - lastTime) > 3) markAction();
      wasPlaying = status.playing; lastTime = status.currentTime;
      if (status.playing && needsStillListening(lastAction.current, Date.now())) {
        item.pause(); setStillListeningPrompt(true);
      }
      if (status.isLoaded && pendingStart !== null) {
        item.setPlaybackRate(latest.current.rate, "high");
        const verse = pendingStart; pendingStart = null;
        void item.seekTo(verse > 0 ? verseStart(recording.verses, verse) : 0).then(() => {
          if (current() && operation === playOperation.current) { programmaticPlay = true; item.play(); }
        }).catch(() => { if (current()) setError("Couldn't play narration. Try Listen again."); });
      }
      if (status.didJustFinish && !finished) {
        finished = true;
        finishedPlayer.current = status.id;
        if (latest.current.options.nextNarrated) {
          pendingPlay.current = 0;
          latest.current.options.onChapterEnd();
        }
      }
    };
    subscription.current = item.addListener("playbackStatusUpdate", handle);
    watchdog.current = setTimeout(() => {
      if (current() && !item.isLoaded) { setError("Couldn't load narration. Check your connection and try Listen again."); setReady(false); }
    }, 12_000);
    handle(item.currentStatus);
  }, [markAction, releasePlayer]);

  useEffect(() => {
    const controller = new AbortController();
    const generation = ++run.current;
    const continuePlaying = sessionOpen.current && (player.current?.playing || pendingPlay.current !== null);
    releasePlayer(); audioRef.current = null; recordingsRef.current = {};
    setAudio(null); setRecordings({}); setReady(false); setPlaying(false); setElapsed(0); setError(null); setStillListeningPrompt(false);
    if (!options.enabled || !hasNarration(options.book)) {
      pendingPlay.current = null; sessionOpen.current = false; setOpen(false);
      return () => controller.abort();
    }
    // Every recording of the chapter (the narration, and its Alive one), so the
    // Listen choice can play either. Any chapter may have Alive; the API knows
    // (LC-17800), and a missing Alive recording is skipped.
    const editions: AudioEdition[] = ["regular", "alive"];
    void Promise.all(editions.map(edition => edition === "regular"
      ? readRecording(options.book, options.chapter, edition, controller.signal)
      : readRecording(options.book, options.chapter, edition, controller.signal).catch(() => null)))
      .then(found => {
        if (controller.signal.aborted || generation !== run.current) return;
        const next: Recordings = {};
        editions.forEach((edition, index) => { const recording = found[index]; if (recording) next[edition] = recording; });
        const data = next[chosenEdition.current] ?? next.regular;
        if (!data) {
          pendingPlay.current = null; sessionOpen.current = false; setOpen(false); return;
        }
        recordingsRef.current = next; setRecordings(next);
        audioRef.current = data; setAudio(data);
        pendingPlay.current = null;
        if (sessionOpen.current) installPlayer(data, continuePlaying ? 0 : null);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          pendingPlay.current = null;
          setError("Couldn't load narration. Check your connection and try again.");
        }
      });
    return () => controller.abort();
  }, [options.book, options.chapter, options.enabled, retry, installPlayer, releasePlayer]);

  useEffect(() => {
    const item = player.current;
    if (item?.isLoaded) item.setPlaybackRate(rate, "high");
  }, [rate, ready]);
  useEffect(() => () => { run.current++; playOperation.current++; sessionOpen.current = false; releasePlayer(); }, [releasePlayer]);

  const play = useCallback(async (fromVerse = 0, edition?: AudioEdition) => {
    markAction(); setError(null); setStillListeningPrompt(false);
    const picked = edition ? recordingsRef.current[edition] : undefined;
    if (edition && picked) { chosenEdition.current = edition; audioRef.current = picked; setAudio(picked); }
    const recording = audioRef.current;
    if (!recording) { setRetry(count => count + 1); return; }
    const generation = run.current; const operation = ++playOperation.current;
    try {
      await setAudioModeAsync({ playsInSilentMode: true, interruptionMode: "doNotMix", shouldPlayInBackground: true });
      if (generation !== run.current || operation !== playOperation.current || audioRef.current !== recording) return;
      sessionOpen.current = true; setOpen(true); installPlayer(recording, fromVerse);
    } catch { if (generation === run.current) setError("Couldn't play narration. Try again."); }
  }, [installPlayer, markAction]);
  const stop = useCallback(() => {
    playOperation.current++; markAction(); sessionOpen.current = false; pendingPlay.current = null;
    releasePlayer(); setOpen(false); setPlaying(false); setReady(false); setStillListeningPrompt(false);
  }, [markAction, releasePlayer]);
  const toggle = useCallback(() => {
    markAction(); const item = player.current;
    if (!item?.isLoaded || error || finishedPlayer.current === item.id) { void play(); return; }
    if (stillListeningPrompt) return;
    if (item.playing) item.pause(); else item.play();
  }, [error, markAction, play, stillListeningPrompt]);
  const seek = useCallback((seconds: number) => {
    markAction(); const item = player.current; const recording = audioRef.current;
    if (item?.isLoaded && recording) void item.seekTo(Math.max(0, Math.min(recording.duration, seconds)));
  }, [markAction]);
  const verse = audio && ready ? verseAt(audio.verses, elapsed) : null;
  const editions = useMemo(() => LISTEN_ORDER.filter(edition => recordings[edition]), [recordings]);
  return {
    available: !!audio, open, playing, ready, verse, audio, error, stillListeningPrompt, elapsed, rate,
    /** The recordings this chapter has, in LISTEN_ORDER (Alive first); two means Listen asks which. */
    editions,
    edition: (audio?.edition ?? "regular") as AudioEdition,
    /** The text this chapter's Alive recording reads; null when it has none. */
    aliveText: recordings.alive ? recordings.alive.text ?? "LC Greek" : null,
    play, stop, toggle, seek, markAction,
    retryLoad: () => setRetry(count => count + 1),
    skipVerse: (delta: -1 | 1) => {
      const target = audio ? adjacentVerse(audio.verses, verse, delta) : null;
      if (audio && target !== null) seek(verseStart(audio.verses, target));
    },
    cycleRate: () => { markAction(); setListenRate(nextListenRate(rate)); },
    keepListening: () => { markAction(); setStillListeningPrompt(false); if (player.current?.isLoaded) player.current.play(); },
  };
}

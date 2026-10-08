import { useCallback, useEffect, useRef, useState } from "react";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer, type AudioStatus } from "expo-audio";
import { API_URL } from "@/lib/api";
import { setListenRate, useSettings } from "@/features/settings/settingsStore";
import { nextListenRate } from "@/features/cross/listen";
import { hasNarration, needsStillListening, verseAt, verseStart, type ChapterAudio } from "./audioBible";

/** One active native player. Each chapter gets a distinct player identity so
 * a queued finish or error event from the old source cannot affect the new one. */
export function useChapterAudio(options: {
  book: number; chapter: number; reference: string; enabled: boolean;
  onChapterEnd: () => void; nextNarrated: boolean;
}) {
  const { listenRate: rate } = useSettings();
  const [audio, setAudio] = useState<ChapterAudio | null>(null);
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
      title: latest.current.options.reference, artist: "SureWord · KJV",
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
    releasePlayer(); audioRef.current = null;
    setAudio(null); setReady(false); setPlaying(false); setElapsed(0); setError(null); setStillListeningPrompt(false);
    if (!options.enabled || !hasNarration(options.book)) {
      pendingPlay.current = null; sessionOpen.current = false; setOpen(false);
      return () => controller.abort();
    }
    void fetch(`${API_URL}/api/bible/audio?book=${options.book}&chapter=${options.chapter}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Narration unavailable");
        return await response.json() as ChapterAudio | { status: "unavailable" };
      })
      .then(data => {
        if (controller.signal.aborted || generation !== run.current) return;
        if (data.status !== "ready" || data.book !== options.book || data.chapter !== options.chapter) {
          pendingPlay.current = null; sessionOpen.current = false; setOpen(false); return;
        }
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

  const play = useCallback(async (fromVerse = 0) => {
    markAction(); setError(null); setStillListeningPrompt(false);
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
  return {
    available: !!audio, open, playing, ready, verse, audio, error, stillListeningPrompt, elapsed, rate,
    play, stop, toggle, seek, markAction,
    retryLoad: () => setRetry(count => count + 1),
    skipVerse: (delta: -1 | 1) => {
      if (!audio) return;
      seek(verseStart(audio.verses, Math.max(1, Math.min(audio.verses.length, (verse ?? 1) + delta))));
    },
    cycleRate: () => { markAction(); setListenRate(nextListenRate(rate)); },
    keepListening: () => { markAction(); setStillListeningPrompt(false); if (player.current?.isLoaded) player.current.play(); },
  };
}

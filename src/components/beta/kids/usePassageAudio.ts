"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { verseAt, verseStart, type ChapterAudio, type ChapterAudioResponse } from "@/lib/bible/audioBible";
import { verseKey, type KidsSegment, type KidsVerseKey } from "@/lib/beta/kids/kids-rules";

export interface PassageAudio {
	/** "ready" once every chapter of the passage has narration with verse timings. */
	status: "loading" | "ready" | "unavailable";
	playing: boolean;
	/** The verse being read ("17:49"), for the read-along highlight. */
	current: KidsVerseKey | null;
	toggle: () => void;
	stop: () => void;
}

/**
 * Plays an adventure's passage from the audio Bible (src/lib/bible/audioBible.ts):
 * the same pre-rendered chapter MP3s and verse timings the reader's Listen
 * uses, from `/api/bible/audio`, nothing generated. Only the passage's verses
 * are played: each segment starts at its first verse and stops at the end of
 * its last, then the next segment follows on the same element, so a passage
 * across chapters (Noah, Joseph, Jonah) plays straight through.
 *
 * Every chapter's timings are fetched when the adventure opens, so pressing
 * play starts the audio inside the tap (iOS refuses a play() that waits on a
 * fetch).
 */
export function usePassageAudio(book: number, segments: readonly KidsSegment[]): PassageAudio {
	const element = useRef<HTMLAudioElement | null>(null);
	const recordings = useRef(new Map<number, ChapterAudio>());
	const segmentIndex = useRef(0);
	/** A play-through is under way (paused or not); false before the start and after the end. */
	const inProgress = useRef(false);
	const [status, setStatus] = useState<PassageAudio["status"]>("loading");
	const [playing, setPlaying] = useState(false);
	const [current, setCurrent] = useState<KidsVerseKey | null>(null);
	const segmentsRef = useRef(segments);
	segmentsRef.current = segments;

	const startSegment = useCallback((index: number) => {
		const audio = element.current;
		const segment = segmentsRef.current[index];
		const recording = segment ? recordings.current.get(segment.chapter) : undefined;
		if (!audio || !segment || !recording) return;
		segmentIndex.current = index;
		inProgress.current = true;
		if (audio.getAttribute("src") !== recording.audioUrl) audio.src = recording.audioUrl;
		const at = verseStart(recording.verses, segment.from);
		// iOS Safari can ignore a seek made straight after `src` changes.
		if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) audio.currentTime = at;
		else audio.addEventListener("loadedmetadata", () => { audio.currentTime = at; }, { once: true });
		void audio.play().catch(() => setPlaying(false));
	}, []);

	const stop = useCallback(() => {
		element.current?.pause();
		segmentIndex.current = 0;
		inProgress.current = false;
		setCurrent(null);
	}, []);

	useEffect(() => {
		const controller = new AbortController();
		const chapters = [...new Set(segments.map((segment) => segment.chapter))];
		setStatus("loading");
		recordings.current = new Map();
		Promise.all(
			chapters.map(async (chapter) => {
				const response = await fetch(`/api/bible/audio?book=${book}&chapter=${chapter}`, { signal: controller.signal });
				const body = response.ok ? ((await response.json()) as ChapterAudioResponse) : null;
				return body?.status === "ready" ? body : null;
			}),
		)
			.then((found) => {
				if (controller.signal.aborted) return;
				if (found.some((recording) => !recording)) return setStatus("unavailable");
				for (const recording of found) if (recording) recordings.current.set(recording.chapter, recording);
				setStatus("ready");
			})
			.catch(() => {
				if (!controller.signal.aborted) setStatus("unavailable");
			});
		return () => controller.abort();
	}, [book, segments]);

	useEffect(() => {
		const audio = new Audio();
		audio.preload = "none";
		element.current = audio;
		let frame = 0;
		/** Where the passage is: the verse to highlight, and whether this segment has ended. */
		const check = () => {
			// Once a play-through has ended (or before one starts) the playhead sits past the first
			// segment's end, and acting on it would start the passage over.
			if (!inProgress.current) return;
			const segment = segmentsRef.current[segmentIndex.current];
			const recording = segment ? recordings.current.get(segment.chapter) : undefined;
			if (!segment || !recording) return;
			const end = recording.verses.find((timing) => timing.verse === segment.to)?.end ?? recording.duration;
			if (audio.currentTime >= end || audio.ended) {
				const next = segmentIndex.current + 1;
				if (next < segmentsRef.current.length) startSegment(next);
				else {
					audio.pause();
					segmentIndex.current = 0;
					inProgress.current = false;
					setCurrent(null);
				}
				return;
			}
			const verse = verseAt(recording.verses, audio.currentTime);
			setCurrent(verse !== null && verse >= segment.from && verse <= segment.to ? verseKey(segment.chapter, verse) : null);
		};
		// timeupdate keeps going with the screen off; the frame loop stops a segment on its last word while it is on.
		const tick = () => {
			check();
			frame = requestAnimationFrame(tick);
		};
		const onPlay = () => {
			setPlaying(true);
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(tick);
		};
		const onPause = () => {
			setPlaying(false);
			cancelAnimationFrame(frame);
		};
		audio.addEventListener("play", onPlay);
		audio.addEventListener("pause", onPause);
		audio.addEventListener("timeupdate", check);
		audio.addEventListener("ended", check);
		return () => {
			cancelAnimationFrame(frame);
			audio.pause();
			audio.removeEventListener("play", onPlay);
			audio.removeEventListener("pause", onPause);
			audio.removeEventListener("timeupdate", check);
			audio.removeEventListener("ended", check);
			audio.removeAttribute("src");
			audio.load();
			element.current = null;
		};
	}, [startSegment]);

	const toggle = useCallback(() => {
		const audio = element.current;
		if (!audio || status !== "ready") return;
		if (!audio.paused) return audio.pause();
		// Resume where it paused; after the end (or before the start) begin again.
		if (inProgress.current) void audio.play().catch(() => setPlaying(false));
		else startSegment(0);
	}, [startSegment, status]);

	return { status, playing, current, toggle, stop };
}

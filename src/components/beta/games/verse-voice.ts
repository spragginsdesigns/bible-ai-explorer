"use client";

import { useCallback, useEffect, useRef } from "react";
import type { ChapterAudioResponse, VerseTiming } from "@/lib/bible/audioBible";

/**
 * The cast speaking a verse of the chapter during a game (LC-17851): the
 * verse is played out of the chapter's existing recording (Matthew is the
 * full-cast KJV production, src/lib/bible/audioBible.ts), from its start to
 * its end, so every word heard is the KJV on screen and nothing is generated
 * when someone plays. `say` must first be called from a tap or key press
 * (the Start press), which unlocks the one audio element for the round's
 * later lines on phones.
 */
export function useVerseVoice(book: number, chapter: number, muted: boolean) {
	const audio = useRef<HTMLAudioElement | null>(null);
	const timings = useRef<VerseTiming[] | null>(null);
	const stopAt = useRef<number | null>(null);
	const watch = useRef<number | null>(null);
	const mutedRef = useRef(muted);
	mutedRef.current = muted;

	useEffect(() => {
		let live = true;
		fetch(`/api/bible/audio?book=${book}&chapter=${chapter}`)
			.then((response) => (response.ok ? (response.json() as Promise<ChapterAudioResponse>) : null))
			.then((data) => {
				if (!live || !data || data.status !== "ready") return;
				timings.current = data.verses;
				const element = new Audio();
				element.preload = "metadata";
				element.src = data.audioUrl;
				audio.current = element;
			})
			.catch(() => {});
		return () => {
			live = false;
			if (watch.current) window.clearInterval(watch.current);
			audio.current?.pause();
			audio.current = null;
		};
	}, [book, chapter]);

	const stop = useCallback(() => {
		if (watch.current) window.clearInterval(watch.current);
		watch.current = null;
		stopAt.current = null;
		audio.current?.pause();
	}, []);

	useEffect(() => {
		if (muted) stop();
	}, [muted, stop]);

	const say = useCallback(
		(verse: number) => {
			const element = audio.current;
			const timing = timings.current?.find((item) => item.verse === verse);
			if (!element || !timing || mutedRef.current) return;
			stop();
			stopAt.current = timing.end;
			const seek = () => {
				try {
					element.currentTime = timing.start;
				} catch {
					/* not seekable yet: loadedmetadata seeks */
				}
			};
			if (element.readyState >= 1) {
				seek();
				element.muted = false;
			} else {
				// Not loaded yet: start silent so the chapter's opening is never heard, and unmute once on the verse.
				element.muted = true;
				element.addEventListener("loadedmetadata", seek, { once: true });
				element.addEventListener("seeked", () => (element.muted = false), { once: true });
			}
			void element.play().catch(() => {});
			watch.current = window.setInterval(() => {
				if (stopAt.current !== null && element.currentTime >= stopAt.current) stop();
			}, 50);
		},
		[stop],
	);

	return { say, stop };
}

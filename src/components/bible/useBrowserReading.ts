"use client";
import { useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import {
	SESSION_IDLE_MS,
	VerseDwellTracker,
} from "../../../mobile/src/features/reading/readingLogCore";
import { recordBrowserReading, touchBrowserReading } from "./readingLogClient";
/** Visibility and one-shot dwell only: no scroll polling, background intervals or unload-only save. */
export function useBrowserReading(input: {
	book: number;
	chapter: number;
	translation: string;
	verseCount: number;
	ready: boolean;
	obscured: boolean;
}) {
	const { userId } = useAuth();
	const { book, chapter, translation, verseCount, ready, obscured } = input;
	useEffect(() => {
		if (!userId || !ready || obscured) return;
		const dwell = new VerseDwellTracker();
		const visible = new Set<number>();
		let timer: ReturnType<typeof setTimeout> | null = null;
		let lastActivity = 0;
		let disposed = false;
		const active = () =>
			!disposed &&
			document.visibilityState === "visible" &&
			document.hasFocus();
		const cancel = () => {
			if (timer) clearTimeout(timer);
			timer = null;
		};
		const arm = () => {
			cancel();
			if (!active()) return;
			const now = performance.now();
			if (now - lastActivity >= SESSION_IDLE_MS) dwell.reset();
			lastActivity = now;
			dwell.update([...visible], now);
			const delay = dwell.nextDelay(now);
			if (delay === null) return;
			timer = setTimeout(() => {
				timer = null;
				if (!active()) return;
				const verses = dwell.due(performance.now());
				if (verses.length)
					void recordBrowserReading(userId, {
						book, chapter, translation, verseCount,
						verses,
						now: Date.now(),
						timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
					}).catch(() => dwell.reset());
				arm();
			}, delay);
		};
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					const verse = Number(
						(entry.target as HTMLElement).dataset.readingVerse
					);
					const enough =
						entry.isIntersecting &&
						(entry.intersectionRatio >= 0.6 ||
							entry.intersectionRect.height >= window.innerHeight * 0.35);
					if (enough) visible.add(verse);
					else visible.delete(verse);
				}
				arm();
				if (active()) touchBrowserReading(userId);
			},
			{
				threshold: [0, 0.1, 0.2, 0.35, 0.6, 1],
				rootMargin: "-100px 0px -90px 0px",
			}
		);
		document
			.querySelectorAll("[data-reading-verse]")
			.forEach((element) => observer.observe(element));
		const visibility = () => {
			if (active()) arm();
			else {
				cancel();
				dwell.pause();
			}
		};
		const activity = () => {
			if (active()) {
				arm();
				touchBrowserReading(userId);
			}
		};
		window.addEventListener("focus", visibility);
		window.addEventListener("blur", visibility);
		document.addEventListener("visibilitychange", visibility);
		window.addEventListener("pointerdown", activity, { passive: true });
		window.addEventListener("keydown", activity);
		return () => {
			disposed = true;
			cancel();
			observer.disconnect();
			window.removeEventListener("focus", visibility);
			window.removeEventListener("blur", visibility);
			document.removeEventListener("visibilitychange", visibility);
			window.removeEventListener("pointerdown", activity);
			window.removeEventListener("keydown", activity);
		};
	}, [
		userId,
		book,
		chapter,
		translation,
		verseCount,
		ready,
		obscured,
	]);
}

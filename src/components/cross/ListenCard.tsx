"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import TimelineStop from "@/components/cross/TimelineStop";
import {
	DEFAULT_LISTEN_RATE,
	LISTEN_POLL_INTERVAL_MS,
	LISTEN_POLL_TIMEOUT_MS,
	formatClock,
	formatListenRate,
	listenPhase,
	nextListenRate,
	shouldPollListen,
	shouldRefreshListenUrl,
	type DailyCrossAudio,
} from "@/components/cross/listen";
import { readListenRatePref, writeListenRatePref } from "@/lib/preferences";

const FAILURE_TEXT = "Couldn't prepare audio - try again";

async function readAudio(init?: RequestInit): Promise<DailyCrossAudio> {
	const res = await fetch("/api/verse-of-day/audio", init);
	if (!res.ok) throw new Error(FAILURE_TEXT);
	return (await res.json()) as DailyCrossAudio;
}

/**
 * What to put in the `<audio>` element's `src`.
 *
 * Always the same-origin proxy, never the signed blob URL: Chrome's media
 * loader never loads that one (see the stream route for the finding), even
 * though `fetch` of it succeeds. Resolved against the document's origin so the
 * value is a full URL rather than a path the element resolves later, and
 * guarded for the server render, where there is no `window`.
 */
function playbackSrc(audio: DailyCrossAudio | null): string | undefined {
	if (!audio?.streamUrl) return undefined;
	if (typeof window === "undefined") return audio.streamUrl;
	return new URL(audio.streamUrl, window.location.origin).toString();
}

/**
 * "Listen" - today's "Pick Up Your Cross" as a spoken devotional.
 *
 * The narration is made WITH the day, server-side, so this card never asks for
 * one: it shimmers until the scheduled generation lands, then becomes a player
 * with a scrubber, a speed chip and a "Read along" transcript. Listen is a
 * SureWord Pro benefit, so a free account gets the locked panel instead, and a
 * server with no ElevenLabs key renders nothing at all, timeline stop included.
 * Mirrors mobile/src/features/cross/ListenCard.tsx.
 */
export default function ListenCard() {
	const audioRef = useRef<HTMLAudioElement | null>(null);
	const [audio, setAudio] = useState<DailyCrossAudio | null>(null);
	const [urlFetchedAt, setUrlFetchedAt] = useState<number | null>(null);
	const [failed, setFailed] = useState(false);
	const [transcriptOpen, setTranscriptOpen] = useState(false);
	const [playing, setPlaying] = useState(false);
	const [currentTime, setCurrentTime] = useState(0);
	const [loadedDuration, setLoadedDuration] = useState(0);
	// Seeded on mount, not at render: localStorage is not readable during the
	// server render, and a first paint that disagreed with the stored speed
	// would flicker.
	const [rate, setRate] = useState(DEFAULT_LISTEN_RATE);

	// Where to pick a listen back up after a URL refresh, and whether one has
	// already been spent on the current URL.
	const resumeAtRef = useRef(0);
	const resumePlayingRef = useRef(false);
	const refreshedRef = useRef(false);

	const phase = failed ? "failed" : listenPhase(audio);

	// The element's real duration once the file is loaded; the server's
	// word-count estimate before that, so the total never reads 0:00.
	const duration = loadedDuration > 0 ? loadedDuration : (audio?.durationSec ?? 0);

	/** Record a server payload, stamping when this client received its URL. */
	const applyAudio = useCallback((next: DailyCrossAudio) => {
		setAudio(next);
		setUrlFetchedAt(next.url ? Date.now() : null);
	}, []);

	const loadState = useCallback(async () => {
		try {
			applyAudio(await readAudio());
		} catch {
			// A failed poll is not a failed generation: the next tick retries, and
			// the poll timeout is what eventually surfaces a problem.
		}
	}, [applyAudio]);

	useEffect(() => {
		void loadState();
	}, [loadState]);

	// Seed the speed from this browser's stored preference, once.
	useEffect(() => {
		setRate(readListenRatePref());
	}, []);

	// The element is recreated whenever the source changes, and a fresh element
	// starts at 1x - so the rate is applied as an effect rather than once on
	// load, and re-applied every time either changes.
	useEffect(() => {
		if (audioRef.current) audioRef.current.playbackRate = rate;
	}, [rate, phase]);

	const cycleRate = useCallback(() => {
		setRate((current) => {
			const next = nextListenRate(current);
			writeListenRatePref(next);
			return next;
		});
	}, []);

	// Poll while a devotional is being prepared, and give up rather than
	// shimmer forever if the server never reports back.
	useEffect(() => {
		if (!shouldPollListen(phase)) return;
		const startedAt = Date.now();
		const timer = window.setInterval(() => {
			if (Date.now() - startedAt > LISTEN_POLL_TIMEOUT_MS) {
				setFailed(true);
				return;
			}
			void loadState();
		}, LISTEN_POLL_INTERVAL_MS);
		return () => window.clearInterval(timer);
	}, [phase, loadState]);

	/**
	 * The manual retry, and the only thing that ever POSTs. First generations
	 * are started server-side with the day, so this is reachable from the failed
	 * card alone.
	 */
	const retry = useCallback(async () => {
		setFailed(false);
		try {
			const result = await readAudio({ method: "POST" });
			applyAudio(result);
			if (result.status === "failed") setFailed(true);
		} catch {
			// The request itself can time out while the server is still narrating,
			// so fall back to polling rather than declaring failure here.
			void loadState();
		}
	}, [applyAudio, loadState]);

	/**
	 * Playback died. The stale-signature retry below is now belt and braces -
	 * the element plays from the same-origin proxy, whose path never expires -
	 * but a session that has gone stale behind a long-open tab lands here the
	 * same way, and re-reading the state costs one request. A URL fetched
	 * moments ago that fails is still a real failure and says so.
	 */
	const handlePlaybackError = useCallback(async () => {
		if (!shouldRefreshListenUrl(urlFetchedAt, refreshedRef.current)) {
			setFailed(true);
			return;
		}
		refreshedRef.current = true;
		resumeAtRef.current = currentTime;
		resumePlayingRef.current = playing;
		try {
			const fresh = await readAudio();
			if (fresh.status === "ready" && fresh.url) applyAudio(fresh);
			else setFailed(true);
		} catch {
			setFailed(true);
		}
	}, [urlFetchedAt, currentTime, playing, applyAudio]);

	const togglePlay = useCallback(() => {
		const element = audioRef.current;
		if (!element) return;
		if (element.paused) void element.play();
		else element.pause();
	}, []);

	const scrub = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
		const element = audioRef.current;
		const seconds = Number(event.target.value);
		setCurrentTime(seconds);
		if (element) element.currentTime = seconds;
	}, []);

	// An unconfigured server offers nothing here - not even the rail node.
	if (phase === "hidden") return null;

	// A locked benefit is shown, not hidden - but with no button, because there
	// is nowhere for one to go until billing exists.
	if (phase === "locked") {
		return (
			<TimelineStop glyph="♪" label="LISTEN">
				<div className="glass-card gradient-border flex flex-col items-center gap-2 rounded-2xl p-5">
					<span aria-hidden className="text-xl text-amber-600 dark:text-amber-400">
						🔒
					</span>
					<p className="text-center text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
						Listen is part of SureWord Pro
					</p>
					<p className="text-center text-[13.5px] leading-5 text-neutral-500 dark:text-neutral-400">
						A spoken devotional for every day&apos;s word, ready when you wake up.
						Coming soon.
					</p>
				</div>
			</TimelineStop>
		);
	}

	if (phase === "preparing") {
		return (
			<TimelineStop glyph="♪" label="LISTEN">
				<div
					aria-label="Preparing your devotional"
					className="glass-card gradient-border flex flex-col gap-2 rounded-2xl p-5"
				>
					<div className="h-3 animate-pulse rounded-full border border-amber-500/20 dark:border-amber-400/20 bg-amber-500/15 dark:bg-amber-400/15 glow-amber-sm" />
					<p className="text-center text-sm text-neutral-600 dark:text-neutral-300">
						Preparing your devotional…
					</p>
					<p className="text-center text-[12.5px] text-neutral-400 dark:text-neutral-500">
						This usually takes about a minute.
					</p>
				</div>
			</TimelineStop>
		);
	}

	if (phase === "failed") {
		return (
			<TimelineStop glyph="♪" label="LISTEN">
				<div className="glass-card gradient-border flex flex-col items-center gap-3 rounded-2xl p-5">
					<p className="text-center text-sm leading-5 text-neutral-600 dark:text-neutral-300">
						{FAILURE_TEXT}
					</p>
					<button
						type="button"
						onClick={() => void retry()}
						className="rounded-lg border border-amber-500/40 dark:border-amber-400/30 bg-amber-500/10 dark:bg-amber-400/10 px-6 py-2 text-sm font-semibold text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 dark:hover:bg-amber-400/20 transition-colors"
					>
						Try again
					</button>
				</div>
			</TimelineStop>
		);
	}

	return (
		<TimelineStop glyph="♪" label="LISTEN">
			<div className="glass-card gradient-border flex flex-col gap-3 rounded-2xl p-5">
				{audio?.title && (
					<p className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
						{audio.title}
					</p>
				)}

				{/* eslint-disable-next-line jsx-a11y/media-has-caption -- the full transcript is rendered below as "Read along". */}
				<audio
					ref={audioRef}
					src={playbackSrc(audio)}
					preload="metadata"
					onPlay={() => {
						setPlaying(true);
						// Playback works again: the next stale URL earns its own retry.
						refreshedRef.current = false;
					}}
					onPause={() => setPlaying(false)}
					onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
					onError={() => void handlePlaybackError()}
					onLoadedMetadata={(event) => {
						const element = event.currentTarget;
						const seconds = element.duration;
						setLoadedDuration(Number.isFinite(seconds) ? seconds : 0);
						// Land back where the failed URL left off.
						if (resumeAtRef.current > 0) {
							element.currentTime = resumeAtRef.current;
							setCurrentTime(resumeAtRef.current);
							resumeAtRef.current = 0;
							if (resumePlayingRef.current) {
								resumePlayingRef.current = false;
								void element.play();
							}
						}
					}}
					onEnded={() => {
						setPlaying(false);
						setCurrentTime(0);
						if (audioRef.current) audioRef.current.currentTime = 0;
					}}
					className="hidden"
				/>

				<div className="flex items-center gap-3">
					<button
						type="button"
						onClick={togglePlay}
						aria-label={playing ? "Pause devotional" : "Play devotional"}
						className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-amber-500/40 dark:border-amber-400/30 bg-amber-500/10 dark:bg-amber-400/10 text-base font-bold text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 dark:hover:bg-amber-400/20 transition-colors"
					>
						{playing ? "❙❙" : "▶"}
					</button>

					<div className="flex flex-1 flex-col gap-1.5">
						<input
							type="range"
							min={0}
							max={duration || 0}
							step={0.1}
							value={Math.min(currentTime, duration || 0)}
							onChange={scrub}
							aria-label="Devotional position"
							aria-valuetext={`${formatClock(currentTime)} of ${formatClock(duration)}`}
							// `accent-color` paints the filled part of the track and the
							// thumb in the reader's gold, in both themes, with no
							// browser-specific pseudo-element CSS to keep in sync.
							className="h-1 w-full cursor-pointer rounded-full accent-amber-600 dark:accent-amber-400"
						/>
						<div className="flex justify-between text-xs tabular-nums text-neutral-400 dark:text-neutral-500">
							{/* Real seconds at every speed - the clock reports the file, not the pace. */}
							<span>{formatClock(currentTime)}</span>
							<span>{formatClock(duration)}</span>
						</div>
					</div>

					<button
						type="button"
						onClick={cycleRate}
						aria-label={`Playback speed ${formatListenRate(rate)}, tap to change`}
						className="h-9 w-14 shrink-0 rounded-full border border-amber-500/40 dark:border-amber-400/30 bg-amber-500/10 dark:bg-amber-400/10 text-[13px] font-bold tabular-nums text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 dark:hover:bg-amber-400/20 transition-colors"
					>
						{formatListenRate(rate)}
					</button>
				</div>

				{audio?.script && (
					<>
						<button
							type="button"
							onClick={() => setTranscriptOpen((open) => !open)}
							className="self-start text-[13px] font-semibold text-amber-700/70 dark:text-amber-500/70 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
						>
							{transcriptOpen ? "Hide transcript ▴" : "Read along ▾"}
						</button>
						{transcriptOpen && (
							<p className="whitespace-pre-line text-[14.5px] leading-[23px] text-neutral-700 dark:text-neutral-300">
								{audio.script}
							</p>
						)}
					</>
				)}
			</div>
		</TimelineStop>
	);
}

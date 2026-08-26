"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
	LISTEN_POLL_INTERVAL_MS,
	LISTEN_POLL_TIMEOUT_MS,
	formatClock,
	listenPhase,
	shouldPollListen,
	type DailyCrossAudio,
} from "@/components/cross/listen";

const FAILURE_TEXT = "Couldn't prepare audio - try again";

async function readAudio(init?: RequestInit): Promise<DailyCrossAudio> {
	const res = await fetch("/api/verse-of-day/audio", init);
	if (!res.ok) throw new Error(FAILURE_TEXT);
	return (await res.json()) as DailyCrossAudio;
}

/**
 * "Listen" - today's "Pick Up Your Cross" as a spoken devotional.
 *
 * Nothing is generated until the first click (every narration is billed per
 * character), so the card opens as an invitation, shimmers through the ~30-60s
 * it takes to write and narrate, then becomes a player with a scrubber and a
 * "Read along" transcript. Mirrors mobile/src/features/cross/ListenCard.tsx.
 */
export default function ListenCard() {
	const audioRef = useRef<HTMLAudioElement | null>(null);
	const [audio, setAudio] = useState<DailyCrossAudio | null>(null);
	const [requested, setRequested] = useState(false);
	const [failed, setFailed] = useState(false);
	const [transcriptOpen, setTranscriptOpen] = useState(false);
	const [playing, setPlaying] = useState(false);
	const [currentTime, setCurrentTime] = useState(0);
	const [loadedDuration, setLoadedDuration] = useState(0);

	const phase = failed ? "failed" : listenPhase(audio, requested);

	// The element's real duration once the file is loaded; the server's
	// word-count estimate before that, so the total never reads 0:00.
	const duration = loadedDuration > 0 ? loadedDuration : (audio?.durationSec ?? 0);

	const loadState = useCallback(async () => {
		try {
			setAudio(await readAudio());
		} catch {
			// A failed poll is not a failed generation: the next tick retries, and
			// the poll timeout is what eventually surfaces a problem.
		}
	}, []);

	useEffect(() => {
		void loadState();
	}, [loadState]);

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

	const prepare = useCallback(async () => {
		setFailed(false);
		setRequested(true);
		try {
			const result = await readAudio({ method: "POST" });
			setAudio(result);
			if (result.status === "failed") setFailed(true);
		} catch {
			// The request itself can time out while the server is still narrating,
			// so fall back to polling rather than declaring failure here.
			void loadState();
		}
	}, [loadState]);

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

	const estimate = audio?.durationSec
		? `About ${Math.max(1, Math.round(audio.durationSec / 60))} minutes`
		: "A spoken devotional on today's verse";

	if (phase === "idle") {
		return (
			<div className="glass-card gradient-border flex flex-col gap-3 rounded-2xl p-5">
				<button
					type="button"
					onClick={() => void prepare()}
					className="flex min-h-12 w-full items-center justify-center rounded-xl border border-amber-500/40 dark:border-amber-400/30 bg-amber-500/10 dark:bg-amber-400/10 text-[15px] font-bold text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 dark:hover:bg-amber-400/20 transition-colors"
				>
					▶ Listen to today&apos;s word
				</button>
				<p className="text-center text-[13px] text-neutral-400 dark:text-neutral-500">{estimate}</p>
			</div>
		);
	}

	if (phase === "preparing") {
		return (
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
		);
	}

	if (phase === "failed") {
		return (
			<div className="glass-card gradient-border flex flex-col items-center gap-3 rounded-2xl p-5">
				<p className="text-center text-sm leading-5 text-neutral-600 dark:text-neutral-300">
					{FAILURE_TEXT}
				</p>
				<button
					type="button"
					onClick={() => void prepare()}
					className="rounded-lg border border-amber-500/40 dark:border-amber-400/30 bg-amber-500/10 dark:bg-amber-400/10 px-6 py-2 text-sm font-semibold text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 dark:hover:bg-amber-400/20 transition-colors"
				>
					Try again
				</button>
			</div>
		);
	}

	return (
		<div className="glass-card gradient-border flex flex-col gap-3 rounded-2xl p-5">
			{audio?.title && (
				<p className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
					{audio.title}
				</p>
			)}

			{/* eslint-disable-next-line jsx-a11y/media-has-caption -- the full transcript is rendered below as "Read along". */}
			<audio
				ref={audioRef}
				src={audio?.url ?? undefined}
				preload="metadata"
				onPlay={() => setPlaying(true)}
				onPause={() => setPlaying(false)}
				onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
				onLoadedMetadata={(event) => {
					const seconds = event.currentTarget.duration;
					setLoadedDuration(Number.isFinite(seconds) ? seconds : 0);
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
						<span>{formatClock(currentTime)}</span>
						<span>{formatClock(duration)}</span>
					</div>
				</div>
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
	);
}

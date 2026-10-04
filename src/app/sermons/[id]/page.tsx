"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

interface SermonSection {
	heading: string;
	startMs: number;
	pastorQuote: string | null;
	passage: string | null;
	passageText: { verse: number; text: string }[] | null;
	explanation: string;
	reflection: string;
	imageUrl: string | null;
}

interface SermonStudyDetail {
	id: string;
	videoId: string;
	title: string;
	serviceTitle: string;
	serviceDate: string | null;
	preacher: string | null;
	preachingText: string | null;
	bigIdea: string;
	summary: string;
	application: string;
	prayer: string;
	sections: SermonSection[];
	sermonStartMs: number | null;
	/** The first section's picture, chosen by the API as the study's hero. */
	imageUrl: string | null;
}

const watchUrl = (videoId: string, atMs?: number | null) =>
	`https://www.youtube.com/watch?v=${videoId}${
		typeof atMs === "number" ? `&t=${Math.floor(atMs / 1000)}s` : ""
	}`;

function timestamp(ms: number): string {
	const total = Math.max(0, Math.round(ms / 1000));
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = String(total % 60).padStart(2, "0");
	return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

function Verses({ verses }: { verses: { verse: number; text: string }[] }) {
	return (
		<div className="rounded-xl border border-black/[0.08] bg-black/[0.03] px-4 py-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
			{verses.map((v) => (
				<p key={v.verse} className="text-neutral-800 dark:text-neutral-200">
					<span className="mr-1 align-super text-metadata font-bold text-amber-600 dark:text-amber-400">
						{v.verse}
					</span>
					{v.text}
				</p>
			))}
		</div>
	);
}

/**
 * One guided study. The two visual rules that matter doctrinally: a quote is
 * shown as the preacher's own words and nothing else is attributed to him, and
 * SureWord's teaching carries its own label so no reader can mistake it for
 * something said from the pulpit.
 *
 * The bar at the foot is the Android dock (`mobile/app/(app)/bible/sermon.tsx`)
 * in web form: the recording on the left, chat on the right. Ask carries the
 * study's title as an ordinary question - the assistant reads the study itself
 * with its own getSermonStudy tool, so there is no hidden payload here that
 * could fall out of step with the server.
 */
export default function SermonStudyPage() {
	const params = useParams<{ id: string }>();
	const [study, setStudy] = useState<SermonStudyDetail | null>(null);
	const [error, setError] = useState<string | null>(null);

	const id = params?.id;
	const sequence = useRef(0);
	const loaded = useRef(false);

	// Mirrors Android's useFocusEffect load: on mount, on "Try again", and when
	// the window regains focus. A refresh that fails after the study is already
	// on screen leaves it there rather than swapping in the error card.
	const load = useCallback(() => {
		if (!id) return;
		const request = ++sequence.current;
		setError(null);
		fetch(`/api/sermon-studies/${id}`)
			.then((res) =>
				res.ok ? res.json() : Promise.reject(new Error(res.status === 404 ? "404" : "failed"))
			)
			.then((data: { study: SermonStudyDetail }) => {
				if (request !== sequence.current) return;
				loaded.current = true;
				setStudy(data.study);
			})
			.catch((err: Error) => {
				if (request !== sequence.current) return;
				if (err.message === "404") {
					setStudy(null);
					setError("not-found");
				} else if (!loaded.current) {
					setError("failed");
				}
			});
	}, [id]);

	useEffect(() => {
		loaded.current = false;
		setStudy(null);
		load();
		const onVisibility = () => {
			if (document.visibilityState === "visible") load();
		};
		window.addEventListener("focus", load);
		document.addEventListener("visibilitychange", onVisibility);
		// Unmounting supersedes whatever is still in flight.
		const requests = sequence;
		return () => {
			requests.current++;
			window.removeEventListener("focus", load);
			document.removeEventListener("visibilitychange", onVisibility);
		};
	}, [load]);

	if (error) {
		return (
			<main className="mx-auto w-full max-w-3xl px-5 pt-6 pb-28 sm:px-8 lg:pt-10 lg:pb-10">
				<Link
					href="/sermons"
					className="text-metadata font-bold uppercase tracking-[0.12em] text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300"
				>
					‹ Sermon studies
				</Link>
				<div className="mt-4 rounded-2xl border border-black/[0.08] bg-black/[0.03] px-5 py-4 dark:border-white/[0.06] dark:bg-white/[0.03]">
					<p role="alert" className="text-neutral-600 dark:text-neutral-300">
						{error === "not-found" ? "That study is not available." : "Could not load this study."}
					</p>
					{error !== "not-found" && (
						<button
							type="button"
							onClick={load}
							className="mt-1 min-h-[40px] text-sm font-semibold text-amber-600 dark:text-amber-400"
						>
							Try again
						</button>
					)}
				</div>
			</main>
		);
	}

	if (!study) {
		return (
			<main className="mx-auto w-full max-w-3xl px-5 pt-6 pb-28 sm:px-8 lg:pt-10 lg:pb-10">
				<div className="h-64 animate-pulse rounded-2xl border border-black/[0.08] bg-black/[0.03] dark:border-white/[0.06] dark:bg-white/[0.03]" />
			</main>
		);
	}

	const hero = study.imageUrl;
	const askHref = `/?prompt=${encodeURIComponent(`Let's talk about the sermon study "${study.title}".`)}`;

	return (
		<main className="mx-auto w-full max-w-3xl px-5 pt-6 pb-28 sm:px-8 lg:pt-10 lg:pb-10">
			<Link
				href="/sermons"
				className="text-metadata font-bold uppercase tracking-[0.12em] text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300"
			>
				‹ Sermon studies
			</Link>

			{hero && (
				// eslint-disable-next-line @next/next/no-img-element
				<img
					src={hero}
					alt=""
					className="mt-4 aspect-[3/2] w-full rounded-2xl object-cover"
				/>
			)}

			<h1 className="mt-5 text-3xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">
				{study.title}
			</h1>
			<p className="mt-2 text-lg italic text-neutral-700 dark:text-neutral-300">{study.bigIdea}</p>

			<p className="mt-3 text-metadata text-neutral-500 dark:text-neutral-400">
				{[study.serviceTitle, study.preacher, study.serviceDate].filter(Boolean).join(" · ")}
			</p>
			<p className="mt-1 text-sm font-bold text-amber-600 dark:text-amber-400">
				{study.preachingText}
			</p>

			<a
				href={watchUrl(study.videoId, study.sermonStartMs)}
				target="_blank"
				rel="noreferrer"
				className="mt-4 inline-flex items-center gap-2 rounded-full border border-black/[0.08] bg-black/[0.03] px-4 py-2 text-sm font-medium text-neutral-800 transition-colors hover:bg-black/[0.06] dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-neutral-100 dark:hover:bg-white/[0.06]"
			>
				Watch the service
			</a>

			<p className="mt-6 text-neutral-700 dark:text-neutral-200">{study.summary}</p>

			{study.sections.map((section, index) => (
				<section key={`${section.heading}-${index}`} className="mt-10">
					<h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-50">
						{index + 1}. {section.heading}
					</h2>

					<a
						href={watchUrl(study.videoId, section.startMs)}
						target="_blank"
						rel="noreferrer"
						className="mt-1 inline-block text-metadata text-amber-600 hover:underline dark:text-amber-400"
					>
						Watch from {timestamp(section.startMs)}
					</a>

					{section.imageUrl && index > 0 && section.imageUrl !== hero && (
						// eslint-disable-next-line @next/next/no-img-element
						<img
							src={section.imageUrl}
							alt=""
							className="mt-4 aspect-[3/2] w-full rounded-2xl object-cover"
							loading="lazy"
						/>
					)}

					{section.pastorQuote && (
						<blockquote className="mt-4 border-l-2 border-amber-500/60 pl-4">
							<p className="text-neutral-800 dark:text-neutral-100">{section.pastorQuote}</p>
							<footer className="mt-1 text-metadata font-bold uppercase tracking-[0.08em] text-neutral-400 dark:text-neutral-500">
								What was preached
							</footer>
						</blockquote>
					)}

					{section.passage && section.passageText && (
						<div className="mt-4">
							<p className="mb-1 text-sm font-bold text-amber-600 dark:text-amber-400">
								{section.passage}
							</p>
							<Verses verses={section.passageText} />
						</div>
					)}

					<div className="mt-4">
						<p className="text-metadata font-bold uppercase tracking-[0.08em] text-neutral-400 dark:text-neutral-500">
							SureWord&rsquo;s teaching
						</p>
						<p className="mt-1 text-neutral-700 dark:text-neutral-200">{section.explanation}</p>
					</div>

					<p className="mt-4 rounded-xl border border-black/[0.08] bg-black/[0.03] px-4 py-3 text-neutral-800 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-neutral-100">
						<span className="font-semibold">Consider: </span>
						{section.reflection}
					</p>
				</section>
			))}

			<section className="mt-12">
				<h2 className="text-sm font-bold uppercase tracking-[0.1em] text-amber-600 dark:text-amber-400">
					This week
				</h2>
				<p className="mt-2 text-neutral-700 dark:text-neutral-200">{study.application}</p>
			</section>

			<section className="mt-8 mb-10">
				<h2 className="text-sm font-bold uppercase tracking-[0.1em] text-amber-600 dark:text-amber-400">
					Prayer
				</h2>
				<p className="mt-2 text-neutral-700 dark:text-neutral-200">{study.prayer}</p>
			</section>

			<div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] -mx-5 lg:bottom-0 flex items-center gap-3 border-t border-black/[0.08] bg-background/90 px-5 py-3 backdrop-blur sm:-mx-8 sm:px-8 dark:border-white/[0.08]">
				<a
					href={watchUrl(study.videoId, study.sermonStartMs)}
					target="_blank"
					rel="noreferrer"
					className="flex flex-1 items-center justify-center gap-2 rounded-full bg-black/[0.04] px-4 py-3 text-sm font-semibold text-neutral-800 transition-colors hover:bg-black/[0.08] dark:bg-white/[0.06] dark:text-neutral-100 dark:hover:bg-white/[0.1]"
				>
					Watch the service
				</a>
				<Link
					href={askHref}
					aria-label={`Ask AI about ${study.title}`}
					className="flex items-center gap-2 rounded-full px-4 py-3 text-sm font-semibold text-neutral-600 transition-colors hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-50"
				>
					<span aria-hidden>✦</span> Ask AI
				</Link>
			</div>
		</main>
	);
}

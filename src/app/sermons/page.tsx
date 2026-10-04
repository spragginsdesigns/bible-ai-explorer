"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

interface SermonStudySummary {
	id: string;
	videoId: string;
	title: string;
	serviceTitle: string;
	serviceDate: string | null;
	preacher: string | null;
	preachingText: string | null;
	bigIdea: string;
	imageUrl: string | null;
}

function formatDate(date: string | null): string | null {
	if (!date) return null;
	const parsed = new Date(`${date}T12:00:00Z`);
	if (Number.isNaN(parsed.getTime())) return null;
	return parsed.toLocaleDateString(undefined, {
		weekday: "long",
		month: "long",
		day: "numeric",
	});
}

/**
 * Guided studies of the reader's own church services. The list is empty for
 * anyone whose church has no ingest wired up, and the empty state says so
 * plainly rather than implying something is broken.
 */
export default function SermonsPage() {
	const [studies, setStudies] = useState<SermonStudySummary[] | null>(null);
	const [failed, setFailed] = useState(false);
	const [busy, setBusy] = useState(true);
	const sequence = useRef(0);

	// Mirrors Android's useFocusEffect load: runs on mount, on "Try again", and
	// whenever the window regains focus, so a study processed while the tab sat
	// in the background shows up without a manual refresh. A newer request
	// supersedes an older one so a slow response cannot overwrite a fresh list.
	const load = useCallback(() => {
		const request = ++sequence.current;
		setBusy(true);
		setFailed(false);
		fetch("/api/sermon-studies")
			.then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
			.then((data: { studies?: SermonStudySummary[] }) => {
				if (request === sequence.current) setStudies(data.studies ?? []);
			})
			.catch(() => {
				if (request === sequence.current) setFailed(true);
			})
			.finally(() => {
				if (request === sequence.current) setBusy(false);
			});
	}, []);

	useEffect(() => {
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

	// A failed background refresh keeps the list the reader already has; the
	// error card only replaces the page when there is nothing to show.
	const showError = failed && !studies?.length;

	return (
		<main className="mx-auto w-full max-w-3xl px-5 pt-6 pb-28 sm:px-8 lg:pt-10 lg:pb-10">
			<Link
				href="/bible"
				className="inline-block min-h-[40px] pt-2 text-[15px] font-semibold text-amber-600 dark:text-amber-400"
			>
				‹ Bible
			</Link>
			<header className="mt-2 mb-8">
				<p className="text-metadata font-bold uppercase tracking-[0.14em] text-amber-600 dark:text-amber-400">
					From your church
				</p>
				<h1 className="mt-2 text-3xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">
					Sermon studies
				</h1>
				<p className="mt-2 max-w-prose text-neutral-600 dark:text-neutral-300">
					A guided walk through each recorded service, so you can follow the message even when
					you could not be there.
				</p>
			</header>

			{showError && (
				<div className="rounded-2xl border border-black/[0.08] bg-black/[0.03] px-5 py-4 dark:border-white/[0.06] dark:bg-white/[0.03]">
					<p role="alert" className="text-neutral-600 dark:text-neutral-300">
						Could not load your sermon studies.
					</p>
					<button
						type="button"
						onClick={load}
						disabled={busy}
						className="mt-1 min-h-[40px] text-sm font-semibold text-amber-600 disabled:opacity-60 dark:text-amber-400"
					>
						Try again
					</button>
				</div>
			)}

			{!showError && studies === null && (
				<div className="space-y-3" aria-hidden>
					{[0, 1, 2].map((i) => (
						<div
							key={i}
							className="h-28 animate-pulse rounded-2xl border border-black/[0.08] bg-black/[0.03] dark:border-white/[0.06] dark:bg-white/[0.03]"
						/>
					))}
				</div>
			)}

			{!failed && studies?.length === 0 && (
				<div className="rounded-2xl border border-black/[0.08] bg-black/[0.03] px-5 py-6 dark:border-white/[0.06] dark:bg-white/[0.03]">
					<p className="font-medium text-neutral-900 dark:text-neutral-100">
						No studies yet
					</p>
					<p className="mt-1 text-neutral-600 dark:text-neutral-300">
						Studies appear here after a service is recorded and processed. Set your church in
						Settings to follow along.
					</p>
				</div>
			)}

			<ul className="space-y-3">
				{studies?.map((study) => {
					const when = formatDate(study.serviceDate);
					return (
						<li key={study.id}>
							<Link
								href={`/sermons/${study.id}`}
								className="flex flex-col gap-3 rounded-2xl sm:flex-row sm:gap-4 border border-black/[0.08] bg-black/[0.03] p-4 transition-colors hover:bg-black/[0.06] dark:border-white/[0.06] dark:bg-white/[0.03] dark:hover:bg-white/[0.06]"
							>
								{study.imageUrl && (
									// eslint-disable-next-line @next/next/no-img-element
									<img
										src={study.imageUrl}
										alt=""
										className="aspect-[3/2] w-full rounded-xl object-cover sm:aspect-auto sm:h-20 sm:w-28 sm:shrink-0"
										loading="lazy"
									/>
								)}
								<div className="min-w-0">
									<div className="flex flex-wrap items-center gap-2">
										{when && (
											<span className="text-metadata font-bold uppercase tracking-[0.08em] text-neutral-400 dark:text-neutral-500">
												{when}
											</span>
										)}
										{study.preachingText && (
											<span className="rounded-full border border-black/[0.08] px-1.5 py-0.5 text-metadata font-bold tracking-[0.06em] text-amber-600 dark:border-white/[0.08] dark:text-amber-400">
												{study.preachingText}
											</span>
										)}
									</div>
									<p className="mt-1 truncate font-semibold text-neutral-900 dark:text-neutral-50">
										{study.title}
									</p>
									<p className="mt-1 line-clamp-2 text-sm text-neutral-600 dark:text-neutral-300">
										{study.bigIdea}
									</p>
								</div>
							</Link>
						</li>
					);
				})}
			</ul>
		</main>
	);
}

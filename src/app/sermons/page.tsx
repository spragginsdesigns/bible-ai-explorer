"use client";

import React, { useEffect, useState } from "react";
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

	useEffect(() => {
		let cancelled = false;
		fetch("/api/sermon-studies")
			.then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
			.then((data) => {
				if (!cancelled) setStudies(data.studies ?? []);
			})
			.catch(() => {
				if (!cancelled) setFailed(true);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	return (
		<main className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8">
			<header className="mb-8">
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

			{failed && (
				<p className="rounded-xl border border-black/[0.08] px-4 py-3 text-neutral-600 dark:border-white/[0.06] dark:text-neutral-300">
					Something went wrong loading your studies. Try again in a moment.
				</p>
			)}

			{!failed && studies === null && (
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
								className="flex gap-4 rounded-2xl border border-black/[0.08] bg-black/[0.03] p-4 transition-colors hover:bg-black/[0.06] dark:border-white/[0.06] dark:bg-white/[0.03] dark:hover:bg-white/[0.06]"
							>
								{study.imageUrl && (
									// eslint-disable-next-line @next/next/no-img-element
									<img
										src={study.imageUrl}
										alt=""
										className="hidden h-20 w-28 shrink-0 rounded-xl object-cover sm:block"
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

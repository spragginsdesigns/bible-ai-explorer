"use client";

import React, { useEffect, useState } from "react";
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
 */
export default function SermonStudyPage() {
	const params = useParams<{ id: string }>();
	const [study, setStudy] = useState<SermonStudyDetail | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!params?.id) return;
		let cancelled = false;
		fetch(`/api/sermon-studies/${params.id}`)
			.then((res) =>
				res.ok ? res.json() : Promise.reject(new Error(res.status === 404 ? "404" : "failed"))
			)
			.then((data) => {
				if (!cancelled) setStudy(data.study);
			})
			.catch((err: Error) => {
				if (!cancelled) setError(err.message === "404" ? "not-found" : "failed");
			});
		return () => {
			cancelled = true;
		};
	}, [params?.id]);

	if (error) {
		return (
			<main className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8">
				<p className="text-neutral-600 dark:text-neutral-300">
					{error === "not-found"
						? "That study is not available."
						: "Something went wrong loading this study."}
				</p>
				<Link href="/sermons" className="mt-3 inline-block text-amber-600 dark:text-amber-400">
					Back to sermon studies
				</Link>
			</main>
		);
	}

	if (!study) {
		return (
			<main className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8">
				<div className="h-64 animate-pulse rounded-2xl border border-black/[0.08] bg-black/[0.03] dark:border-white/[0.06] dark:bg-white/[0.03]" />
			</main>
		);
	}

	const hero = study.sections.find((s) => s.imageUrl)?.imageUrl ?? null;

	return (
		<main className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8">
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

			<a
				href={watchUrl(study.videoId, study.sermonStartMs)}
				target="_blank"
				rel="noreferrer"
				className="mt-4 inline-flex items-center gap-2 rounded-full border border-black/[0.08] bg-black/[0.03] px-4 py-2 text-sm font-medium text-neutral-800 transition-colors hover:bg-black/[0.06] dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-neutral-100 dark:hover:bg-white/[0.06]"
			>
				Watch the service
			</a>

			<p className="mt-6 text-neutral-700 dark:text-neutral-200">{study.summary}</p>

			{study.preachingText && study.sections[0]?.passageText && (
				<section className="mt-8">
					<h2 className="mb-2 text-sm font-bold uppercase tracking-[0.1em] text-amber-600 dark:text-amber-400">
						The text: {study.preachingText}
					</h2>
				</section>
			)}

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

					{section.imageUrl && index > 0 && (
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

			<section className="mt-8 mb-16">
				<h2 className="text-sm font-bold uppercase tracking-[0.1em] text-amber-600 dark:text-amber-400">
					Prayer
				</h2>
				<p className="mt-2 text-neutral-700 dark:text-neutral-200">{study.prayer}</p>
			</section>
		</main>
	);
}

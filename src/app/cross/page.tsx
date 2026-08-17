"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BOOKS } from "@/lib/bible/books";

interface StudyStep {
	book: string;
	chapter: number;
	focus: string;
}

interface DailyCrossEntry {
	reference: string;
	book: string;
	chapter: number;
	verse: number;
	text: string;
	reason: string;
	whyToday: string | null;
	application: string | null;
	studyPath: StudyStep[];
	question: string | null;
	sentAt: string;
}

function studyHref(step: StudyStep): string | null {
	const book = BOOKS.find((candidate) => candidate.name === step.book);
	return book ? `/bible/chapter?book=${book.order}&chapter=${step.chapter}` : null;
}

/**
 * One stop on the guided timeline: an amber node on a vertical rail, with the
 * section content to its right. The rail connects the day into one walk.
 */
function TimelineStop({
	glyph,
	label,
	last = false,
	children,
}: {
	glyph: string;
	label?: string;
	last?: boolean;
	children: React.ReactNode;
}) {
	return (
		<div className="flex gap-3">
			<div className="flex w-7 flex-col items-center">
				<div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-amber-500/40 dark:border-amber-400/30 bg-amber-500/10 dark:bg-amber-400/10 text-[13px] font-bold text-amber-600 dark:text-amber-400 shadow-[0_0_8px_rgba(217,119,6,0.35)] dark:shadow-[0_0_8px_rgba(251,191,36,0.3)]">
					{glyph}
				</div>
				{!last && (
					<div className="my-1 w-0.5 flex-1 rounded-full bg-amber-500/25 dark:bg-amber-400/20" />
				)}
			</div>
			<div className={`flex flex-1 flex-col gap-2 ${last ? "" : "pb-7"}`}>
				{label && (
					<h2 className="pt-1.5 text-[11.5px] font-bold tracking-[0.1em] text-amber-700/70 dark:text-amber-500/60">
						{label}
					</h2>
				)}
				{children}
			</div>
		</div>
	);
}

/**
 * "Pick Up Your Cross" (Luke 9:23) — the guided daily walk: today's verse,
 * why it was chosen from the user's actual week, how it applies, and a short
 * study path. Mirrors mobile/app/(app)/cross.tsx.
 */
export default function DailyCrossPage() {
	const router = useRouter();
	const [entry, setEntry] = useState<DailyCrossEntry | null>(null);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(() => {
		setError(null);
		setEntry(null);
		fetch("/api/verse-of-day/today")
			.then(async (res) => {
				if (!res.ok) {
					const data = (await res.json().catch(() => null)) as { error?: string } | null;
					throw new Error(data?.error ?? "Today's word could not be loaded. Try again.");
				}
				return (await res.json()) as DailyCrossEntry;
			})
			.then(setEntry)
			.catch((err: unknown) => {
				setError(err instanceof Error ? err.message : "Today's word could not be loaded. Try again.");
			});
	}, []);

	useEffect(() => {
		load();
	}, [load]);

	const goDeeper = useCallback(() => {
		if (!entry) return;
		router.push(
			`/?attachRef=${encodeURIComponent(entry.reference)}` +
				`&attachText=${encodeURIComponent(entry.text)}` +
				`&attachTranslation=KJV`
		);
	}, [router, entry]);

	const today = new Date().toLocaleDateString(undefined, {
		weekday: "long",
		month: "long",
		day: "numeric",
	});

	return (
		<div className="min-h-[100dvh] gradient-mesh">
			<div className="mx-auto w-full max-w-2xl px-5 pb-28 lg:pb-10">
				<div className="flex items-center gap-4 py-3">
					<button
						type="button"
						onClick={() => router.back()}
						className="text-[15px] font-semibold text-amber-600 dark:text-amber-400"
					>
						‹ Back
					</button>
					<h1 className="flex-1 truncate text-center text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
						Pick Up Your Cross
					</h1>
					<span className="w-11" aria-hidden />
				</div>

				<p className="mb-5 text-center text-[13px] text-neutral-400 dark:text-neutral-500">{today}</p>

				{!entry && !error ? (
					<div aria-label="Preparing your day" className="flex flex-col gap-3 py-8">
						{[100, 88, 94, 62].map((width, index) => (
							<div
								key={index}
								className="h-3.5 animate-pulse rounded-full border border-amber-500/20 dark:border-amber-400/20 bg-amber-500/15 dark:bg-amber-400/15 glow-amber-sm"
								style={{ width: `${width}%`, animationDelay: `${index * 150}ms` }}
							/>
						))}
						<p className="mt-3 text-center text-[13px] text-neutral-400 dark:text-neutral-500">
							Preparing your day in the Word…
						</p>
					</div>
				) : error ? (
					<div className="glass-card gradient-border flex flex-col items-center gap-4 rounded-2xl p-8">
						<p className="text-center text-sm leading-5 text-neutral-600 dark:text-neutral-300">{error}</p>
						<button
							type="button"
							onClick={load}
							className="rounded-lg border border-amber-500/40 dark:border-amber-400/30 bg-amber-500/10 dark:bg-amber-400/10 px-6 py-2 text-sm font-semibold text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 dark:hover:bg-amber-400/20 transition-colors"
						>
							Try again
						</button>
					</div>
				) : entry ? (
					<div className="mt-2">
						<TimelineStop glyph="✝" label="TODAY'S VERSE">
							<div className="glass-card gradient-border flex flex-col gap-3 rounded-2xl p-5">
								<p className="text-[15px] font-bold text-amber-600 dark:text-amber-400">
									{entry.reference}
								</p>
								<p className="font-[family-name:var(--font-cormorant)] text-[19px] leading-[30px] text-neutral-900 dark:text-neutral-100">
									{entry.text}
								</p>
								<p className="text-[13.5px] italic leading-[19px] text-neutral-500 dark:text-neutral-400">
									{entry.reason}
								</p>
							</div>
						</TimelineStop>

						{entry.whyToday && (
							<TimelineStop glyph="✦" label="WHY THIS VERSE TODAY">
								<p className="text-[14.5px] leading-[22px] text-neutral-700 dark:text-neutral-300">
									{entry.whyToday}
								</p>
							</TimelineStop>
						)}

						{entry.application && (
							<TimelineStop glyph="◆" label="FOR YOU">
								<p className="text-[14.5px] leading-[22px] text-neutral-700 dark:text-neutral-300">
									{entry.application}
								</p>
							</TimelineStop>
						)}

						{entry.studyPath.map((step, index) => {
							const href = studyHref(step);
							const body = (
								<>
									<span className="block text-sm font-bold text-amber-600 dark:text-amber-400">
										{step.book} {step.chapter} ›
									</span>
									<span className="block text-[13.5px] leading-[19px] text-neutral-600 dark:text-neutral-300">
										{step.focus}
									</span>
								</>
							);
							return (
								<TimelineStop
									key={`${step.book}-${step.chapter}-${index}`}
									glyph={String(index + 1)}
									label={index === 0 ? "TODAY'S STUDY" : undefined}
								>
									{href ? (
										<Link
											href={href}
											className="flex flex-col gap-1 rounded-xl border border-black/[0.08] dark:border-white/[0.06] bg-black/[0.03] dark:bg-white/[0.03] px-4 py-3 hover:bg-black/[0.06] dark:hover:bg-white/[0.06] transition-colors"
										>
											{body}
										</Link>
									) : (
										<div className="flex flex-col gap-1 rounded-xl border border-black/[0.08] dark:border-white/[0.06] bg-black/[0.03] dark:bg-white/[0.03] px-4 py-3">
											{body}
										</div>
									)}
								</TimelineStop>
							);
						})}

						{entry.question && (
							<TimelineStop glyph="?" label="CARRY THIS">
								<div className="rounded-2xl border border-amber-500/40 dark:border-amber-400/30 bg-amber-500/10 dark:bg-amber-400/10 p-4">
									<p className="text-[14.5px] font-medium leading-[22px] text-neutral-900 dark:text-neutral-100">
										{entry.question}
									</p>
								</div>
							</TimelineStop>
						)}

						<TimelineStop glyph="➜" last>
							<button
								type="button"
								onClick={goDeeper}
								className="flex min-h-12 w-full items-center justify-center rounded-xl border border-amber-500/40 dark:border-amber-400/30 bg-amber-500/10 dark:bg-amber-400/10 text-[15px] font-bold text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 dark:hover:bg-amber-400/20 transition-colors"
							>
								✦ Go deeper in chat
							</button>
						</TimelineStop>
					</div>
				) : null}
			</div>
		</div>
	);
}

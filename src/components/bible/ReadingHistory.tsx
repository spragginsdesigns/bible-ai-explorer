"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { bookByOrder } from "@/lib/bible/books";
import { retryBlockedReadings, useReadingLogStatus } from "./readingLogClient";
import type { ReadingEntry } from "../../../mobile/src/features/reading/readingLogCore";
type Entry = Omit<ReadingEntry, "occurredAt"> & { occurredAt: string | null };
interface Page {
	entries: Entry[];
	nextCursor: string | null;
	stats: {
		sessions: number;
		chapterReadings: number;
		uniqueChapters: number;
		activeDays: number;
		historicalBackfillPending?: boolean;
	};
}
const card =
	"rounded-2xl border border-black/10 bg-white/60 p-5 dark:border-white/10 dark:bg-white/5";
export default function ReadingHistory() {
	const { userId, getToken } = useAuth();
	const auth = useRef({ userId, getToken });
	auth.current = { userId, getToken };
	const sequence = useRef(0);
	const status = useReadingLogStatus();
	const [entries, setEntries] = useState<Entry[]>([]);
	const [stats, setStats] = useState<Page["stats"] | null>(null);
	const [cursor, setCursor] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const load = useCallback(async (next?: string) => {
		const id = ++sequence.current;
		const owner = auth.current.userId;
		if (!owner) return;
		setBusy(true);
		setError(null);
		try {
			const token = await auth.current.getToken();
			if (auth.current.userId !== owner || !token) return;
			const res = await fetch(
				`/api/reading-log?limit=30${next ? "&cursor=" + encodeURIComponent(next) : ""}`,
				{
					headers: { Authorization: `Bearer ${token}` },
					credentials: "omit",
					signal: AbortSignal.timeout(15_000),
				}
			);
			if (!res.ok)
				throw new Error(
					"Reading history could not be loaded. Check your connection and try again."
				);
			const page: Page = await res.json();
			if (sequence.current !== id || auth.current.userId !== owner) return;
			setEntries((old) =>
				next
					? [
							...old,
							...page.entries.filter(
								(e) => !old.some((o) => o.eventId === e.eventId)
							),
						]
					: page.entries
			);
			setCursor(page.nextCursor);
			setStats(page.stats);
		} catch (e) {
			if (sequence.current === id)
				setError(
					e instanceof Error
						? e.message
						: "Reading history could not be loaded."
				);
		} finally {
			if (sequence.current === id) setBusy(false);
		}
	}, []);
	const previousPending = useRef(status.pending);
	useEffect(() => {
		if (previousPending.current > 0 && status.pending === 0) void load();
		previousPending.current = status.pending;
	}, [status.pending, load]);
	useEffect(() => {
		setEntries([]);
		setStats(null);
		setCursor(null);
		void load();
		const requests = sequence;
		return () => {
			requests.current++;
		};
	}, [userId, load]);
	return (
		<main className="min-h-screen bg-[#faf8f4] px-4 pb-28 pt-8 text-neutral-900 dark:bg-[#11100e] dark:text-neutral-100">
			<div className="mx-auto max-w-3xl space-y-6">
				<Link href="/bible" className="text-amber-700 dark:text-amber-400">
					‹ Bible
				</Link>
				<header>
					<h1 className="font-display text-3xl">Reading log</h1>
					<p className="mt-2 text-neutral-600 dark:text-neutral-400">
						Your reading, over a lifetime. Returning to a chapter in a later
						session counts again.
					</p>
				</header>
				{stats ? (
					<section className={card}>
						<h2 className="text-xl font-semibold">
							{stats.uniqueChapters.toLocaleString()}{" "}
							{stats.uniqueChapters === 1 ? "chapter" : "chapters"} covered
						</h2>
						<p className="mt-2">
							{stats.chapterReadings.toLocaleString()}{" "}
							{stats.chapterReadings === 1
								? "chapter reading"
								: "chapter readings"}{" "}
							· {stats.sessions.toLocaleString()}{" "}
							{stats.sessions === 1 ? "session" : "sessions"} ·{" "}
							{stats.activeDays.toLocaleString()}{" "}
							{stats.activeDays === 1 ? "day" : "days"}
						</p>
						{stats.historicalBackfillPending ? (
							<p className="mt-2 text-sm">
								Earlier reading history is still being added. Lifetime totals
								will update when it finishes.
							</p>
						) : null}
					</section>
				) : null}
				<section className={card}>
					<p>
						The reader logs verses you spend time viewing. A chapter is complete
						when all its verses have been covered in that session. For your
						physical Bible, tell SureWord what you read.
					</p>
					<Link
						href="/"
						className="mt-3 inline-block text-amber-700 underline dark:text-amber-400"
					>
						Talk to SureWord →
					</Link>
				</section>
				{status.pending > 0 || status.error ? (
					<section className={card}>
						<p role="status">
							{status.error ??
								`${status.pending} reading ${status.pending === 1 ? "entry is" : "entries are"} saved in this browser, waiting to sync.`}
						</p>
						<button
							className="mt-3 text-amber-700 underline dark:text-amber-400"
							onClick={() => {
								retryBlockedReadings();
								void load();
							}}
						>
							Retry sync and refresh
						</button>
					</section>
				) : null}
				<button
					disabled={busy}
					className="text-amber-700 underline dark:text-amber-400"
					onClick={() => void load()}
				>
					Refresh history
				</button>
				{!userId ? <p>Sign in to see your reading history.</p> : null}
				<div className="space-y-3">
					{entries.map((entry, index) => {
						const book =
							entry.bookName ?? bookByOrder(entry.book)?.name ?? "Bible";
						const ranges = entry.verseRanges ?? [];
						const passage = `${book} ${entry.chapter}${entry.completed ? "" : ":" + ranges.map((r) => (r.start === r.end ? r.start : `${r.start}–${r.end}`)).join(", ")}`;
						const when =
							entry.precision === "exact" && entry.occurredAt
								? new Date(entry.occurredAt).toLocaleString()
								: `${entry.localDate ?? entry.occurredAt?.slice(0, 10) ?? "Date unspecified"} · ${entry.precision === "day" ? "time unspecified" : entry.precision}`;
						return (
							<article key={entry.eventId}>
								{entries[index - 1]?.sessionId !== entry.sessionId ? (
									<h2 className="mb-2 mt-6 text-sm text-neutral-600 dark:text-neutral-400">
										{when}
									</h2>
								) : null}
								<Link
									href={`/bible/chapter?book=${entry.book}&chapter=${entry.chapter}&verse=${ranges[0]?.start ?? 1}&translation=${encodeURIComponent(entry.translation ?? "KJV")}`}
									className={`${card} block`}
								>
									<h3 className="font-semibold">{passage}</h3>
									<p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
										{entry.completed ? "Chapter complete" : "Partial reading"} ·{" "}
										{entry.source === "reader"
											? "SureWord reader"
											: entry.source === "physical"
												? "Physical Bible"
												: entry.source === "legacy"
													? "Earlier tracking"
													: "Reported reading"}
									</p>
								</Link>
							</article>
						);
					})}
				</div>
				{busy ? <p role="status">Loading readings…</p> : null}
				{error ? <p role="alert">{error}</p> : null}
				{!busy && !error && userId && !entries.length ? (
					<p>
						No readings yet. Start with a chapter, or tell SureWord what you
						read in your physical Bible.
					</p>
				) : null}
				{cursor && !busy ? (
					<button
						className="text-amber-700 underline dark:text-amber-400"
						onClick={() => void load(cursor)}
					>
						Load older readings
					</button>
				) : null}
				<p className="text-sm text-neutral-600 dark:text-neutral-400">
					Need to correct or remove a reading? Ask SureWord to find the entry
					and make the change.
				</p>
			</div>
		</main>
	);
}

"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, RefreshCw } from "lucide-react";
import { useAuth } from "@clerk/nextjs";
import { bookByOrder } from "@/lib/bible/books";
import {
	fetchReadingLog,
	retryBlockedReadings,
	useReadingLogStatus,
} from "./readingLogClient";
import {
	dayHeading,
	deviceTimezone,
	groupByDay,
	localDateKey,
	partialPercent,
	percentOfBible,
	readerHref,
	streakNote,
	type LogEntry,
	type ReadingOverview,
} from "./readingOverview";
import WalkCard from "./WalkCard";
import BibleMap from "./BibleMap";

interface HistoryPage {
	entries: LogEntry[];
	nextCursor: string | null;
}

const card = "glass-card rounded-2xl p-5";
const link =
	"text-support font-semibold text-amber-600 hover:underline disabled:opacity-50 dark:text-amber-400";

/**
 * The web reading log (/bible/history). Mirrors the Android screen
 * (mobile/app/(app)/bible/history.tsx): "Your walk" reflection, streak and
 * coverage tiles, the Bible map, and a day-by-day timeline. Wide screens put
 * the tiles and the map side by side.
 */
export default function ReadingHistory() {
	const { isLoaded, userId, getToken } = useAuth();
	const auth = useRef({ userId, getToken });
	auth.current = { userId, getToken };
	const sequence = useRef(0);
	const status = useReadingLogStatus();
	const [entries, setEntries] = useState<LogEntry[]>([]);
	const [overview, setOverview] = useState<ReadingOverview | null>(null);
	const [cursor, setCursor] = useState<string | null>(null);
	// Starts busy so the empty state never flashes before the first load.
	const [busy, setBusy] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [showHelp, setShowHelp] = useState(false);
	const [reflectionKey, setReflectionKey] = useState(0);
	const token = useCallback(() => auth.current.getToken(), []);

	// The request "Try again" repeats: undefined is a full refresh, a string is
	// the older page that failed. Never the next page by accident.
	const failedCursor = useRef<string | undefined>(undefined);
	const load = useCallback(async (next?: string) => {
		const id = ++sequence.current;
		const owner = auth.current.userId;
		if (!owner) {
			setBusy(false);
			setError(null);
			return;
		}
		const active = () => sequence.current === id && auth.current.userId === owner;
		setBusy(true);
		setError(null);
		const tz = deviceTimezone();
		// Stats and the map are a bonus over the history: their failure must
		// never blank the log, so they load on their own.
		if (!next)
			void fetchReadingLog<ReadingOverview>(
				token,
				`/api/reading-log/overview${tz ? `?tz=${encodeURIComponent(tz)}` : ""}`,
				active
			)
				.then((summary) => {
					if (summary && active()) setOverview(summary);
				})
				.catch(() => undefined);
		try {
			const page = await fetchReadingLog<HistoryPage>(
				token,
				`/api/reading-log?limit=30${next ? "&cursor=" + encodeURIComponent(next) : ""}`,
				active
			);
			if (!page || !active()) return;
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
		} catch (e) {
			if (active()) {
				failedCursor.current = next;
				setError(
					e instanceof Error ? e.message : "Reading history could not be loaded."
				);
			}
		} finally {
			if (sequence.current === id) setBusy(false);
		}
	}, [token]);

	const refresh = useCallback(() => {
		retryBlockedReadings();
		void load();
		setReflectionKey((key) => key + 1);
	}, [load]);

	const previousPending = useRef(status.pending);
	useEffect(() => {
		if (previousPending.current > 0 && status.pending === 0) {
			void load();
			setReflectionKey((key) => key + 1);
		}
		previousPending.current = status.pending;
	}, [status.pending, load]);
	// Another account's log must never flash on screen.
	useEffect(() => {
		setEntries([]);
		setOverview(null);
		setCursor(null);
		void load();
		const requests = sequence;
		return () => {
			requests.current++;
		};
	}, [userId, load]);

	const days = useMemo(
		() => groupByDay(entries, (order) => bookByOrder(order)?.name ?? "Bible"),
		[entries]
	);
	const today = localDateKey(new Date());
	const hasReading = (overview?.totals.chapterReadings ?? 0) > 0 || entries.length > 0;
	const showMap = overview !== null && hasReading;

	return (
		<main className="mx-auto w-full max-w-2xl px-4 pb-28 sm:px-5 lg:max-w-5xl lg:px-8 lg:pb-16">
			<div className="flex items-center gap-4 py-3 lg:py-6">
				<Link
					href="/bible"
					className="text-control font-semibold text-amber-600 dark:text-amber-400"
				>
					‹ Bible
				</Link>
				<h1 className="flex-1 truncate text-center text-control font-semibold text-neutral-900 dark:text-neutral-100 lg:text-screen-title">
					Reading log
				</h1>
				{userId ? (
					<button
						type="button"
						disabled={busy}
						onClick={refresh}
						aria-label="Refresh reading log"
						title="Refresh"
						className="flex h-9 w-11 items-center justify-end text-neutral-500 transition-colors hover:text-amber-600 disabled:opacity-50 dark:text-neutral-400 dark:hover:text-amber-400"
					>
						<RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} aria-hidden />
					</button>
				) : (
					<span className="w-11" aria-hidden />
				)}
			</div>

			{!isLoaded ? null : !userId ? (
				<p className="py-8 text-center text-support text-neutral-500 dark:text-neutral-400">
					Sign in to see your reading history.
				</p>
			) : (
				<div className="flex flex-col gap-6">
					<div
						className={`grid gap-5 ${showMap ? "lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start" : ""}`}
					>
						<div className="flex flex-col gap-5">
							{hasReading ? (
								<WalkCard key={userId} getToken={token} refreshKey={reflectionKey} />
							) : null}
							{overview && hasReading ? <Stats overview={overview} /> : null}
							{overview?.historicalBackfillPending ? (
								<p className="text-support text-neutral-500 dark:text-neutral-400">
									Your earlier reading history is still being added. Totals will
									update when it finishes.
								</p>
							) : null}
							{status.pending > 0 || status.error ? (
								<div className={`${card} flex flex-col gap-2`}>
									<p role="status" className="text-support text-neutral-600 dark:text-neutral-300">
										{status.error ??
											`${status.pending} reading ${status.pending === 1 ? "entry is" : "entries are"} saved in this browser, waiting to sync.`}
									</p>
									<button
										type="button"
										className={`self-start ${link}`}
										onClick={() => {
											retryBlockedReadings();
											void load();
										}}
									>
										Retry sync and refresh
									</button>
								</div>
							) : null}
						</div>
						{showMap && overview ? <BibleMap coverage={overview.books} /> : null}
					</div>

					{days.length ? (
						<section aria-labelledby="reading-history-heading" className="flex flex-col gap-5">
							<h2
								id="reading-history-heading"
								className="text-section-title font-bold text-neutral-900 dark:text-neutral-100"
							>
								History
							</h2>
							{days.map((day) => (
								<div key={day.date} className="flex flex-col gap-2">
									<h3 className="text-metadata font-semibold text-neutral-500 dark:text-neutral-400">
										{dayHeading(day.date, today)}
									</h3>
									<ul className="glass-card divide-y divide-black/[0.06] overflow-hidden rounded-2xl dark:divide-white/[0.06]">
										{day.chapters.map((row) => (
											<li key={row.key}>
												<Link
													href={readerHref({
														book: row.book,
														chapter: row.chapter,
														verse: row.firstVerse,
														translation: row.translation,
													})}
													aria-label={`Open ${row.bookName} ${row.chapter}, ${row.completed ? "read" : `${Math.round(row.fraction * 100)} percent read`}`}
													className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.05] lg:px-5"
												>
													<span className="flex min-w-0 flex-1 flex-col gap-0.5">
														<span className="truncate text-control font-semibold text-neutral-900 dark:text-neutral-100">
															{row.bookName} {row.chapter}
														</span>
														{row.physical || row.legacy || row.readings > 1 ? (
															<span className="text-metadata text-neutral-400 dark:text-neutral-500">
																{[
																	row.physical ? "Physical Bible" : null,
																	row.legacy ? "Earlier tracking" : null,
																	row.readings > 1 ? `${row.readings} times` : null,
																]
																	.filter(Boolean)
																	.join(" · ")}
															</span>
														) : null}
													</span>
													{row.completed ? (
														<span className="text-metadata font-semibold text-amber-600 dark:text-amber-400">
															✓ Read
														</span>
													) : (
														<span className="flex w-[72px] flex-col items-end gap-1">
															<span className="block h-1 w-[72px] overflow-hidden rounded-full bg-black/[0.08] dark:bg-white/[0.08]">
																<span
																	className="block h-1 bg-amber-500/60 dark:bg-amber-400/60"
																	style={{ width: `${partialPercent(row.fraction)}%` }}
																/>
															</span>
															<span className="text-metadata text-neutral-400 dark:text-neutral-500">
																Part
															</span>
														</span>
													)}
												</Link>
											</li>
										))}
									</ul>
								</div>
							))}
						</section>
					) : null}

					{!busy && !error && !days.length ? (
						<div className={`${card} flex flex-col gap-2`}>
							<p className="text-support leading-6 text-neutral-600 dark:text-neutral-300">
								No readings yet. Open any chapter in the Bible and SureWord keeps
								track as you read. Reading a paper Bible? Tell SureWord what you
								read.
							</p>
							<Link href="/" className={`self-start ${link}`}>
								Talk to SureWord →
							</Link>
						</div>
					) : null}

					<div className="flex flex-col items-start gap-3">
						{busy ? (
							<p
								role="status"
								className="flex items-center gap-2 text-support text-neutral-500 dark:text-neutral-400"
							>
								<Loader2
									className="h-4 w-4 animate-spin text-amber-600 dark:text-amber-400"
									aria-hidden
								/>
								Loading readings…
							</p>
						) : null}
						{error ? (
							<div className="flex flex-col items-start gap-2">
								<p role="alert" className="text-support text-neutral-600 dark:text-neutral-300">
									{error}
								</p>
								<button
									type="button"
									disabled={busy}
									className={link}
									onClick={() => void load(failedCursor.current)}
								>
									Try again
								</button>
							</div>
						) : null}
						{cursor && !busy ? (
							<button type="button" className={link} onClick={() => void load(cursor)}>
								Load older readings
							</button>
						) : null}
						<button
							type="button"
							aria-expanded={showHelp}
							aria-controls="reading-log-help"
							className={link}
							onClick={() => setShowHelp((open) => !open)}
						>
							{showHelp ? "Hide how the log works" : "How the log works"}
						</button>
						{showHelp ? (
							<p
								id="reading-log-help"
								className="max-w-2xl text-support leading-6 text-neutral-500 dark:text-neutral-400"
							>
								The reader counts a verse once it has been on screen for a few
								seconds. A chapter is marked read when you cover every verse in one
								sitting; coming back to it later counts again. For a paper Bible,
								tell SureWord what you read, and ask SureWord if an entry needs
								correcting or removing.
							</p>
						) : null}
					</div>
				</div>
			)}
		</main>
	);
}

function Stats({ overview }: { overview: ReadingOverview }) {
	const { totals, streak } = overview;
	const tiles = [
		{
			value: streak.current.toLocaleString(),
			label: "day streak",
			sub: streakNote(streak),
		},
		{
			value: totals.chaptersComplete.toLocaleString(),
			label: totals.chaptersComplete === 1 ? "chapter read" : "chapters read",
			sub: `${percentOfBible(totals.chaptersComplete, totals.totalChapters)} of the Bible`,
		},
		{
			value: totals.booksStarted.toLocaleString(),
			label: totals.booksStarted === 1 ? "book opened" : "books opened",
			sub: "of 66",
		},
	];
	return (
		<ul className="grid grid-cols-3 gap-2 lg:gap-3">
			{tiles.map((tile) => (
				<li key={tile.label} className="glass-card flex min-w-0 flex-col rounded-2xl p-3 lg:p-4">
					<span className="text-[26px] font-bold leading-8 tabular-nums text-neutral-900 dark:text-neutral-100">
						{tile.value}
					</span>
					<span className="text-metadata text-neutral-600 dark:text-neutral-300">
						{tile.label}
					</span>
					<span className="mt-0.5 text-metadata text-neutral-400 dark:text-neutral-500">
						{tile.sub}
					</span>
				</li>
			))}
		</ul>
	);
}

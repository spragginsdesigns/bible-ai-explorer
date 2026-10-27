"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { ArrowLeft } from "lucide-react";
import { dueReminders } from "@/lib/beta/growth/growth-rules";
import { DESTINATION_TILE, IconTile, moduleIcon } from "../visuals";
import { browserTimezone, growthApi, type GrowthOverview } from "./growthApi";
import HabitList, { type HabitView } from "./HabitList";
import HistoryCard from "./HistoryCard";
import JournalCard from "./JournalCard";
import PracticeCard from "./PracticeCard";
import TodayCard from "./TodayCard";
import WeekCard from "./WeekCard";
import { ErrorNote, card, muted, quietButton } from "./ui";

export interface WeekVerse {
	reference: string;
	/** From the bundled KJV, read on the server. */
	text: string;
}

/** The founder's own clock: today's day key and minutes since midnight. */
function clockNow(): { day: string; minutes: number } {
	const now = new Date();
	const parts = new Intl.DateTimeFormat("en-CA", { timeZone: browserTimezone(), year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
	const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "00";
	return { day: `${part("year")}-${part("month")}-${part("day")}`, minutes: Number(part("hour")) * 60 + Number(part("minute")) };
}

export default function GrowthScreen({ verse }: { verse: WeekVerse | null }) {
	const { userId } = useAuth();
	// A different account must never see the previous one's habits or journal, even briefly.
	return <GrowthContent key={userId ?? "guest"} verse={verse} />;
}

function GrowthContent({ verse }: { verse: WeekVerse | null }) {
	const [overview, setOverview] = useState<GrowthOverview | null>(null);
	const [week, setWeek] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [clock, setClock] = useState<{ day: string; minutes: number } | null>(null);
	const sequence = useRef(0);

	const load = useCallback(async (weekStart: string | null) => {
		const ticket = ++sequence.current;
		setLoading(true);
		try {
			const next = await growthApi.overview(weekStart ?? undefined);
			if (ticket !== sequence.current) return;
			setOverview(next);
			setLoadError(null);
		} catch (failure) {
			if (ticket !== sequence.current) return;
			setLoadError(failure instanceof Error ? failure.message : "Could not load your habits. Please try again.");
		} finally {
			if (ticket === sequence.current) setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load(week);
	}, [load, week]);

	// Reminders are in-app: re-read the clock each minute while the page is open,
	// and start a new day's view when midnight passes.
	useEffect(() => {
		const tick = () => setClock(clockNow());
		tick();
		const timer = setInterval(tick, 60_000);
		return () => clearInterval(timer);
	}, []);
	const today = overview?.today;
	useEffect(() => {
		if (clock && today && clock.day > today) void load(week);
	}, [clock, today, load, week]);

	const refresh = useCallback(() => load(week), [load, week]);

	const setDay = async (habit: HabitView, day: string, done: boolean) => {
		if (!overview || busy) return;
		setBusy(true);
		setActionError(null);
		// Show the tap at once; the overview that follows is the truth.
		const index = overview.week.days.findIndex((entry) => entry.day === day);
		setOverview({
			...overview,
			habits: overview.habits.map((entry) =>
				entry.id !== habit.id
					? entry
					: {
							...entry,
							marked: index < 0 ? entry.marked : entry.marked.map((marked, position) => (position === index ? done : marked)),
							markedToday: day === overview.today ? done : entry.markedToday,
							// A reflection can still keep the day after the mark is cleared; the reload says so.
							week: index < 0 || !done ? entry.week : entry.week.map((kept, position) => (position === index ? true : kept)),
							count: index < 0 || !done || entry.week[index] ? entry.count : entry.count + 1,
							keptToday: day === overview.today && done ? true : entry.keptToday,
						},
			),
		});
		try {
			await growthApi.setHabitDay(habit.id, day, done);
		} catch (failure) {
			setActionError(failure instanceof Error ? failure.message : "That did not save. Please try again.");
		} finally {
			await refresh();
			setBusy(false);
		}
	};

	/** null when it saved, else what went wrong, in the server's words. */
	const actOnPractice = async (id: string, action: Record<string, unknown>): Promise<string | null> => {
		try {
			await growthApi.actOnPractice(id, action);
			await refresh();
			return null;
		} catch (failure) {
			return failure instanceof Error ? failure.message : "That did not save. Please try again.";
		}
	};

	const isCurrent = overview ? overview.weekStart === overview.currentWeekStart : true;
	const reminders = overview && clock && clock.day === overview.today ? dueReminders(overview.habits, clock.minutes) : [];
	const followUps = overview?.practices.filter((practice) => practice.due) ?? [];
	const prayer = overview?.habits.find((habit) => habit.type === "prayer");

	return (
		<main className="mx-auto w-full max-w-6xl px-5 pb-[calc(var(--sureword-mobile-tab-clearance)+24px)] pt-4 lg:px-8 lg:pb-16 lg:pt-10">
			<Link href="/beta/learn" className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-bold text-neutral-600 hover:bg-black/5 dark:text-[#bbb3a7] dark:hover:bg-white/5">
				<ArrowLeft size={18} aria-hidden /> Learn
			</Link>
			<header className="mt-3 flex items-start gap-4">
				<IconTile Icon={moduleIcon("growth", "learn")} tone={DESTINATION_TILE.learn} size="lg" />
				<div className="min-w-0">
					<h1 className="font-[family-name:var(--font-cormorant)] text-[clamp(2.2rem,8vw,2.9rem)] font-semibold leading-[1.02]">Habits &amp; Reflection</h1>
					<p className="mt-1.5 text-base text-neutral-700 dark:text-[#d9d1c3]">Small steps, lasting impact</p>
				</div>
			</header>

			{loadError && !overview && (
				<div className="mt-6 space-y-3">
					<ErrorNote message={loadError} />
					<button type="button" onClick={() => void load(week)} className={quietButton}>
						Try again
					</button>
				</div>
			)}

			{!overview && !loadError && (
				<div className="mt-6 grid gap-5 lg:grid-cols-2" aria-busy="true" aria-label="Loading your habits">
					{[0, 1].map((key) => (
						<div key={key} className={`${card} h-64 animate-pulse`} />
					))}
				</div>
			)}

			{overview && (
				<>
					{(actionError || (loadError && overview)) && (
						<div className="mt-5">
							<ErrorNote message={actionError ?? loadError ?? ""} onDismiss={() => { setActionError(null); setLoadError(null); }} />
						</div>
					)}
					<div className="mt-6 grid gap-5 lg:grid-cols-2 lg:items-start lg:gap-6">
						{/* min-w-0: on a phone both columns share one grid track, which must not grow to the journal's scrolling prompt row. */}
						<div className="flex min-w-0 flex-col gap-5">
							{isCurrent && (
								<TodayCard
									reminders={reminders}
									followUps={followUps}
									busy={busy || loading}
									onMarkToday={(habit) => void setDay(habit, overview.today, true)}
									onPractice={actOnPractice}
								/>
							)}
							<WeekCard overview={overview} loading={loading} onWeek={setWeek} />
							<HabitList overview={overview} busy={busy || loading} onSetDay={(habit, day, done) => void setDay(habit, day, done)} onChanged={refresh} />
							{/* Under the habits on desktop; after the journal on a phone (below). */}
							<HistoryCard overview={overview} onWeek={setWeek} className="hidden lg:block" />
						</div>
						<div className="flex min-w-0 flex-col gap-5">
							<JournalCard reflections={overview.reflections} prayerHabit={prayer?.name ?? null} onChanged={refresh} />
							<PracticeCard practices={overview.practices} onChanged={refresh} onPractice={actOnPractice} />
							<HistoryCard overview={overview} onWeek={setWeek} className="lg:hidden" />
						</div>
					</div>
				</>
			)}

			{verse && (
				<figure className={`${card} mt-6 px-5 py-6 text-center`}>
					<blockquote className="font-[family-name:var(--font-cormorant)] text-[24px] italic leading-[1.35]">&ldquo;{verse.text}&rdquo;</blockquote>
					<figcaption className={`mt-3 text-xs font-bold uppercase tracking-[.18em] ${muted}`}>{verse.reference} · KJV</figcaption>
				</figure>
			)}
		</main>
	);
}

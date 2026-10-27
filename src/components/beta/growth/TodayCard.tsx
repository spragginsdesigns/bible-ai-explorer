"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell, Check } from "lucide-react";
import { FOLLOW_UP_LABELS, FOLLOW_UP_NOTE_MAX, type FollowUpChoice } from "@/lib/beta/growth/growth-rules";
import type { GrowthPractice } from "./growthApi";
import { reminderLabel, shortDay } from "./growthApi";
import type { HabitView } from "./HabitList";
import { ErrorNote, card, cardTitle, eyebrow, field, goldButton, muted, quietButton, textButton } from "./ui";

/** Where a reminder for a habit SureWord counts sends the founder. */
const REMINDER_LINK: Partial<Record<HabitView["type"], { href: string; label: string }>> = {
	reading: { href: "/bible", label: "Open the Bible" },
	memory: { href: "/bible/learn", label: "Learn a verse" },
	study: { href: "/beta/study", label: "Go to Study" },
};

const NEXT_CHOICES: FollowUpChoice[] = ["1w", "2w", "1m", "none"];

/**
 * The in-app reminders (the beta is web-only, so there is no push): habits
 * whose reminder time has passed today and are not kept yet, and the
 * follow-ups the founder asked for on what they are putting into practice.
 * Shown only when one of them is due.
 */
export default function TodayCard({
	reminders,
	followUps,
	busy,
	onMarkToday,
	onPractice,
}: {
	reminders: HabitView[];
	followUps: GrowthPractice[];
	busy: boolean;
	onMarkToday: (habit: HabitView) => void;
	onPractice: (id: string, action: Record<string, unknown>) => Promise<string | null>;
}) {
	if (!reminders.length && !followUps.length) return null;
	return (
		<section aria-labelledby="growth-today-title" className={`${card} px-4 py-5 sm:px-5`}>
			<h2 id="growth-today-title" className={`${cardTitle} flex items-center gap-2`}>
				<Bell size={20} className="text-amber-800 dark:text-[#e5b664]" aria-hidden /> Today
			</h2>
			{reminders.length > 0 && (
				<ul className="mt-3 space-y-2.5">
					{reminders.map((habit) => {
						const link = REMINDER_LINK[habit.type];
						return (
							<li key={habit.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
								<p className="leading-6">
									It&rsquo;s past {reminderLabel(habit.reminder ?? "00:00")}. A few minutes for <span className="font-bold">{habit.name.toLowerCase()}</span>?
								</p>
								{habit.manual ? (
									<button type="button" disabled={busy} onClick={() => onMarkToday(habit)} className={quietButton}>
										<Check size={16} aria-hidden /> Mark today
									</button>
								) : (
									link && (
										<Link href={link.href} className={quietButton}>
											{link.label}
										</Link>
									)
								)}
							</li>
						);
					})}
				</ul>
			)}
			{followUps.length > 0 && (
				<ul className={`space-y-3 ${reminders.length ? "mt-4" : "mt-3"}`}>
					{followUps.map((practice) => (
						<FollowUp key={practice.id} practice={practice} onPractice={onPractice} />
					))}
				</ul>
			)}
		</section>
	);
}

function FollowUp({ practice, onPractice }: { practice: GrowthPractice; onPractice: (id: string, action: Record<string, unknown>) => Promise<string | null> }) {
	const [writing, setWriting] = useState(false);
	const [note, setNote] = useState("");
	const [next, setNext] = useState<FollowUpChoice>("1w");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const act = async (action: Record<string, unknown>) => {
		setSaving(true);
		setError(null);
		const failure = await onPractice(practice.id, action);
		setSaving(false);
		setError(failure);
	};
	return (
		<li className="rounded-2xl border border-black/[.08] bg-white/40 p-4 dark:border-white/[.08] dark:bg-white/[.02]">
			<p className={eyebrow}>You chose this on {shortDay(practice.day)}</p>
			<p className="mt-1.5 font-[family-name:var(--font-cormorant)] text-[22px] font-semibold leading-snug">&ldquo;{practice.text}&rdquo;</p>
			{practice.passage && <p className={`text-sm ${muted}`}>{practice.passage}</p>}
			<p className="mt-2 leading-6">How has it gone?</p>
			{error && (
				<div className="mt-2">
					<ErrorNote message={error} />
				</div>
			)}
			{writing ? (
				<div className="mt-2.5 space-y-2.5">
					<label className="block">
						<span className="sr-only">How it has gone</span>
						<textarea
							value={note}
							onChange={(event) => setNote(event.target.value)}
							maxLength={FOLLOW_UP_NOTE_MAX}
							rows={3}
							placeholder="A few words, just for you (optional)"
							className={`${field} resize-y`}
						/>
					</label>
					<label className="flex flex-wrap items-center gap-2 text-sm">
						<span className={muted}>Ask me again</span>
						<select value={next} onChange={(event) => setNext(event.target.value as FollowUpChoice)} className={`${field} min-h-11 w-auto py-1.5`}>
							{NEXT_CHOICES.map((choice) => (
								<option key={choice} value={choice}>
									{choice === "none" ? "Don't ask again" : FOLLOW_UP_LABELS[choice].toLowerCase()}
								</option>
							))}
						</select>
					</label>
					<div className="flex flex-wrap gap-2">
						<button type="button" disabled={saving} onClick={() => act({ action: "follow-up", note, next })} className={goldButton}>
							Save
						</button>
						<button type="button" disabled={saving} onClick={() => act({ action: "lived", note })} className={quietButton}>
							It&rsquo;s part of me now
						</button>
						<button type="button" disabled={saving} onClick={() => setWriting(false)} className={textButton}>
							Cancel
						</button>
					</div>
				</div>
			) : (
				<div className="mt-2.5 flex flex-wrap gap-2">
					<button type="button" onClick={() => setWriting(true)} className={quietButton}>
						Write how it went
					</button>
					<button type="button" disabled={saving} onClick={() => act({ action: "later" })} className={textButton}>
						Tomorrow
					</button>
				</div>
			)}
		</li>
	);
}

"use client";

import { useState, type FormEvent } from "react";
import { Minus, Plus } from "lucide-react";
import { HABIT_NAME_MAX, HABIT_TEMPLATES, HABITS_MAX, type HabitType } from "@/lib/beta/growth/growth-rules";
import { growthApi } from "./growthApi";
import type { HabitView } from "./HabitList";
import { ErrorNote, eyebrow, field, goldButton, muted, quietButton, textButton } from "./ui";

/**
 * Choosing habits: rename, a weekly target of 1 to 7 days, an optional
 * in-app reminder time, remove; add one of SureWord's four or a custom one.
 */
export default function HabitEditor({ habits, onChanged, onClose }: { habits: HabitView[]; onChanged: () => Promise<void>; onClose: () => void }) {
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const run = async (work: () => Promise<unknown>) => {
		setSaving(true);
		setError(null);
		try {
			await work();
			await onChanged();
			return true;
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : "Something went wrong. Please try again.");
			return false;
		} finally {
			setSaving(false);
		}
	};
	const available = HABIT_TEMPLATES.filter((template) => !habits.some((habit) => habit.type === template.type));
	const full = habits.length >= HABITS_MAX;

	return (
		<div className="mt-4 border-t border-black/[.06] pt-4 dark:border-white/[.06]">
			<div className="flex items-center justify-between gap-3">
				<h3 className={eyebrow}>Choose your habits</h3>
				<button type="button" onClick={onClose} className={textButton}>
					Done
				</button>
			</div>
			{error && (
				<div className="mt-3">
					<ErrorNote message={error} onDismiss={() => setError(null)} />
				</div>
			)}

			{habits.length > 0 && (
				<ul className="mt-3 space-y-3">
					{habits.map((habit) => (
						<HabitRow key={`${habit.id}:${habit.name}:${habit.target}:${habit.reminder}`} habit={habit} saving={saving} run={run} />
					))}
				</ul>
			)}

			{!full && available.length > 0 && (
				<div className="mt-4">
					<p className={`text-sm ${muted}`}>Add one SureWord counts for you, or a prayer habit you mark yourself:</p>
					<div className="mt-2 flex flex-wrap gap-2">
						{available.map((template) => (
							<button
								key={template.type}
								type="button"
								disabled={saving}
								onClick={() => run(() => growthApi.addHabit({ type: template.type }))}
								className={quietButton}
							>
								<Plus size={16} aria-hidden /> {template.name}
							</button>
						))}
					</div>
				</div>
			)}

			{!full ? <CustomHabitForm saving={saving} run={run} /> : <p className={`mt-4 text-sm ${muted}`}>You have {HABITS_MAX} habits, the most this keeps.</p>}
		</div>
	);
}

function HabitRow({ habit, saving, run }: { habit: HabitView; saving: boolean; run: (work: () => Promise<unknown>) => Promise<boolean> }) {
	const [name, setName] = useState(habit.name);
	const [target, setTarget] = useState(habit.target);
	const [reminder, setReminder] = useState(habit.reminder ?? "");
	const [confirming, setConfirming] = useState(false);
	const dirty = name.trim() !== habit.name || target !== habit.target || (reminder || null) !== habit.reminder;
	const save = () =>
		run(() =>
			growthApi.updateHabit(habit.id, {
				...(name.trim() !== habit.name && { name }),
				...(target !== habit.target && { target }),
				...((reminder || null) !== habit.reminder && { reminder: reminder || null }),
			}),
		);
	return (
		<li className="rounded-2xl border border-black/[.08] p-3 dark:border-white/[.08]">
			<label className="block">
				<span className="sr-only">Habit name</span>
				<input value={name} onChange={(event) => setName(event.target.value)} maxLength={HABIT_NAME_MAX} className={`${field} font-bold`} />
			</label>
			<div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
				<div className="flex items-center gap-1" role="group" aria-label={`${habit.name}: days a week`}>
					<button type="button" onClick={() => setTarget((value) => Math.max(1, value - 1))} disabled={target <= 1} aria-label="One day fewer" className="flex h-11 w-11 items-center justify-center rounded-full border border-black/10 disabled:opacity-30 dark:border-white/15">
						<Minus size={16} aria-hidden />
					</button>
					<span className="min-w-[96px] text-center text-sm font-bold tabular-nums" aria-live="polite">
						{target} {target === 1 ? "day" : "days"} a week
					</span>
					<button type="button" onClick={() => setTarget((value) => Math.min(7, value + 1))} disabled={target >= 7} aria-label="One day more" className="flex h-11 w-11 items-center justify-center rounded-full border border-black/10 disabled:opacity-30 dark:border-white/15">
						<Plus size={16} aria-hidden />
					</button>
				</div>
				<label className="flex items-center gap-2 text-sm">
					<span className={muted}>Remind me at</span>
					<input type="time" value={reminder} onChange={(event) => setReminder(event.target.value)} className={`${field} min-h-11 w-auto py-1.5`} />
				</label>
				{reminder && (
					<button type="button" onClick={() => setReminder("")} className={textButton}>
						No reminder
					</button>
				)}
			</div>
			<div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
				{confirming ? (
					<span className="flex flex-wrap items-center gap-2 text-sm">
						<span>Remove {habit.name}{habit.manual ? " and the days you marked" : ""}?</span>
						<button type="button" disabled={saving} onClick={() => run(() => growthApi.removeHabit(habit.id))} className={quietButton}>
							Remove
						</button>
						<button type="button" onClick={() => setConfirming(false)} className={textButton}>
							Keep it
						</button>
					</span>
				) : (
					<button type="button" onClick={() => setConfirming(true)} className={`${textButton} text-neutral-700 dark:text-neutral-300`}>
						Remove
					</button>
				)}
				{dirty && (
					<button type="button" disabled={saving || !name.trim()} onClick={save} className={goldButton}>
						Save
					</button>
				)}
			</div>
		</li>
	);
}

function CustomHabitForm({ saving, run }: { saving: boolean; run: (work: () => Promise<unknown>) => Promise<boolean> }) {
	const [name, setName] = useState("");
	const [target, setTarget] = useState(3);
	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (!name.trim()) return;
		const type: HabitType = "custom";
		if (await run(() => growthApi.addHabit({ type, name, target }))) setName("");
	};
	return (
		<form onSubmit={submit} className="mt-4">
			<label htmlFor="growth-custom-habit" className={`text-sm ${muted}`}>
				Or a habit of your own, like fasting, worship or serving:
			</label>
			<div className="mt-2 flex flex-wrap gap-2">
				<input
					id="growth-custom-habit"
					value={name}
					onChange={(event) => setName(event.target.value)}
					maxLength={HABIT_NAME_MAX}
					placeholder="Name your habit"
					className={`${field} min-w-0 flex-1 basis-48`}
				/>
				<label className="flex items-center gap-2 text-sm">
					<span className="sr-only">Days a week</span>
					<select value={target} onChange={(event) => setTarget(Number(event.target.value))} className={`${field} min-h-11 w-auto py-1.5`}>
						{[1, 2, 3, 4, 5, 6, 7].map((value) => (
							<option key={value} value={value}>
								{value} {value === 1 ? "day" : "days"} a week
							</option>
						))}
					</select>
				</label>
				<button type="submit" disabled={saving || !name.trim()} className={goldButton}>
					Add
				</button>
			</div>
		</form>
	);
}

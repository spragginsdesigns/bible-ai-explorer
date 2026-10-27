"use client";

import Link from "next/link";
import { BookOpenCheck } from "lucide-react";
import { useReadingPlan } from "@/components/plan/useReadingPlan";
import type { PathReadAlong } from "@/lib/beta/paths/paths-types";
import { CARD, EYEBROW, MUTED, QUIET_BUTTON, TEXT_LINK } from "./ui";

/**
 * Read along (LC-17648): the path's suggested reading through the app's own
 * Reading plans. One plan at a time is the plans' rule, so a founder already
 * on a plan is shown that plan, never offered a second that would replace it.
 */
export default function ReadAlongCard({ readAlong }: { readAlong: PathReadAlong }) {
	const { plan, presets, loading, busy, error, startPreset, startGoal } = useReadingPlan();
	const preset = readAlong.kind === "preset" ? presets.find((entry) => entry.key === readAlong.presetKey) : null;
	return (
		<section aria-labelledby="paths-read-along" className={`${CARD} p-5`}>
			<h2 id="paths-read-along" className={`${EYEBROW} flex items-center gap-2`}>
				<BookOpenCheck size={15} aria-hidden /> Read along
			</h2>
			{loading ? (
				<p className={`mt-2 text-sm ${MUTED}`} aria-busy="true">Checking your reading plan...</p>
			) : plan ? (
				<>
					<p className="mt-2 text-[15px] leading-6">
						You are reading <strong>{plan.title}</strong>, day {plan.currentDay} of {plan.dayCount}.
					</p>
					<Link href="/bible/plan" className={TEXT_LINK}>Open your plan</Link>
				</>
			) : (
				<>
					<p className="mt-2 text-[15px] font-bold leading-6">{readAlong.label}</p>
					<p className={`mt-1 text-sm leading-5 ${MUTED}`}>
						{preset?.description ?? (readAlong.kind === "goal" ? `A ${readAlong.days}-day reading plan, written for you from this goal: ${readAlong.goal}.` : "A reading plan to go alongside the lessons.")}
					</p>
					<button
						type="button"
						disabled={busy}
						onClick={() => void (readAlong.kind === "preset" ? startPreset(readAlong.presetKey) : startGoal(readAlong.goal, readAlong.days))}
						className={`${QUIET_BUTTON} mt-3 w-full`}
					>
						{busy ? "Starting..." : "Start this reading plan"}
					</button>
				</>
			)}
			{error && (
				<p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">
					{error}
				</p>
			)}
		</section>
	);
}

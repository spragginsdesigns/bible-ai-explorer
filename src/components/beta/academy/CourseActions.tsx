"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { GOLD_BUTTON, MUTED, QUIET_BUTTON } from "../paths/ui";
import { enrollInCourse, leaveCourse } from "./academyClient";

/** Enroll in a course (LC-17660). */
export function EnrollButton({ courseId, title }: { courseId: string; title: string }) {
	const router = useRouter();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const enroll = async () => {
		setBusy(true);
		setError(null);
		try {
			await enrollInCourse(courseId);
			router.refresh();
		} catch (err) {
			setError(err instanceof Error ? err.message : "That did not work. Please try again.");
			setBusy(false);
		}
	};
	return (
		<div className="flex flex-col gap-2">
			<button type="button" onClick={() => void enroll()} disabled={busy} className={GOLD_BUTTON} aria-label={`Enroll in ${title}`}>
				{busy ? "Enrolling..." : "Enroll in this course"} {!busy && <ArrowRight size={18} aria-hidden />}
			</button>
			{error && (
				<p role="alert" className="text-sm text-red-700 dark:text-red-300">
					{error}
				</p>
			)}
		</div>
	);
}

/** Start the course over, after a second tap. What was recorded of completing it stays. */
export function LeaveCourse({ courseId }: { courseId: string }) {
	const router = useRouter();
	const [confirming, setConfirming] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const run = async () => {
		setBusy(true);
		setError(null);
		try {
			await leaveCourse(courseId);
			setConfirming(false);
			router.refresh();
		} catch (err) {
			setError(err instanceof Error ? err.message : "That did not work. Please try again.");
		} finally {
			setBusy(false);
		}
	};
	return (
		<div className="flex flex-col gap-2 px-1">
			{confirming ? (
				<div role="group" aria-label="Start the course over?" className="flex flex-col gap-2">
					<p className="text-sm leading-5">
						Start this course over? Its lessons, checkpoints and milestones are cleared. Your record of completing it, your close readings, your memory cards and your notes stay.
					</p>
					<div className="flex gap-2">
						<button type="button" onClick={() => void run()} disabled={busy} className={`${QUIET_BUTTON} flex-1 border-red-700/30 text-red-800 dark:border-red-300/30 dark:text-red-200`}>
							Start over
						</button>
						<button type="button" onClick={() => setConfirming(false)} disabled={busy} className={`${QUIET_BUTTON} flex-1`}>
							Cancel
						</button>
					</div>
				</div>
			) : (
				<button type="button" onClick={() => setConfirming(true)} className={`${QUIET_BUTTON} ${MUTED} self-start`}>
					Start the course over
				</button>
			)}
			{error && (
				<p role="alert" className="text-sm text-red-700 dark:text-red-300">
					{error}
				</p>
			)}
		</div>
	);
}

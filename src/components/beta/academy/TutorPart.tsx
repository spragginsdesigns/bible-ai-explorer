"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { TUTOR_LEVELS, TUTOR_LEVEL_LABEL, type TutorLevel } from "@/lib/beta/tutor/tutor-rules";
import { TutorRequestError, tutorApi } from "../tutor/tutor-api";
import { GOLD_BUTTON } from "../paths/ui";

/**
 * Start a lesson's close reading (LC-17660) through the Socratic Tutor's own
 * route, which asks for AI consent, meters the call and asks the first
 * question; then open it inside the lesson.
 */
export default function TutorStart({ passage, href }: { passage: string; href: string }) {
	const router = useRouter();
	const [level, setLevel] = useState<TutorLevel>("growing");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const start = async () => {
		setBusy(true);
		setError(null);
		try {
			await tutorApi.start(passage, level);
			router.push(href);
		} catch (err) {
			setError(err instanceof TutorRequestError ? err.message : "The tutor could not start just now. Please try again.");
			setBusy(false);
		}
	};
	return (
		<div className="mt-4 flex flex-col gap-3">
			<fieldset disabled={busy}>
				<legend className="text-sm font-bold">How deep to go</legend>
				<div className="mt-2 grid grid-cols-3 gap-2">
					{TUTOR_LEVELS.map((option) => (
						<label
							key={option}
							className={`flex min-h-11 cursor-pointer items-center justify-center rounded-2xl border px-2 text-center text-sm font-bold transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-amber-600 dark:has-[:focus-visible]:ring-amber-300 ${
								level === option ? "border-amber-700/50 bg-amber-500/[.12] dark:border-amber-300/50 dark:bg-amber-300/[.1]" : "border-black/[.12] dark:border-white/[.14]"
							}`}
						>
							<input type="radio" name="tutor-level" value={option} checked={level === option} onChange={() => setLevel(option)} className="sr-only" />
							{TUTOR_LEVEL_LABEL[option]}
						</label>
					))}
				</div>
			</fieldset>
			<button type="button" onClick={() => void start()} disabled={busy} className={`${GOLD_BUTTON} w-full sm:w-auto sm:self-start`}>
				{busy ? "The tutor is reading the passage..." : "Start the close reading"} {!busy && <ArrowRight size={18} aria-hidden />}
			</button>
			{error && (
				<p role="alert" className="text-sm text-red-700 dark:text-red-300">
					{error}
				</p>
			)}
		</div>
	);
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteCurriculum, restartPath } from "./pathsClient";
import { MUTED, QUIET_BUTTON } from "./ui";

/** Start a path over, or delete a personal curriculum, each after a second tap. */
export default function PathActions({ pathId, started, personal }: { pathId: string; started: boolean; personal: boolean }) {
	const router = useRouter();
	const [confirming, setConfirming] = useState<"restart" | "delete" | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	if (!started && !personal) return null;

	const run = async () => {
		setBusy(true);
		setError(null);
		try {
			if (confirming === "delete") {
				await deleteCurriculum(pathId);
				router.push("/beta/learn/paths");
			} else {
				await restartPath(pathId);
				setConfirming(null);
			}
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
				<div role="group" aria-label={confirming === "delete" ? "Delete this curriculum?" : "Start over?"} className="flex flex-col gap-2">
					<p className="text-sm leading-5">
						{confirming === "delete"
							? "Delete this curriculum and your progress in it? What you have shown of each truth stays."
							: "Start this path over? Your lessons and review list are cleared; what you have shown of each truth stays."}
					</p>
					<div className="flex gap-2">
						<button type="button" onClick={() => void run()} disabled={busy} className={`${QUIET_BUTTON} flex-1 border-red-700/30 text-red-800 dark:border-red-300/30 dark:text-red-200`}>
							{confirming === "delete" ? "Delete" : "Start over"}
						</button>
						<button type="button" onClick={() => setConfirming(null)} disabled={busy} className={`${QUIET_BUTTON} flex-1`}>
							Cancel
						</button>
					</div>
				</div>
			) : (
				<div className="flex flex-wrap gap-2">
					{started && (
						<button type="button" onClick={() => setConfirming("restart")} className={`${QUIET_BUTTON} ${MUTED}`}>
							Start over
						</button>
					)}
					{personal && (
						<button type="button" onClick={() => setConfirming("delete")} className={`${QUIET_BUTTON} ${MUTED}`}>
							Delete curriculum
						</button>
					)}
				</div>
			)}
			{error && (
				<p role="alert" className="text-sm text-red-700 dark:text-red-300">
					{error}
				</p>
			)}
		</div>
	);
}

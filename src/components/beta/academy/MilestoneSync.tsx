"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Flag } from "lucide-react";
import type { AcademyMilestoneView } from "@/lib/beta/academy/academy-types";
import { CARD, EYEBROW, SERIF, TEXT_LINK } from "../paths/ui";
import { recordMilestones } from "./academyClient";
import { recordHref } from "./links";

/**
 * Records the milestones a page found reached (LC-17660), then shows them.
 * The server works out what is reached from the founder's lessons, tutor
 * sessions and memory cards; this only asks it to write them down, so
 * nothing is written by rendering a page and a repeat call adds nothing.
 */
export default function MilestoneSync({ courseId, pending, recordMissing }: { courseId: string; pending: string[]; recordMissing: boolean }) {
	const router = useRouter();
	const [added, setAdded] = useState<AcademyMilestoneView[]>([]);
	const [recordId, setRecordId] = useState<string | null>(null);
	const sent = useRef<string>("");
	const key = [...pending, ...(recordMissing ? ["record"] : [])].join(",");

	useEffect(() => {
		if (!key || sent.current === key) return;
		sent.current = key;
		recordMilestones(courseId)
			.then((result) => {
				if (result.added.length) setAdded((current) => [...current, ...result.added]);
				if (result.recordId) setRecordId(result.recordId);
				router.refresh();
			})
			.catch(() => {
				// Nothing is lost: the milestones stay reached and are recorded the next time a course page opens.
				sent.current = "";
			});
	}, [courseId, key, router]);

	if (added.length === 0) return null;
	// Lessons first, then units, then the course: the biggest last.
	const shown = [...added].sort((a, b) => rank(a.key) - rank(b.key));
	return (
		<section role="status" aria-live="polite" className={`${CARD} mb-6 flex gap-4 border-amber-700/30 bg-amber-500/[.08] p-5 dark:border-amber-300/25 dark:bg-amber-300/[.06]`}>
			<span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#e5b664] text-[#1c2118]">
				<Flag size={20} aria-hidden />
			</span>
			<div className="min-w-0">
				<p className={EYEBROW}>{shown.length === 1 ? "Milestone" : "Milestones"}</p>
				<ul className="mt-1 flex flex-col gap-0.5">
					{shown.map((milestone) => (
						<li key={milestone.key} className={`${SERIF} text-[22px] font-semibold leading-snug`}>
							{milestone.title}
						</li>
					))}
				</ul>
				{recordId && (
					<Link href={recordHref(recordId)} className={TEXT_LINK}>
						Open your record of this course
					</Link>
				)}
			</div>
		</section>
	);
}

function rank(key: string): number {
	return key === "course" ? 2 : key.startsWith("unit:") ? 1 : 0;
}

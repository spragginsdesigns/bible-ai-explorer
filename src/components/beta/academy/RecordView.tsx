import Link from "next/link";
import { ArrowLeft, Check, Flag } from "lucide-react";
import type { AcademyRecordView } from "@/lib/beta/academy/academy-types";
import { CARD, EYEBROW, MUTED, PAGE, SERIF, TEXT_LINK } from "../paths/ui";
import { LocalDate } from "../rooms/room-ui";
import { ACADEMY_BASE, courseHref } from "./links";

/** /beta/learn/academy/record/<id>: what a completed course covered, kept as it was finished (LC-17660). */
export default function RecordView({ view }: { view: AcademyRecordView }) {
	const lessons = view.units.flatMap((unit) => unit.lessons);
	// "John 1:1-3" is three verses.
	const verses = lessons.flatMap((lesson) => lesson.memory).reduce((sum, ref) => {
		const span = /:(\d+)(?:-(\d+))?$/.exec(ref);
		return sum + (span?.[2] ? Number(span[2]) - Number(span[1]) + 1 : 1);
	}, 0);
	const readings = lessons.filter((lesson) => lesson.tutorSessionId).length;
	return (
		<main className={`${PAGE} max-w-3xl`}>
			<Link href={ACADEMY_BASE} className={`-ml-2 rounded-lg px-2 ${TEXT_LINK} text-neutral-600 dark:text-[#bbb3a7]`}>
				<ArrowLeft size={18} aria-hidden /> SureWord Academy
			</Link>
			<header className="mt-2">
				<p className={EYEBROW}>Record of a completed course</p>
				<h1 className={`${SERIF} mt-1 text-[clamp(2.1rem,8vw,2.9rem)] font-semibold leading-[1.04]`}>{view.title}</h1>
				<p className={`mt-1 text-[15px] ${MUTED}`}>
					Enrolled <LocalDate iso={view.enrolledAt} /> · Completed <LocalDate iso={view.completedAt} />
				</p>
				<p className="mt-3 text-[15px] leading-6">
					{lessons.length} lessons read and answered, {readings} close {readings === 1 ? "reading" : "readings"} with the tutor, and {verses} {verses === 1 ? "verse" : "verses"} added to Scripture Memory.
				</p>
				<Link href={courseHref(view.courseId)} className={TEXT_LINK}>
					Open the course
				</Link>
			</header>
			<div className="mt-6 flex flex-col gap-4">
				{view.units.map((unit, index) => (
					<section key={unit.id} aria-labelledby={`record-${unit.id}`} className={`${CARD} p-5`}>
						<p className={EYEBROW}>Unit {index + 1}</p>
						<h2 id={`record-${unit.id}`} className={`${SERIF} mt-0.5 text-[24px] font-semibold leading-tight`}>
							{unit.title}
						</h2>
						{unit.completedAt && (
							<p className={`mt-1 inline-flex items-center gap-1.5 text-sm font-bold ${MUTED}`}>
								<Flag size={14} aria-hidden /> Finished <LocalDate iso={unit.completedAt} />
							</p>
						)}
						<ol className="mt-3 flex flex-col gap-3">
							{unit.lessons.map((lesson) => (
								<li key={lesson.id} className="flex gap-3">
									<Check size={18} className="mt-1 shrink-0 text-amber-800 dark:text-[#e5b664]" aria-hidden />
									<div className="min-w-0">
										<p className="font-bold leading-snug">{lesson.title}</p>
										<p className={`text-sm leading-5 ${MUTED}`}>
											Read {lesson.reading} · Memorized {lesson.memory.join(", ")}
										</p>
										{lesson.tutorSessionId ? (
											<Link href={`/beta/study/tutor/${lesson.tutorSessionId}`} className={TEXT_LINK}>
												Close reading of {lesson.tutor}
											</Link>
										) : (
											<p className={`text-sm ${MUTED}`}>Close reading of {lesson.tutor}</p>
										)}
									</div>
								</li>
							))}
						</ol>
					</section>
				))}
			</div>
		</main>
	);
}

import Link from "next/link";
import { ArrowLeft, ArrowRight, GraduationCap } from "lucide-react";
import type { CourseCardView } from "@/lib/beta/academy/academy-types";
import { DESTINATION_TILE, IconTile, moduleIcon } from "../visuals";
import PathArt from "../paths/PathArt";
import ProgressBar from "../paths/ProgressBar";
import { LocalDate } from "../rooms/room-ui";
import { CARD, EYEBROW, FOCUS, GOLD_BUTTON, MUTED, PAGE, SERIF, TEXT_LINK } from "../paths/ui";
import { courseHref, nextStepLink, recordHref } from "./links";

function CourseCard({ card }: { card: CourseCardView }) {
	return (
		<Link href={courseHref(card.id)} className={`${CARD} group flex flex-col overflow-hidden transition-colors hover:border-amber-700/30 dark:hover:border-amber-300/30 ${FOCUS}`}>
			<div className="relative h-28 sm:h-32">
				<PathArt pathId={card.id} className="absolute inset-0 h-full w-full" />
				<div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
				<h3 className={`${SERIF} absolute inset-x-0 bottom-0 px-4 pb-3 text-[25px] font-semibold leading-[1.1] text-white`}>{card.title}</h3>
			</div>
			<div className="flex flex-1 flex-col px-4 pb-4 pt-3">
				<p className={`text-sm font-bold ${MUTED}`}>
					{card.unitCount} units · {card.lessonCount} lessons · {card.audience}
				</p>
				<p className="mt-1 flex-1 text-[15px] leading-6">{card.tagline}</p>
				{card.enrolled ? (
					<div className="mt-3 flex items-center gap-3">
						<ProgressBar percent={card.percent} label={`${card.title} progress`} className="flex-1" />
						<span className="text-sm font-bold tabular-nums">
							{card.complete} of {card.lessonCount}
						</span>
					</div>
				) : (
					<span className="mt-3 inline-flex items-center gap-1.5 text-sm font-bold text-amber-800 dark:text-[#e5b664]">
						{card.completedAt ? (
							<>
								Completed <LocalDate iso={card.completedAt} /> · Take it again
							</>
						) : (
							"See the course"
						)} <ArrowRight size={16} aria-hidden className="transition-transform group-hover:translate-x-0.5" />
					</span>
				)}
			</div>
		</Link>
	);
}

/** The enrolled course the founder was last in that still has something to do. */
function continueCourse(courses: CourseCardView[]): CourseCardView | null {
	return courses.filter((card) => card.enrolled && card.next).sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))[0] ?? null;
}

/** /beta/learn/academy: continue, the courses, and the record of completed courses (LC-17660). */
export default function AcademyHub({ courses, records }: { courses: CourseCardView[]; records: { id: string; courseId: string; title: string; completedAt: string }[] }) {
	const resume = continueCourse(courses);
	const step = resume?.next ? nextStepLink(resume.id, resume.next) : null;
	return (
		<main className={`${PAGE} max-w-5xl`}>
			<Link href="/beta/learn" className={`-ml-2 rounded-lg px-2 ${TEXT_LINK} text-neutral-600 dark:text-[#bbb3a7]`}>
				<ArrowLeft size={18} aria-hidden /> Learn
			</Link>
			<header className="mt-2 flex items-center gap-4">
				<IconTile Icon={moduleIcon("academy", "learn")} tone={DESTINATION_TILE.learn} size="lg" />
				<div className="min-w-0">
					<h1 className={`${SERIF} text-[clamp(2.2rem,8vw,2.9rem)] font-semibold leading-[1.02]`}>SureWord Academy</h1>
					<p className={`mt-1 text-[15px] leading-6 ${MUTED}`}>Courses that teach the Bible and its doctrine, with a beginning and an end. Every answer is a verse.</p>
				</div>
			</header>

			{resume && step && (
				<section aria-labelledby="academy-continue" className="mt-7 overflow-hidden rounded-[26px] border border-amber-900/10 bg-white/30 dark:border-amber-200/10 dark:bg-white/[.02]">
					<div className="grid sm:grid-cols-[220px_1fr]">
						<div className="relative h-32 sm:h-full">
							<PathArt pathId={resume.id} className="absolute inset-0 h-full w-full" />
						</div>
						<div className="p-5">
							<h2 id="academy-continue" className={EYEBROW}>Continue</h2>
							<p className={`${SERIF} mt-1 text-[28px] font-semibold leading-tight`}>{resume.title}</p>
							<p className={`mt-1 text-[15px] ${MUTED}`}>{step.label}</p>
							<div className="mt-3 flex items-center gap-3">
								<ProgressBar percent={resume.percent} label={`${resume.title} progress`} className="flex-1" />
								<span className="text-sm font-bold tabular-nums">
									{resume.complete} of {resume.lessonCount}
								</span>
							</div>
							<Link href={step.href} className={`${GOLD_BUTTON} mt-4`}>
								Continue <ArrowRight size={18} aria-hidden />
							</Link>
						</div>
					</div>
				</section>
			)}

			<section aria-labelledby="academy-courses" className="mt-9">
				<h2 id="academy-courses" className={`${SERIF} text-[30px] font-semibold leading-tight`}>Courses</h2>
				<p className={`mt-1 text-sm ${MUTED}`}>Each lesson: read and answer from the passage, read it closely with the Socratic Tutor, and add its verses to Scripture Memory.</p>
				<div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{courses.map((card) => (
						<CourseCard key={card.id} card={card} />
					))}
				</div>
			</section>

			<section aria-labelledby="academy-record" className={`${CARD} mt-10 p-5 sm:p-6`}>
				<h2 id="academy-record" className={`${SERIF} text-[30px] font-semibold leading-tight`}>Your record</h2>
				{records.length === 0 ? (
					<p className={`mt-1 max-w-2xl text-[15px] leading-6 ${MUTED}`}>Courses you complete are kept here: what you read, the verses you memorized and the close readings you finished, with the dates.</p>
				) : (
					<ul className="mt-3 flex flex-col divide-y divide-black/[.07] dark:divide-white/[.08]">
						{records.map((record) => (
							<li key={record.id}>
								<Link href={recordHref(record.id)} className={`flex min-h-[56px] items-center gap-3 py-2 ${FOCUS}`}>
									<GraduationCap size={20} className="shrink-0 text-amber-800 dark:text-[#e5b664]" aria-hidden />
									<span className="min-w-0 flex-1">
										<span className="block font-bold">{record.title}</span>
										<span className={`block text-sm ${MUTED}`}>Completed <LocalDate iso={record.completedAt} /></span>
									</span>
									<ArrowRight size={18} aria-hidden />
								</Link>
							</li>
						))}
					</ul>
				)}
			</section>
			<p className={`mt-8 text-center text-xs ${MUTED}`}>Milestones mark what you have finished, never how you are doing. Questions you miss come back until they stick.</p>
		</main>
	);
}

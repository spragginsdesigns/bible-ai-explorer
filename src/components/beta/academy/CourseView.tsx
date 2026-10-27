import Link from "next/link";
import { ArrowLeft, ArrowRight, BookOpen, Check, Flag, GraduationCap, Lock, MessageCircleQuestion, Play, RotateCcw, Sprout } from "lucide-react";
import type { PartState } from "@/lib/beta/academy/academy-rules";
import type { CourseLessonView, CoursePageView, CourseUnitView } from "@/lib/beta/academy/academy-types";
import PathArt from "../paths/PathArt";
import ProgressBar from "../paths/ProgressBar";
import ReadAlongCard from "../paths/ReadAlongCard";
import { LocalDate } from "../rooms/room-ui";
import { CARD, EYEBROW, FOCUS, GOLD_BUTTON, MUTED, PAGE, QUIET_BUTTON, SERIF, TEXT_LINK, checkpointHref, finalHref, reviewHref } from "../paths/ui";
import { EnrollButton, LeaveCourse } from "./CourseActions";
import MilestoneSync from "./MilestoneSync";
import { ACADEMY_BASE, courseLessonHref, nextStepLink, recordHref } from "./links";

const NODE = "relative z-10 flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold";

const PART_LABEL = { quiz: "Read and answer", tutor: "Close reading", memory: "Memory verses" } as const;
const PART_ICON = { quiz: BookOpen, tutor: MessageCircleQuestion, memory: Sprout } as const;
const STATE_WORD: Record<PartState, string> = { done: "done", started: "started", open: "to do", locked: "locked" };

/** A lesson's three parts as small marks: gold when done, outlined when started or open. */
export function PartMarks({ lesson }: { lesson: Pick<CourseLessonView, "quiz" | "tutor" | "memory"> }) {
	return (
		<span className="mt-1.5 flex flex-wrap gap-1.5">
			{(["quiz", "tutor", "memory"] as const).map((part) => {
				const state = lesson[part];
				const Icon = state === "done" ? Check : PART_ICON[part];
				return (
					<span
						key={part}
						className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-bold ${
							state === "done"
								? "border-transparent bg-[#e5b664] text-[#1c2118]"
								: state === "started"
									? "border-amber-700/40 text-amber-900 dark:border-amber-300/40 dark:text-amber-200"
									: "border-black/10 text-neutral-600 dark:border-white/10 dark:text-neutral-400"
						}`}
					>
						<Icon size={12} aria-hidden />
						{PART_LABEL[part]}
						<span className="sr-only">: {STATE_WORD[state]}</span>
					</span>
				);
			})}
		</span>
	);
}

function LessonRow({ courseId, lesson, enrolled, isNext }: { courseId: string; lesson: CourseLessonView; enrolled: boolean; isNext: boolean }) {
	const locked = lesson.state === "locked" || !enrolled;
	const current = enrolled && isNext;
	const node = lesson.complete ? (
		<span className={`${NODE} border-[#e5b664] bg-[#e5b664] text-[#1c2118]`}>
			<Check size={22} strokeWidth={3} aria-hidden />
		</span>
	) : current ? (
		<span className={`${NODE} border-[#e5b664] bg-[#24281f] text-[#e5b664] shadow-[0_0_0_5px_rgba(229,182,100,.22)] dark:bg-[#1c2118]`}>
			<Play size={20} fill="currentColor" aria-hidden />
		</span>
	) : locked ? (
		<span className={`${NODE} border-black/10 bg-[#ece6d9] text-neutral-500 dark:border-white/10 dark:bg-[#1a1d18] dark:text-neutral-500`}>
			{enrolled ? <Lock size={18} aria-hidden /> : lesson.number}
		</span>
	) : (
		<span className={`${NODE} border-amber-700/40 bg-[#f6f2e9] text-amber-900 dark:border-amber-300/40 dark:bg-[#0d100d] dark:text-amber-200`}>{lesson.number}</span>
	);
	const status = lesson.complete ? "Complete" : current ? "Up next" : locked ? (enrolled ? "Locked" : "Enroll to begin") : "Open";
	const body = (
		<>
			{node}
			<span className="min-w-0 flex-1">
				<span className="block text-xs font-bold uppercase tracking-[.14em] text-neutral-500 dark:text-[#a59f92]">
					Lesson {lesson.number} · {lesson.reading}
				</span>
				<span className={`block text-[17px] font-bold leading-snug ${locked && enrolled ? "text-neutral-500 dark:text-neutral-500" : ""}`}>{lesson.title}</span>
				<span className={`block text-sm leading-5 ${MUTED}`}>{lesson.summary}</span>
				{enrolled && <PartMarks lesson={lesson} />}
			</span>
			<span className="sr-only">, {status}</span>
		</>
	);
	const row = `relative flex min-h-[72px] items-center gap-4 rounded-[18px] px-3 py-2.5 ${current ? "bg-amber-500/[.09] dark:bg-amber-300/[.07]" : ""}`;
	if (locked) {
		return (
			<li>
				<div className={`${row} ${enrolled ? "opacity-70" : ""}`} aria-disabled="true">
					{body}
				</div>
			</li>
		);
	}
	return (
		<li>
			<Link href={courseLessonHref(courseId, lesson.id)} aria-current={current ? "step" : undefined} className={`${row} transition-colors hover:bg-black/[.035] dark:hover:bg-white/[.04] ${FOCUS}`}>
				{body}
			</Link>
		</li>
	);
}

function UnitSection({ courseId, unit, enrolled, nextLessonId }: { courseId: string; unit: CourseUnitView; enrolled: boolean; nextLessonId: string | null }) {
	const complete = unit.lessons.filter((lesson) => lesson.complete).length;
	const checkpointOpen = enrolled && unit.checkpoint !== "locked";
	const checkpointBody = (
		<>
			<span className={`${NODE} ${unit.checkpoint === "done" ? "border-[#e5b664] bg-[#e5b664] text-[#1c2118]" : checkpointOpen ? "border-amber-700/50 bg-[#f6f2e9] text-amber-900 dark:border-amber-300/50 dark:bg-[#0d100d] dark:text-amber-200" : "border-black/10 bg-[#ece6d9] text-neutral-500 dark:border-white/10 dark:bg-[#1a1d18]"}`}>
				<Flag size={19} aria-hidden />
			</span>
			<span className="min-w-0 flex-1">
				<span className="block text-xs font-bold uppercase tracking-[.14em] text-neutral-500 dark:text-[#a59f92]">Unit checkpoint</span>
				<span className="block text-[16px] font-bold leading-snug">Test your understanding of this unit</span>
				<span className={`block text-sm ${MUTED}`}>
					{unit.checkpointScore
						? `${unit.checkpointScore.right} of ${unit.checkpointScore.total} right the first time. Take it again any time.`
						: checkpointOpen
							? "Questions from every lesson in the unit, deeper where you are strong."
							: "Opens when the unit's lessons have been answered."}
				</span>
			</span>
		</>
	);
	return (
		<section aria-labelledby={`unit-${unit.id}`} className="mt-8 first:mt-0">
			<div className={`${CARD} px-5 py-4`}>
				<p className={EYEBROW}>Unit {unit.number}</p>
				<h2 id={`unit-${unit.id}`} className={`${SERIF} mt-0.5 text-[26px] font-semibold leading-tight`}>{unit.title}</h2>
				<p className={`mt-0.5 text-sm ${MUTED}`}>
					{unit.summary}
					{enrolled ? ` · ${complete} of ${unit.lessons.length} lessons complete` : ` · ${unit.lessons.length} lessons`}
				</p>
				{unit.milestoneAt && (
					<p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[#e5b664] px-3 py-1 text-xs font-bold text-[#1c2118]">
						<Flag size={13} aria-hidden /> Unit finished <LocalDate iso={unit.milestoneAt} />
					</p>
				)}
			</div>
			<ol className="relative mt-3 flex flex-col gap-1 before:absolute before:bottom-8 before:left-[36px] before:top-8 before:w-0.5 before:bg-black/[.09] dark:before:bg-white/[.1]">
				{unit.lessons.map((lesson) => (
					<LessonRow key={lesson.id} courseId={courseId} lesson={lesson} enrolled={enrolled} isNext={lesson.id === nextLessonId} />
				))}
				<li>
					{checkpointOpen ? (
						<Link href={checkpointHref(courseId, unit.id, ACADEMY_BASE)} className={`relative flex min-h-[72px] items-center gap-4 rounded-[18px] px-3 py-2.5 transition-colors hover:bg-black/[.035] dark:hover:bg-white/[.04] ${FOCUS}`}>
							{checkpointBody}
						</Link>
					) : (
						<div aria-disabled="true" className="relative flex min-h-[72px] items-center gap-4 rounded-[18px] px-3 py-2.5 opacity-70">
							{checkpointBody}
						</div>
					)}
				</li>
			</ol>
		</section>
	);
}

function FinalSection({ view }: { view: CoursePageView }) {
	const open = view.enrolled && view.final.state !== "locked";
	const body = (
		<>
			<span className={`${NODE} ${view.final.state === "done" ? "border-[#e5b664] bg-[#e5b664] text-[#1c2118]" : open ? "border-amber-700/50 bg-[#f6f2e9] text-amber-900 dark:border-amber-300/50 dark:bg-[#0d100d] dark:text-amber-200" : "border-black/10 bg-[#ece6d9] text-neutral-500 dark:border-white/10 dark:bg-[#1a1d18]"}`}>
				<GraduationCap size={20} aria-hidden />
			</span>
			<span className="min-w-0 flex-1">
				<span className="block text-xs font-bold uppercase tracking-[.14em] text-neutral-500 dark:text-[#a59f92]">Final review</span>
				<span className="block text-[17px] font-bold leading-snug">The whole course, one question at a time</span>
				<span className={`block text-sm ${MUTED}`}>
					{view.final.score
						? `${view.final.score.right} of ${view.final.score.total} right the first time. Take it again any time.`
						: open
							? `Questions from every unit of ${view.title}.`
							: "Opens once every unit checkpoint is done."}
				</span>
			</span>
		</>
	);
	return (
		<section aria-label="Final review" className="mt-8">
			{open ? (
				<Link href={finalHref(view.id, ACADEMY_BASE)} className={`${CARD} relative flex min-h-[80px] items-center gap-4 px-3 py-3 transition-colors hover:border-amber-700/30 dark:hover:border-amber-300/30 ${FOCUS}`}>
					{body}
				</Link>
			) : (
				<div aria-disabled="true" className={`${CARD} relative flex min-h-[80px] items-center gap-4 px-3 py-3 opacity-70`}>
					{body}
				</div>
			)}
		</section>
	);
}

/** /beta/learn/academy/<course>: one course, its units, every lesson's parts, milestones and the final review. */
export default function CourseView({ view }: { view: CoursePageView }) {
	const next = view.next ? nextStepLink(view.id, view.next) : null;
	return (
		<main className={`${PAGE} max-w-6xl`}>
			<Link href={ACADEMY_BASE} className={`-ml-2 rounded-lg px-2 ${TEXT_LINK} text-neutral-600 dark:text-[#bbb3a7]`}>
				<ArrowLeft size={18} aria-hidden /> SureWord Academy
			</Link>

			{view.enrolled && <MilestoneSync courseId={view.id} pending={view.unrecorded} recordMissing={view.recordMissing} />}

			<header className="mt-2 overflow-hidden rounded-[28px] border border-amber-900/10 bg-white/25 dark:border-amber-200/10 dark:bg-white/[.015]">
				<div className="relative h-48 sm:h-60">
					<PathArt pathId={view.id} className="absolute inset-0 h-full w-full" />
					<div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
					<div className="absolute inset-x-0 bottom-0 p-5 sm:p-6">
						<p className="text-xs font-bold uppercase tracking-[.2em] text-white/85">SureWord Academy · Course</p>
						<h1 className={`${SERIF} mt-1 text-[clamp(2.1rem,7vw,3rem)] font-semibold leading-[1.04] text-white`}>{view.title}</h1>
						<p className="mt-1 text-sm font-bold text-white/90">
							{view.unitCount} units · {view.lessonCount} lessons · {view.audience}
						</p>
					</div>
				</div>
				<div className="px-5 pb-5 pt-4 sm:px-6">
					{view.enrolled && (
						<div className="flex items-center gap-3">
							<ProgressBar percent={view.percent} label={`${view.title} progress`} className="flex-1" />
							<span className="text-sm font-bold tabular-nums">
								{view.complete} of {view.lessonCount}
							</span>
						</div>
					)}
					<p className={`mt-3 max-w-3xl text-[15px] leading-6 ${MUTED}`}>{view.description}</p>
					<div className="mt-4 flex flex-wrap items-center gap-3">
						{!view.enrolled ? (
							<EnrollButton courseId={view.id} title={view.title} />
						) : next ? (
							<Link href={next.href} className={GOLD_BUTTON}>
								{view.complete === 0 && view.next?.kind === "lesson" && view.next.number === 1 ? "Begin" : "Continue"}: {next.label} <ArrowRight size={18} aria-hidden />
							</Link>
						) : (
							<p className="text-[15px] font-bold">Every lesson, checkpoint and the final review are done.</p>
						)}
						{view.enrolled && view.reviewCount > 0 && (
							<Link href={reviewHref(view.id, ACADEMY_BASE)} className={QUIET_BUTTON}>
								<RotateCcw size={16} aria-hidden /> Review {view.reviewCount} missed
							</Link>
						)}
					</div>
					{!view.enrolled && <p className={`mt-3 text-sm ${MUTED}`}>Each lesson has three parts: read the passage and answer from it, read it closely with the Socratic Tutor, and add its verses to Scripture Memory.</p>}
				</div>
			</header>

			<div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
				<div>
					{view.units.map((unit) => (
						<UnitSection key={unit.id} courseId={view.id} unit={unit} enrolled={view.enrolled} nextLessonId={view.next?.kind === "lesson" ? view.next.lessonId : null} />
					))}
					<FinalSection view={view} />
				</div>
				<aside className="flex flex-col gap-4 lg:sticky lg:top-8">
					<section aria-labelledby="academy-outcomes" className={`${CARD} p-5`}>
						<h2 id="academy-outcomes" className={EYEBROW}>What you will learn</h2>
						<ul className="mt-3 flex flex-col gap-2.5">
							{view.outcomes.map((outcome) => (
								<li key={outcome} className="flex gap-2.5 text-[15px] leading-6">
									<Check size={18} className="mt-0.5 shrink-0 text-amber-800 dark:text-[#e5b664]" aria-hidden />
									<span>{outcome}</span>
								</li>
							))}
						</ul>
						<p className={`mt-3 text-xs ${MUTED}`}>A summary of the course, not Scripture. Every answer in it is a verse you can read for yourself.</p>
					</section>
					{view.enrolled && (
						<section aria-labelledby="academy-milestones" className={`${CARD} p-5`}>
							<h2 id="academy-milestones" className={EYEBROW}>Milestones</h2>
							{view.milestones.length === 0 ? (
								<p className={`mt-2 text-sm leading-6 ${MUTED}`}>Finish a lesson&apos;s three parts and it is marked here. Each unit is finished with its checkpoint, and the course with its final review.</p>
							) : (
								<ul className="mt-3 flex flex-col gap-2">
									{view.milestones.slice(0, 8).map((milestone) => (
										<li key={milestone.key} className="flex items-start justify-between gap-3 text-[15px] leading-5">
											<span className="min-w-0">{milestone.title}</span>
											<span className={`shrink-0 text-xs font-bold ${MUTED}`}><LocalDate iso={milestone.at} /></span>
										</li>
									))}
								</ul>
							)}
						</section>
					)}
					{view.records.length > 0 && (
						<section aria-labelledby="academy-course-records" className={`${CARD} p-5`}>
							<h2 id="academy-course-records" className={EYEBROW}>Your record</h2>
							<ul className="mt-2 flex flex-col">
								{view.records.map((record) => (
									<li key={record.id}>
										<Link href={recordHref(record.id)} className={TEXT_LINK}>
											Completed <LocalDate iso={record.completedAt} />
										</Link>
									</li>
								))}
							</ul>
						</section>
					)}
					{view.readAlong && <ReadAlongCard readAlong={view.readAlong} />}
					{view.enrolled && <LeaveCourse courseId={view.id} />}
				</aside>
			</div>
		</main>
	);
}

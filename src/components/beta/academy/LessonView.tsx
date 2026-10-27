import Link from "next/link";
import { ArrowLeft, ArrowRight, BookOpen, Check, Flag, MessageCircleQuestion, Sprout } from "lucide-react";
import type { PartState } from "@/lib/beta/academy/academy-rules";
import type { LessonPageView } from "@/lib/beta/academy/academy-types";
import { CARD, EYEBROW, GOLD_BUTTON, MUTED, PAGE, QUIET_BUTTON, SERIF, TEXT_LINK, checkpointHref } from "../paths/ui";
import { LocalDate } from "../rooms/room-ui";
import MemoryPart from "./MemoryPart";
import MilestoneSync from "./MilestoneSync";
import TutorStart from "./TutorPart";
import { ACADEMY_BASE, courseHref, courseLessonHref, quizHref, tutorHref } from "./links";

const STATE_CHIP: Record<PartState, { label: string; tone: string }> = {
	done: { label: "Done", tone: "border-transparent bg-[#e5b664] text-[#1c2118]" },
	started: { label: "Started", tone: "border-amber-700/40 text-amber-900 dark:border-amber-300/40 dark:text-amber-200" },
	open: { label: "To do", tone: "border-black/10 text-neutral-600 dark:border-white/10 dark:text-neutral-300" },
	locked: { label: "Locked", tone: "border-black/10 text-neutral-500 dark:border-white/10 dark:text-neutral-500" },
};

function Part({
	step,
	title,
	Icon,
	state,
	children,
}: {
	step: number;
	title: string;
	Icon: typeof BookOpen;
	state: PartState;
	children: React.ReactNode;
}) {
	const chip = STATE_CHIP[state];
	return (
		<section aria-labelledby={`part-${step}`} className={`${CARD} p-5 ${state === "locked" ? "opacity-75" : ""}`}>
			<div className="flex items-start gap-4">
				<span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${state === "done" ? "bg-[#e5b664] text-[#1c2118]" : "bg-amber-500/[.12] text-amber-900 dark:bg-amber-300/[.1] dark:text-amber-200"}`}>
					{state === "done" ? <Check size={20} strokeWidth={3} aria-hidden /> : <Icon size={20} aria-hidden />}
				</span>
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<p className={EYEBROW}>Part {step}</p>
						<span className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${chip.tone}`}>{chip.label}</span>
					</div>
					<h2 id={`part-${step}`} className={`${SERIF} mt-0.5 text-[26px] font-semibold leading-tight`}>
						{title}
					</h2>
				</div>
			</div>
			<div className="mt-1">{children}</div>
		</section>
	);
}

/** /beta/learn/academy/<course>/<lesson>: a lesson's three parts and where each stands (LC-17660). */
export default function LessonView({ view }: { view: LessonPageView }) {
	const { courseId, lesson, quiz, tutor, memory } = view;
	const locked = lesson.state === "locked";
	return (
		<main className={`${PAGE} max-w-3xl`}>
			<Link href={courseHref(courseId)} className={`-ml-2 rounded-lg px-2 ${TEXT_LINK} text-neutral-600 dark:text-[#bbb3a7]`}>
				<ArrowLeft size={18} aria-hidden /> {view.courseTitle}
			</Link>

			<MilestoneSync courseId={courseId} pending={view.unrecorded} recordMissing={view.recordMissing} />

			<header className="mt-2">
				<p className={EYEBROW}>
					Unit {view.unit.number} · Lesson {lesson.number} of {lesson.total}
				</p>
				<h1 className={`${SERIF} mt-1 text-[clamp(2.1rem,8vw,2.9rem)] font-semibold leading-[1.04]`}>{lesson.title}</h1>
				<p className={`mt-1 text-[16px] leading-6 ${MUTED}`}>{lesson.summary}</p>
				{view.complete && (
					<p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[#e5b664] px-3 py-1 text-sm font-bold text-[#1c2118]">
						<Check size={15} strokeWidth={3} aria-hidden /> Lesson complete
						{view.completedAt && (
							<>
								{" · "}
								<LocalDate iso={view.completedAt} />
							</>
						)}
					</p>
				)}
				{locked && <p className={`mt-3 text-[15px] ${MUTED}`}>This lesson opens once the one before it has been answered.</p>}
			</header>

			<div className="mt-6 flex flex-col gap-4">
				<Part step={1} title="Read and answer" Icon={BookOpen} state={quiz.state}>
					<p className="text-[15px] leading-6">
						Read {lesson.reading} in the King James Bible with a short teaching, then answer {quiz.questions} questions. Every answer is shown with the verse that says it.
					</p>
					{quiz.score && <p className="mt-2 text-sm font-bold text-amber-800 dark:text-[#e5b664]">{quiz.score.right} of {quiz.score.total} right the first time</p>}
					{!locked && (
						<Link href={quizHref(courseId, lesson.id)} className={`${quiz.state === "done" ? QUIET_BUTTON : GOLD_BUTTON} mt-4 w-full sm:w-auto`}>
							{quiz.state === "done" ? "Take it again" : quiz.state === "started" ? "Pick up where you left off" : `Read ${lesson.reading}`} {quiz.state !== "done" && <ArrowRight size={18} aria-hidden />}
						</Link>
					)}
				</Part>

				<Part step={2} title="Read it closely with the tutor" Icon={MessageCircleQuestion} state={tutor.state}>
					<p className="text-[15px] leading-6">
						The Socratic Tutor takes you through {tutor.passage} one question at a time, from what it says to what it means, and checks your own conclusion against the text.
					</p>
					<div className="mt-3 rounded-2xl border border-dashed border-black/[.14] px-4 py-3 dark:border-white/[.16]">
						<p className={EYEBROW}>What to look for</p>
						<p className="mt-1 text-[15px] leading-6">{tutor.focus}</p>
						<p className={`mt-1 text-xs ${MUTED}`}>Teaching, not Scripture.</p>
					</div>
					{tutor.state === "done" ? (
						<>
							<p className="mt-3 text-sm font-bold">Your conclusion was checked against the text.</p>
							{tutor.sessionId && (
								<Link href={tutorHref(courseId, lesson.id)} className={`${QUIET_BUTTON} mt-3`}>
									Open the close reading
								</Link>
							)}
						</>
					) : tutor.state === "started" ? (
						<>
							<p className={`mt-3 text-sm ${MUTED}`}>
								{tutor.answered === 0 ? "The tutor has asked its first question." : `${tutor.answered} ${tutor.answered === 1 ? "answer" : "answers"} so far.`} This part is done once your conclusion is checked.
							</p>
							<Link href={tutorHref(courseId, lesson.id)} className={`${GOLD_BUTTON} mt-3 w-full sm:w-auto`}>
								Pick up the close reading <ArrowRight size={18} aria-hidden />
							</Link>
						</>
					) : !locked ? (
						<TutorStart passage={tutor.passage} href={tutorHref(courseId, lesson.id)} />
					) : null}
				</Part>

				<Part step={3} title="Hide it in your heart" Icon={Sprout} state={memory.state}>
					<p className="text-[15px] leading-6">
						Add {memory.verses.length === 1 ? "the lesson's verse" : `the lesson's ${memory.verses.length} verses`} to Scripture Memory, which brings {memory.verses.length === 1 ? "it" : "them"} back for review at the right time.
					</p>
					<MemoryPart verses={memory.verses} locked={locked} />
				</Part>
			</div>

			<nav aria-label="After this lesson" className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
				{view.checkpoint && view.checkpoint.state !== "done" && view.checkpoint.state !== "locked" ? (
					<Link href={checkpointHref(courseId, view.checkpoint.unitId, ACADEMY_BASE)} className={GOLD_BUTTON}>
						<Flag size={18} aria-hidden /> Finish the unit: {view.checkpoint.title} checkpoint
					</Link>
				) : view.next && view.complete && view.next.open ? (
					<Link href={courseLessonHref(courseId, view.next.id)} className={GOLD_BUTTON}>
						Next lesson: {view.next.title} <ArrowRight size={18} aria-hidden />
					</Link>
				) : null}
				<Link href={courseHref(courseId)} className={`${TEXT_LINK} justify-center sm:justify-start`}>
					Back to {view.courseTitle}
				</Link>
			</nav>
		</main>
	);
}

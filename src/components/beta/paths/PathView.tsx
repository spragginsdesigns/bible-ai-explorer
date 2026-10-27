import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, Flag, Lock, Play, RotateCcw } from "lucide-react";
import { conceptTitle } from "@/lib/beta/paths/player-rules";
import type { LessonNodeView, PathPageView, UnitNodeView } from "@/lib/beta/paths/view-types";
import PathActions from "./PathActions";
import PathArt from "./PathArt";
import ProgressBar from "./ProgressBar";
import ReadAlongCard from "./ReadAlongCard";
import { CARD, CONCEPT_LABEL, EYEBROW, FOCUS, GOLD_BUTTON, MUTED, PAGE, QUIET_BUTTON, SERIF, TEXT_LINK, checkpointHref, continueHref, lessonHref, reviewHref } from "./ui";

const NODE = "relative z-10 flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold";

function LessonNode({ pathId, lesson }: { pathId: string; lesson: LessonNodeView }) {
	const locked = lesson.state === "locked";
	const current = lesson.state === "current";
	const node =
		lesson.state === "done" ? (
			<span className={`${NODE} border-[#e5b664] bg-[#e5b664] text-[#1c2118]`}>
				<Check size={22} strokeWidth={3} aria-hidden />
			</span>
		) : current ? (
			<span className={`${NODE} border-[#e5b664] bg-[#24281f] text-[#e5b664] shadow-[0_0_0_5px_rgba(229,182,100,.22)] dark:bg-[#1c2118]`}>
				<Play size={20} fill="currentColor" aria-hidden />
			</span>
		) : locked ? (
			<span className={`${NODE} border-black/10 bg-[#ece6d9] text-neutral-500 dark:border-white/10 dark:bg-[#1a1d18] dark:text-neutral-500`}>
				<Lock size={18} aria-hidden />
			</span>
		) : (
			<span className={`${NODE} border-amber-700/40 bg-[#f6f2e9] text-amber-900 dark:border-amber-300/40 dark:bg-[#0d100d] dark:text-amber-200`}>{lesson.number}</span>
		);
	const status = lesson.state === "done" ? "Done" : current ? "Up next" : locked ? "Locked" : "Open";
	const body = (
		<>
			{node}
			<span className="min-w-0 flex-1">
				<span className="block text-xs font-bold uppercase tracking-[.14em] text-neutral-500 dark:text-[#a59f92]">
					Lesson {lesson.number} · {lesson.reading}
				</span>
				<span className={`block text-[17px] font-bold leading-snug ${locked ? "text-neutral-500 dark:text-neutral-500" : ""}`}>{lesson.title}</span>
				<span className={`block text-sm leading-5 ${MUTED}`}>{lesson.summary}</span>
				{lesson.score && (
					<span className="mt-1 block text-xs font-bold text-amber-800 dark:text-[#e5b664]">
						{lesson.score.right} of {lesson.score.total} right the first time
					</span>
				)}
			</span>
			<span className="sr-only">, {status}</span>
			{current && (
				<span className="hidden shrink-0 rounded-full bg-[#e5b664] px-3 py-1.5 text-sm font-bold text-[#1c2118] sm:inline-flex">
					{lesson.written ? "Start" : "Write and start"}
				</span>
			)}
		</>
	);
	const row = `relative flex min-h-[72px] items-center gap-4 rounded-[18px] px-3 py-2.5 ${current ? "bg-amber-500/[.09] dark:bg-amber-300/[.07]" : ""}`;
	if (locked) {
		return (
			<li>
				<div className={`${row} opacity-70`} aria-disabled="true">
					{body}
				</div>
			</li>
		);
	}
	return (
		<li>
			<Link href={lessonHref(pathId, lesson.id)} aria-current={current ? "step" : undefined} className={`${row} transition-colors hover:bg-black/[.035] dark:hover:bg-white/[.04] ${FOCUS}`}>
				{body}
			</Link>
		</li>
	);
}

function UnitSection({ pathId, unit, index }: { pathId: string; unit: UnitNodeView; index: number }) {
	const done = unit.lessons.filter((lesson) => lesson.state === "done").length;
	const checkpointOpen = unit.checkpoint !== "locked";
	const checkpointBody = (
		<>
			<span className={`${NODE} ${unit.checkpoint === "done" ? "border-[#e5b664] bg-[#e5b664] text-[#1c2118]" : checkpointOpen ? "border-amber-700/50 bg-[#f6f2e9] text-amber-900 dark:border-amber-300/50 dark:bg-[#0d100d] dark:text-amber-200" : "border-black/10 bg-[#ece6d9] text-neutral-500 dark:border-white/10 dark:bg-[#1a1d18]"}`}>
				<Flag size={19} aria-hidden />
			</span>
			<span className="min-w-0 flex-1">
				<span className="block text-xs font-bold uppercase tracking-[.14em] text-neutral-500 dark:text-[#a59f92]">Checkpoint</span>
				<span className="block text-[16px] font-bold leading-snug">Test your understanding of this unit</span>
				<span className={`block text-sm ${MUTED}`}>
					{unit.checkpointScore
						? `${unit.checkpointScore.right} of ${unit.checkpointScore.total} right the first time. Take it again any time.`
						: checkpointOpen
							? "Questions from every lesson in the unit, deeper where you are strong."
							: "Opens when the unit's lessons are done."}
				</span>
			</span>
		</>
	);
	return (
		<section aria-labelledby={`unit-${unit.id}`} className="mt-8 first:mt-0">
			<div className={`${CARD} px-5 py-4`}>
				<p className={EYEBROW}>Unit {index + 1}</p>
				<h2 id={`unit-${unit.id}`} className={`${SERIF} mt-0.5 text-[26px] font-semibold leading-tight`}>{unit.title}</h2>
				<p className={`mt-0.5 text-sm ${MUTED}`}>
					{unit.summary}
					{unit.summary ? " · " : ""}
					{done} of {unit.lessons.length} done
				</p>
			</div>
			<ol className="relative mt-3 flex flex-col gap-1 before:absolute before:bottom-8 before:left-[36px] before:top-8 before:w-0.5 before:bg-black/[.09] dark:before:bg-white/[.1]">
				{unit.lessons.map((lesson) => (
					<LessonNode key={lesson.id} pathId={pathId} lesson={lesson} />
				))}
				<li>
					{checkpointOpen ? (
						<Link href={checkpointHref(pathId, unit.id)} className={`relative flex min-h-[72px] items-center gap-4 rounded-[18px] px-3 py-2.5 transition-colors hover:bg-black/[.035] dark:hover:bg-white/[.04] ${FOCUS}`}>
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

const CONCEPT_CHIP: Record<string, string> = {
	mastered: "border-transparent bg-[#e5b664] text-[#1c2118]",
	growing: "border-amber-700/40 bg-amber-500/10 text-amber-900 dark:border-amber-300/40 dark:text-amber-200",
	learning: "border-black/10 bg-black/[.04] text-neutral-700 dark:border-white/10 dark:bg-white/[.05] dark:text-neutral-200",
	new: "border-black/10 text-neutral-500 dark:border-white/10 dark:text-neutral-400",
};

/** /beta/learn/paths/<id>: the map of one path. */
export default function PathView({ view }: { view: PathPageView }) {
	const primary = view.resume
		? { href: continueHref(view), label: `Resume ${view.resume.title}` }
		: view.next
			? { href: lessonHref(view.id, view.next.id), label: view.started ? `Continue: lesson ${view.next.number}` : "Start the path" }
			: null;
	const shown = view.concepts.filter((concept) => concept.state !== "new" || concept.comingBack);
	return (
		<main className={`${PAGE} max-w-6xl`}>
			<Link href="/beta/learn/paths" className={`-ml-2 rounded-lg px-2 ${TEXT_LINK} text-neutral-600 dark:text-[#bbb3a7]`}>
				<ArrowLeft size={18} aria-hidden /> Learning Paths
			</Link>

			<header className="mt-2 overflow-hidden rounded-[28px] border border-amber-900/10 bg-white/25 dark:border-amber-200/10 dark:bg-white/[.015]">
				<div className="relative h-48 sm:h-60">
					<PathArt pathId={view.id} className="absolute inset-0 h-full w-full" />
					<div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
					<div className="absolute inset-x-0 bottom-0 p-5 sm:p-6">
						<p className="text-xs font-bold uppercase tracking-[.2em] text-white/85">{view.personal ? `Your curriculum · ${view.topic}` : "Learning path"}</p>
						<h1 className={`${SERIF} mt-1 text-[clamp(2.1rem,7vw,3rem)] font-semibold leading-[1.04] text-white`}>{view.title}</h1>
						<p className="mt-1 text-sm font-bold text-white/90">
							{view.lessonCount} lessons · {view.personal ? "Foundations first" : view.audience}
						</p>
					</div>
				</div>
				<div className="px-5 pb-5 pt-4 sm:px-6">
					<div className="flex items-center gap-3">
						<ProgressBar percent={view.percent} label={`${view.title} progress`} className="flex-1" />
						<span className="text-sm font-bold tabular-nums">{view.percent}%</span>
					</div>
					<p className={`mt-3 max-w-3xl text-[15px] leading-6 ${MUTED}`}>{view.description}</p>
					<div className="mt-4 flex flex-wrap items-center gap-3">
						{primary && (
							<Link href={primary.href} className={GOLD_BUTTON}>
								{primary.label} <ArrowRight size={18} aria-hidden />
							</Link>
						)}
						{view.reviewCount > 0 && (
							<Link href={reviewHref(view.id)} className={QUIET_BUTTON}>
								<RotateCcw size={16} aria-hidden /> Review {view.reviewCount} missed
							</Link>
						)}
						{!primary && view.reviewCount === 0 && <p className="text-[15px] font-bold">Every lesson done. Take a checkpoint again any time.</p>}
					</div>
				</div>
			</header>

			<div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
				<div>
					{view.units.map((unit, index) => (
						<UnitSection key={unit.id} pathId={view.id} unit={unit} index={index} />
					))}
				</div>
				<aside className="flex flex-col gap-4 lg:sticky lg:top-8">
					<section aria-labelledby="paths-understanding" className={`${CARD} p-5`}>
						<h2 id="paths-understanding" className={EYEBROW}>What you have shown</h2>
						{shown.length === 0 ? (
							<p className={`mt-2 text-sm leading-6 ${MUTED}`}>As you answer, each truth this path teaches shows here: learning, growing, then mastered. Mastered ones get deeper questions; missed ones come back.</p>
						) : (
							<ul className="mt-3 flex flex-col gap-2">
								{shown.map((item) => (
									<li key={item.concept} className="flex items-center justify-between gap-3 text-[15px]">
										<span className="min-w-0">{conceptTitle(item.concept)}</span>
										<span className="flex shrink-0 items-center gap-1.5">
											{item.comingBack && <RotateCcw size={14} className="text-amber-800 dark:text-[#e5b664]" aria-label="coming back in review" />}
											<span className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${CONCEPT_CHIP[item.state]}`}>{CONCEPT_LABEL[item.state]}</span>
										</span>
									</li>
								))}
							</ul>
						)}
					</section>
					{view.readAlong && <ReadAlongCard readAlong={view.readAlong} />}
					<PathActions pathId={view.id} started={view.started} personal={view.personal} />
				</aside>
			</div>
		</main>
	);
}

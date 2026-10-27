/**
 * What SureWord Academy's pages hand the browser (LC-17660,
 * docs/beta/academy.md). Course content stays on the server: a page sends the
 * map of a course and the lesson being taken, never the bank of questions.
 * Scripture text in these views is always the bundled KJV's.
 */
import type { PathAudience, PathReadAlong, SessionScore } from "../paths/paths-types";
import type { LessonState } from "../paths/progress-rules";
import type { MilestoneKey, NextStep, PartState } from "./academy-rules";

export interface AcademyMilestoneView {
	key: MilestoneKey;
	title: string;
	at: string;
}

export interface CourseLessonView {
	id: string;
	number: number;
	title: string;
	summary: string;
	reading: string;
	/** Its place on the map: the questions open one lesson after another. */
	state: LessonState;
	quiz: PartState;
	tutor: PartState;
	memory: PartState;
	complete: boolean;
	completedAt: string | null;
}

export interface CourseUnitView {
	id: string;
	number: number;
	title: string;
	summary: string;
	lessons: CourseLessonView[];
	checkpoint: "locked" | "open" | "done";
	checkpointScore: SessionScore | null;
	/** When the unit's milestone was reached, if it has been. */
	milestoneAt: string | null;
}

export interface CourseCardView {
	id: string;
	title: string;
	tagline: string;
	audience: PathAudience;
	lessonCount: number;
	unitCount: number;
	enrolled: boolean;
	/** Lessons with every part done. */
	complete: number;
	percent: number;
	next: NextStep | null;
	/** The founder has finished the course at least once. */
	completedAt: string | null;
	updatedAt: string | null;
}

export interface CoursePageView extends CourseCardView {
	description: string;
	outcomes: string[];
	readAlong: PathReadAlong | null;
	units: CourseUnitView[];
	final: { state: "locked" | "open" | "done"; score: SessionScore | null };
	reviewCount: number;
	/** Recorded milestones, newest first. */
	milestones: AcademyMilestoneView[];
	/** Reached but not recorded yet: the page records them as soon as it opens. */
	unrecorded: MilestoneKey[];
	/** Recorded complete but its record is missing (a failed write): the page asks for it too. */
	recordMissing: boolean;
	records: { id: string; completedAt: string }[];
}

export interface MemoryVerseView {
	ref: string;
	text: string;
	inDeck: boolean;
}

export interface LessonPageView {
	courseId: string;
	courseTitle: string;
	enrolled: boolean;
	unit: { id: string; number: number; title: string };
	lesson: { id: string; number: number; total: number; title: string; summary: string; reading: string; state: LessonState };
	quiz: { state: PartState; score: SessionScore | null; questions: number };
	tutor: { state: PartState; passage: string; focus: string; sessionId: string | null; answered: number };
	memory: { state: PartState; verses: MemoryVerseView[] };
	complete: boolean;
	completedAt: string | null;
	next: { id: string; title: string; open: boolean } | null;
	/** The unit's checkpoint, once every lesson in it is complete. */
	checkpoint: { unitId: string; title: string; state: "locked" | "open" | "done" } | null;
	unrecorded: MilestoneKey[];
	recordMissing: boolean;
}

export interface AcademyRecordView {
	id: string;
	courseId: string;
	title: string;
	enrolledAt: string;
	completedAt: string;
	units: {
		id: string;
		title: string;
		completedAt: string | null;
		lessons: { id: string; title: string; reading: string; memory: string[]; tutor: string; tutorSessionId: string | null; completedAt: string | null }[];
	}[];
}

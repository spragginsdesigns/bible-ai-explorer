import type { NextStep } from "@/lib/beta/academy/academy-rules";
import { checkpointHref, finalHref } from "../paths/ui";

/** SureWord Academy's pages (LC-17660). A course's sessions use Paths' own player under this base. */
export const ACADEMY_BASE = "/beta/learn/academy";

export function courseHref(courseId: string): string {
	return `${ACADEMY_BASE}/${courseId}`;
}

export function courseLessonHref(courseId: string, lessonId: string): string {
	return `${ACADEMY_BASE}/${courseId}/${lessonId}`;
}

export function quizHref(courseId: string, lessonId: string): string {
	return `${courseLessonHref(courseId, lessonId)}/quiz`;
}

export function tutorHref(courseId: string, lessonId: string): string {
	return `${courseLessonHref(courseId, lessonId)}/tutor`;
}

export function recordHref(recordId: string): string {
	return `${ACADEMY_BASE}/record/${recordId}`;
}

/** Where a course's "Continue" goes, and what it says. */
export function nextStepLink(courseId: string, next: NextStep): { href: string; label: string } {
	if (next.kind === "lesson") return { href: courseLessonHref(courseId, next.lessonId), label: `Lesson ${next.number}: ${next.title}` };
	if (next.kind === "checkpoint") return { href: checkpointHref(courseId, next.unitId, ACADEMY_BASE), label: `${next.title} checkpoint` };
	return { href: finalHref(courseId, ACADEMY_BASE), label: "The final review" };
}

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { courseHref, courseLessonHref } from "@/components/beta/academy/links";
import TutorSession from "@/components/beta/tutor/TutorSession";
import { isEnrolled, lessonTutorSession } from "@/lib/beta/academy/academy";
import { lessonPlace } from "@/lib/beta/academy/academy-rules";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";
import { writtenCourse } from "@/lib/beta/paths/catalog";
import { viewOf } from "@/lib/beta/tutor/tutor";

type Props = { params: Promise<{ courseId: string; step: string }> };

export async function generateMetadata(): Promise<Metadata> {
	return betaMetadata({ title: "Socratic Tutor" });
}

/**
 * Part two of a course lesson (LC-17660): its close reading, which is the
 * Socratic Tutor's own session on the lesson's passage, shown inside the
 * lesson. With none started yet, the lesson page is where to start one.
 */
export default async function AcademyTutorPage({ params }: Props) {
	const userId = await requireBetaPage();
	const { courseId, step } = await params;
	const def = writtenCourse(courseId);
	const place = def && lessonPlace(def, step);
	if (!def || !place) notFound();
	if (!(await isEnrolled(userId, def.id))) redirect(courseHref(def.id));
	const lessonHref = courseLessonHref(def.id, place.lesson.id);
	const loaded = await lessonTutorSession(userId, def, place.lesson.id);
	if (!loaded) redirect(lessonHref);
	return <TutorSession initial={await viewOf(loaded)} back={{ href: lessonHref, label: `Lesson ${place.number}: ${place.lesson.title}` }} />;
}

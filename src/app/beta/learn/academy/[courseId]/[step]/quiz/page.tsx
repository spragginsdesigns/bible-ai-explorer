import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ACADEMY_BASE, courseHref, courseLessonHref } from "@/components/beta/academy/links";
import LessonPlayer from "@/components/beta/paths/LessonPlayer";
import { isEnrolled } from "@/lib/beta/academy/academy";
import { lessonPlace } from "@/lib/beta/academy/academy-rules";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";
import { writtenCourse } from "@/lib/beta/paths/catalog";

type Props = { params: Promise<{ courseId: string; step: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
	const { courseId, step } = await params;
	const def = writtenCourse(courseId);
	return betaMetadata({ title: (def && lessonPlace(def, step)?.lesson.title) ?? "Not found" });
}

/**
 * Part one of a course lesson (LC-17660): its reading, teaching and
 * questions, in Learning Paths' own player and session, so review,
 * adaptivity and resuming at the same question come with it.
 */
export default async function AcademyQuizPage({ params }: Props) {
	const userId = await requireBetaPage();
	const { courseId, step } = await params;
	const def = writtenCourse(courseId);
	const place = def && lessonPlace(def, step);
	if (!def || !place) notFound();
	if (!(await isEnrolled(userId, def.id))) redirect(courseHref(def.id));
	const lessonHref = courseLessonHref(def.id, place.lesson.id);
	return (
		<LessonPlayer
			key={`${def.id}/lesson/${place.lesson.id}`}
			pathId={def.id}
			pathTitle={def.title}
			kind="lesson"
			target={place.lesson.id}
			title={place.lesson.title}
			needsWriting={false}
			reading={place.lesson.reading}
			base={ACADEMY_BASE}
			leaveHref={lessonHref}
			continueTo={{ href: lessonHref, label: "Continue the lesson" }}
		/>
	);
}

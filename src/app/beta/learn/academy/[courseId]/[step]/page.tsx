import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import LessonView from "@/components/beta/academy/LessonView";
import { ACADEMY_BASE, courseHref } from "@/components/beta/academy/links";
import LessonPlayer from "@/components/beta/paths/LessonPlayer";
import { isEnrolled, lessonPage } from "@/lib/beta/academy/academy";
import { lessonPlace } from "@/lib/beta/academy/academy-rules";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";
import { writtenCourse } from "@/lib/beta/paths/catalog";

type Props = { params: Promise<{ courseId: string; step: string }>; searchParams: Promise<{ unit?: string | string[] }> };

const SESSION_TITLE: Record<string, string> = { review: "Review", final: "Final review", checkpoint: "Checkpoint" };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
	const { courseId, step } = await params;
	const def = writtenCourse(courseId);
	return betaMetadata({ title: (def && (lessonPlace(def, step)?.lesson.title ?? SESSION_TITLE[step])) ?? "Not found" });
}

/**
 * A course lesson's page (/beta/learn/academy/<course>/<lesson id>), or one of
 * the course's Paths sessions: the review of missed questions (/review), a
 * unit checkpoint (/checkpoint?unit=<unit id>) or the final review (/final).
 * Anything else is the ordinary 404; a founder not enrolled goes to the course.
 */
export default async function AcademyStepPage({ params, searchParams }: Props) {
	const userId = await requireBetaPage();
	const { courseId, step } = await params;
	const def = writtenCourse(courseId);
	if (!def) notFound();
	if (step === "review" || step === "final" || step === "checkpoint") {
		let target = "";
		let title = step === "review" ? "Review" : "Final review";
		if (step === "checkpoint") {
			const raw = (await searchParams).unit;
			const unit = def.units.find((entry) => entry.id === (Array.isArray(raw) ? raw[0] : raw));
			if (!unit) notFound();
			target = unit.id;
			title = `${unit.title} checkpoint`;
		}
		if (!(await isEnrolled(userId, def.id))) redirect(courseHref(def.id));
		return (
			<LessonPlayer
				key={`${def.id}/${step}/${target}`}
				pathId={def.id}
				pathTitle={def.title}
				kind={step}
				target={target}
				title={title}
				needsWriting={false}
				reading={null}
				base={ACADEMY_BASE}
			/>
		);
	}
	const view = await lessonPage(userId, def, step);
	if (!view) notFound();
	if (!view.enrolled) redirect(courseHref(def.id));
	return <LessonView view={view} />;
}

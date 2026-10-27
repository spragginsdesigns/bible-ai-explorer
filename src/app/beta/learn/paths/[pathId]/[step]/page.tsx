import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import LessonPlayer from "@/components/beta/paths/LessonPlayer";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";
import { writtenPath } from "@/lib/beta/paths/catalog";
import type { SessionKind } from "@/lib/beta/paths/paths-types";
import { lessonsOf } from "@/lib/beta/paths/progress-rules";
import { loadPath } from "@/lib/beta/paths/server";

type Props = { params: Promise<{ pathId: string; step: string }>; searchParams: Promise<{ unit?: string | string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
	const { pathId, step } = await params;
	const lesson = writtenPath(pathId) && lessonsOf(writtenPath(pathId)!).find((entry) => entry.id === step);
	return betaMetadata({ title: lesson ? lesson.title : step === "review" ? "Review" : "Lesson" });
}

/**
 * A lesson (/beta/learn/paths/<path>/<lesson id>), the review of missed
 * questions (/review), or a unit checkpoint (/checkpoint?unit=<unit id>).
 * Anything else is the ordinary 404. The player starts or resumes the session
 * through the API once it is on screen, so nothing is written by rendering.
 */
export default async function LearningPathStepPage({ params, searchParams }: Props) {
	const userId = await requireBetaPage();
	const { pathId, step } = await params;
	const loaded = await loadPath(userId, pathId);
	if (!loaded) notFound();
	// A course's lessons and reviews live in SureWord Academy (LC-17660).
	if (loaded.def.course) redirect(`/beta/learn/academy/${loaded.def.id}`);
	let kind: SessionKind;
	let target = "";
	let title: string;
	let needsWriting = false;
	let reading: string | null = null;
	if (step === "review") {
		kind = "review";
		title = "Review";
	} else if (step === "checkpoint") {
		const raw = (await searchParams).unit;
		const unit = loaded.def.units.find((entry) => entry.id === (Array.isArray(raw) ? raw[0] : raw));
		if (!unit) notFound();
		kind = "checkpoint";
		target = unit.id;
		title = `${unit.title} checkpoint`;
	} else {
		const lesson = lessonsOf(loaded.def).find((entry) => entry.id === step);
		if (!lesson) notFound();
		kind = "lesson";
		target = lesson.id;
		title = lesson.title;
		needsWriting = !loaded.written.has(lesson.id);
		reading = lesson.reading;
	}
	return (
		<LessonPlayer
			key={`${pathId}/${kind}/${target}`}
			pathId={loaded.def.id}
			pathTitle={loaded.def.title}
			kind={kind}
			target={target}
			title={title}
			needsWriting={needsWriting}
			reading={reading}
		/>
	);
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import CourseView from "@/components/beta/academy/CourseView";
import { coursePage } from "@/lib/beta/academy/academy";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";
import { writtenCourse } from "@/lib/beta/paths/catalog";

type Props = { params: Promise<{ courseId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
	const { courseId } = await params;
	return betaMetadata({ title: writtenCourse(courseId)?.title ?? "Not found" });
}

/** One course (LC-17660): its units, lessons and their parts, milestones and the final review. */
export default async function AcademyCoursePage({ params }: Props) {
	const userId = await requireBetaPage();
	const def = writtenCourse((await params).courseId);
	if (!def) notFound();
	return <CourseView view={await coursePage(userId, def)} />;
}

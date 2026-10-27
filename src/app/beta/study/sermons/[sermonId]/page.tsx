import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SermonStudyView from "@/components/beta/sermons/SermonStudyView";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";
import { sermonView } from "@/lib/beta/sermons/server";

type Props = { params: Promise<{ sermonId: string }> };

export function generateMetadata(): Promise<Metadata> {
	return betaMetadata({ title: "Sermon to Study" });
}

/** One sermon (LC-17643): its passages in context, the study, the transcript, and what is marked for research. */
export default async function SermonPage({ params }: Props) {
	const userId = await requireBetaPage();
	const view = await sermonView(userId, (await params).sermonId);
	if (!view) notFound();
	return <SermonStudyView view={view} />;
}

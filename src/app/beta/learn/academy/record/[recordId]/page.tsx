import type { Metadata } from "next";
import { notFound } from "next/navigation";
import RecordView from "@/components/beta/academy/RecordView";
import { recordPage } from "@/lib/beta/academy/academy";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";

type Props = { params: Promise<{ recordId: string }> };

export function generateMetadata(): Promise<Metadata> {
	return betaMetadata({ title: "Your record" });
}

/** The record of a completed course (LC-17660). Someone else's id is the ordinary 404. */
export default async function AcademyRecordPage({ params }: Props) {
	const userId = await requireBetaPage();
	const view = await recordPage(userId, (await params).recordId);
	if (!view) notFound();
	return <RecordView view={view} />;
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import TutorSession from "@/components/beta/tutor/TutorSession";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";
import { loadSession, viewOf } from "@/lib/beta/tutor/tutor";

/** One close reading, resumed exactly where it was left. Someone else's id is the ordinary 404. */
type Props = { params: Promise<{ id: string }> };

export function generateMetadata(): Promise<Metadata> {
	return betaMetadata({ title: "Socratic Tutor" });
}

export default async function BetaTutorSessionPage({ params }: Props) {
	const userId = await requireBetaPage();
	const loaded = await loadSession(userId, (await params).id);
	if (!loaded) notFound();
	return <TutorSession initial={await viewOf(loaded)} />;
}

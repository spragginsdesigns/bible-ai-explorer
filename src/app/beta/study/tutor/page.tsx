import type { Metadata } from "next";
import TutorHome from "@/components/beta/tutor/TutorHome";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";
import { listSessions } from "@/lib/beta/tutor/tutor";

/**
 * The Socratic Tutor (LC-17650, docs/beta/tutor.md): choose a passage and a
 * level, or pick up a paused close reading. `?passage=Romans 5:1-11` opens it
 * with that passage ready, so the reader and other modules can link straight in.
 */
type Props = { searchParams: Promise<{ passage?: string | string[] }> };

export function generateMetadata(): Promise<Metadata> {
	return betaMetadata({ title: "Socratic Tutor" });
}

export default async function BetaTutorPage({ searchParams }: Props) {
	const userId = await requireBetaPage();
	const { passage } = await searchParams;
	const sessions = await listSessions(userId);
	return <TutorHome sessions={sessions} initialPassage={typeof passage === "string" ? passage.slice(0, 80) : ""} />;
}

import type { Metadata } from "next";
import VoiceStudy from "@/components/beta/voice/VoiceStudy";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";
import { listVoiceSessions } from "@/lib/beta/voice/sessions";

/**
 * Voice Study (LC-17653, docs/beta/voice.md): a hands-free spoken conversation
 * about Scripture, at /beta/study/voice. This static route replaces the
 * module's placeholder.
 */
export function generateMetadata(): Promise<Metadata> {
	return betaMetadata({ title: "Voice Study" });
}

export default async function VoiceStudyPage() {
	const userId = await requireBetaPage();
	const sessions = await listVoiceSessions(userId);
	return <VoiceStudy initialSessions={sessions} />;
}

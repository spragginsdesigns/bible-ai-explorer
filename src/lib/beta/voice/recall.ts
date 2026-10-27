import "server-only";

import { prisma } from "@/lib/prisma";
import { hasCurrentAiConsent } from "@/lib/preferences-contract";
import { privateBetaItemIds } from "@/lib/beta/store";
import { VaultInputError } from "@/lib/beta/vault/search";
import { vaultTimeline } from "@/lib/beta/vault/timeline";
import { getVoiceSession } from "@/lib/beta/voice/sessions";
import type { StudyRecall } from "@/lib/beta/voice/voice-rules";

/**
 * recallStudy (LC-17724, docs/beta/voice.md): "continue our conversation about
 * James". The founder's own past study on a passage or topic, read through the
 * Knowledge Vault's study memory (`vaultTimeline`: notes, highlights, chats,
 * reading, Learn a verse, memories, sermon studies and every beta item,
 * earlier Voice Study conversations included), never a second index.
 *
 * It hands the founder's words to the realtime model, so like the Vault's Ask
 * it runs only for an account that has agreed to AI, and private items
 * (`data.private: true`) are dropped whole before anything is sent.
 */

const SUBJECT_MAX = 60;

export async function recallStudy(userId: string, args: unknown): Promise<StudyRecall> {
	const raw = typeof args === "object" && args !== null ? (args as Record<string, unknown>).subject : null;
	const subject = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, SUBJECT_MAX) : "";
	if (!subject) return { status: "not_understood", subject: "" };

	const user = await prisma.user.findUnique({ where: { id: userId }, select: { aiConsentVersion: true, aiConsentAt: true } });
	if (!hasCurrentAiConsent(user)) return { status: "consent_needed" };

	let timeline;
	try {
		timeline = await vaultTimeline(userId, { subject });
	} catch (error) {
		if (error instanceof VaultInputError) return { status: "not_understood", subject };
		throw error;
	}
	const studyIds = timeline.entries.filter((entry) => entry.kind === "study").map((entry) => entry.sourceId);
	const hidden = await privateBetaItemIds(userId, studyIds);
	const entries = timeline.entries
		.filter((entry) => !(entry.kind === "study" && hidden.has(entry.sourceId)))
		.sort((a, b) => b.date.localeCompare(a.date));
	const subjectLabel = { kind: timeline.subject.kind, label: timeline.subject.label };
	if (entries.length === 0) return { status: "nothing_yet", subject: subjectLabel, entries: [] };

	const lastVoice = entries.find((entry) => entry.kind === "study" && entry.module === "voice");
	const session = lastVoice ? await getVoiceSession(userId, lastVoice.sourceId) : null;
	return {
		status: "found",
		subject: subjectLabel,
		entries,
		lastConversation: session && lastVoice ? { date: lastVoice.date, turns: session.turns } : null,
	};
}

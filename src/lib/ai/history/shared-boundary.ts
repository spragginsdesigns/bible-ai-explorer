import type { HistoryService } from "./contracts";
import { shareAnswer, extractReferences, shareTranslation } from "../../shared-answer";
import { stripFollowUpMarkers } from "../../../utils/assistantMarkdown";

export interface ShareSourceLocator { userId: string; conversationId: string | null; messageId: string | null }
export interface ReviewedShareFields { answer: string; references: string[]; translation: string }
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** Public snapshots are never silently rewritten. Their exact display must still be approved. */
export async function reviewedShareSource(service: Pick<HistoryService, "get">, source: ShareSourceLocator): Promise<ReviewedShareFields | null> {
	if (!source.messageId || !source.conversationId) return null;
	try {
		const result = await service.get(source.userId, { surface: "chat", parentId: source.conversationId, messageId: source.messageId });
		const body = record(result.body), row = record(body?.row), metadata = record(row?.metadata);
		if (result.status !== 200 || body?.state !== "verified" || typeof body.sourceDigest !== "string" || !/^[a-f0-9]{64}$/.test(body.sourceDigest)
			|| row?.id !== source.messageId || row?.role !== "assistant" || typeof row.content !== "string" || !metadata || !Array.isArray(metadata.parts)
			|| !metadata.parts.every(part => { const item = record(part); return item && typeof item.type === "string"; })
			|| Object.prototype.hasOwnProperty.call(metadata, "historyVerification")
			|| typeof metadata.translation !== "string") return null;
		const answer = shareAnswer(stripFollowUpMarkers(row.content, { streaming: false }));
		if (!answer) return null;
		return { answer, references: extractReferences(metadata), translation: shareTranslation(metadata, null) };
	} catch { return null; }
}
export function sharedSnapshotMatches(snapshot: { answer: string; references: unknown; translation: string }, checked: ReviewedShareFields | null): boolean {
	return !!checked && snapshot.answer === checked.answer && snapshot.translation === checked.translation
		&& JSON.stringify(snapshot.references) === JSON.stringify(checked.references);
}

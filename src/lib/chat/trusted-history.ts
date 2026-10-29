import type { UIMessage } from "ai";

export interface StoredAssistantTurn {
	id: string;
	content: string;
	metadata: unknown;
}

// Old tool results can be stale even when the server wrote them: the source
// contract or the reader's quotation translation may have changed since then.
// Keep them in the displayed conversation, but require fresh Scripture evidence
// for the next answer. In particular, never replay client-supplied verse text as
// a provider tool result.
const SCRIPTURE_TOOLS = new Set([
	"getPassage", "findVerses", "searchScripture", "getCrossReferences",
	"getOriginalText", "searchOriginalLanguage", "lookupStrongs",
]);

export const HISTORY_EVIDENCE_GUIDANCE =
	"Earlier assistant replies are conversation history, not verified Scripture evidence for this answer. Retrieve Scripture again before quoting it or using its wording to support a claim. Do not copy a prior quotation without checking the current Scripture tools.";

export function assistantHistoryIds(messages: readonly UIMessage[]): string[] {
	return [...new Set(messages.filter(message => message?.role === "assistant")
		.map(message => message.id).filter(id => typeof id === "string" && id.length > 0))];
}

function replayablePart(part: UIMessage["parts"][number]): boolean {
	if (!part || typeof part !== "object" || typeof part.type !== "string") return false;
	const name = part.type === "dynamic-tool"
		? part.toolName
		: part.type.startsWith("tool-") ? part.type.slice(5) : null;
	return name === null || !SCRIPTURE_TOOLS.has(name);
}

/**
 * `stored` must come from a query scoped to BOTH the conversation and caller.
 * Only requested assistant ids are restored; a stale client cannot add another
 * conversation's messages or rewrite the text/results of an existing answer.
 * Missing turns (including a response still being saved) are omitted rather
 * than upgrading the client's copy to trusted assistant/tool evidence.
 */
export function trustedAssistantHistory(
	messages: readonly UIMessage[],
	stored: readonly StoredAssistantTurn[],
): UIMessage[] {
	const byId = new Map(stored.map(row => [row.id, row]));
	return messages.flatMap(message => {
		if (message?.role === "user") return [message];
		if (message?.role !== "assistant") return [];
		const row = byId.get(message.id);
		if (!row) return [];
		const metadata = row.metadata && typeof row.metadata === "object"
			? row.metadata as Record<string, unknown> : null;
		const parts = Array.isArray(metadata?.parts)
			? (metadata.parts as UIMessage["parts"]).filter(replayablePart)
			: row.content ? [{ type: "text" as const, text: row.content }] : [];
		return parts.length ? [{ id: row.id, role: "assistant" as const, parts }] : [];
	});
}

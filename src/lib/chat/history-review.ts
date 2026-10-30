export interface SavedAnswerReview {
	surface: "chat" | "note";
	parentId: string;
	messageId: string;
	state: "pending" | "withheld";
	code: string;
	sourceDigest: string;
}

/** The locator comes from the owned server history route, never answer prose. */
export function savedAnswerReview(value: unknown, messageId: string): SavedAnswerReview | undefined {
	if (value === undefined) return;
	const invalid = (): SavedAnswerReview => ({ surface: "chat", parentId: "", messageId, state: "withheld", code: "invalid_history_review", sourceDigest: "" });
	if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
	const item = value as Record<string, unknown>;
	const identifier = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(id);
	if ((item.surface !== "chat" && item.surface !== "note") || !identifier(item.parentId)
		|| item.messageId !== messageId || !identifier(item.messageId)
		|| (item.state !== "pending" && item.state !== "withheld")
		|| typeof item.code !== "string" || !/^[a-z_]{1,80}$/.test(item.code)
		|| typeof item.sourceDigest !== "string" || !/^[a-f0-9]{64}$/.test(item.sourceDigest)) return invalid();
	return { surface: item.surface, parentId: item.parentId, messageId, state: item.state, code: item.code, sourceDigest: item.sourceDigest };
}

export function savedAnswerQuery(review: Pick<SavedAnswerReview, "surface" | "parentId" | "messageId">): string {
	return new URLSearchParams({ surface: review.surface, parentId: review.parentId, messageId: review.messageId }).toString();
}

/** Accept only the matching checked envelope; contradictory markers stay hidden. */
export function checkedSavedAnswer(value: unknown, review: SavedAnswerReview): Record<string, unknown> | null {
	const record = (item: unknown): Record<string, unknown> | null => item !== null && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : null;
	const body = record(value), row = record(body?.row), metadata = record(row?.metadata);
	if ((body?.state !== "verified" && body?.state !== "notice") || body.sourceDigest !== review.sourceDigest
		|| !/^[a-f0-9]{64}$/.test(review.sourceDigest) || row?.id !== review.messageId || row?.role !== "assistant"
		|| typeof row.content !== "string" || !metadata || !Array.isArray(metadata.parts)
		|| !metadata.parts.every(part => { const item = record(part); return item && typeof item.type === "string"; })
		|| Object.prototype.hasOwnProperty.call(metadata, "historyVerification")) return null;
	return { id: row.id, role: "assistant", content: row.content, metadata,
		...(typeof row.createdAt === "string" ? { createdAt: row.createdAt } : {}) };
}

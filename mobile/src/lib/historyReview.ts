export interface HistoryLocator { surface: "chat" | "note"; parentId: string; messageId: string }
export interface HistoryVerification extends HistoryLocator { state: "pending" | "withheld"; code: string; sourceDigest: string }
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 128 && value.trim() === value;
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export function parseHistoryVerification(value: unknown, messageId: string): HistoryVerification | null {
	if (!record(value) || (value.surface !== "chat" && value.surface !== "note") || !id(value.parentId) || value.messageId !== messageId || !id(messageId)
		|| (value.state !== "pending" && value.state !== "withheld") || !id(value.code) || !digest(value.sourceDigest)) return null;
	return value as unknown as HistoryVerification;
}
/** Malformed review metadata must hide the row as well; it never widens access. */
export function invalidHistoryVerification(messageId: string): HistoryVerification {
	return { surface: "chat", parentId: "", messageId, state: "withheld", code: "invalid_history_review", sourceDigest: "" };
}
export function matchesHistoryLocator(review: HistoryVerification, expected: HistoryLocator): boolean {
	return !!parseHistoryVerification(review, expected.messageId) && review.surface === expected.surface && review.parentId === expected.parentId;
}
export function historyPath(kind: "state" | "original", locator: HistoryLocator): string {
	if (!id(locator.parentId) || !id(locator.messageId) || !["chat", "note"].includes(locator.surface)) throw new Error("This saved answer has no valid review location. Reload the conversation.");
	return `/api/ai/history/${kind}?${new URLSearchParams({ surface: locator.surface, parentId: locator.parentId, messageId: locator.messageId })}`;
}
export interface SafeHistoryRow { id: string; role: "assistant"; content: string; metadata: Record<string, unknown>; createdAt?: string }
export function checkedHistoryState(value: unknown, review: HistoryVerification): { state: "verified" | "notice"; row: SafeHistoryRow } {
	if (!digest(review.sourceDigest) || !record(value) || (value.state !== "verified" && value.state !== "notice") || value.sourceDigest !== review.sourceDigest || !record(value.row)
		|| value.row.id !== review.messageId || value.row.role !== "assistant" || typeof value.row.content !== "string" || !record(value.row.metadata) || !Array.isArray(value.row.metadata.parts)
		|| !value.row.metadata.parts.every(part => record(part) && typeof part.type === "string")
		|| Object.prototype.hasOwnProperty.call(value.row.metadata, "historyVerification")) {
		throw new Error("This saved answer has not passed its current check. Reload the conversation before trying again.");
	}
	return { state: value.state, row: { id: value.row.id, role: "assistant", content: value.row.content, metadata: value.row.metadata,
		...(typeof value.row.createdAt === "string" ? { createdAt: value.row.createdAt } : {}) } };
}

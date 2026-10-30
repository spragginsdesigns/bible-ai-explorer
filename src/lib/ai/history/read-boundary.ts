import type { HistoryLocator, HistoryService } from "./contracts";

type SourceRow = { id: string; role: string; content: string; metadata?: unknown; createdAt?: Date | string; feedback?: string | null; [key: string]: unknown };
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const UNAVAILABLE = "This saved answer cannot be shown until its source and claims can be checked. Your original is preserved.";

/** Only user-authored rows retain their raw fields at an ordinary read boundary. */
export async function reviewedHistoryRow(service: Pick<HistoryService, "get">, owner: string, locator: HistoryLocator, source: SourceRow): Promise<SourceRow> {
	if (source.role !== "assistant") return source;
	const feedback = source.feedback === "up" || source.feedback === "down" || source.feedback === null ? { feedback: source.feedback } : {};
	const hidden = (): SourceRow => ({ ...feedback, id: source.id, role: "assistant", content: UNAVAILABLE,
		metadata: { parts: [{ type: "text", text: UNAVAILABLE }] }, ...(source.createdAt ? { createdAt: source.createdAt } : {}), attachments: [] });
	if (locator.messageId !== source.id) return hidden();
	try {
		const result = await service.get(owner, locator);
		const body = record(result.body), row = record(body?.row), metadata = record(row?.metadata);
		if (result.status !== 200 || !body || !row || row.id !== source.id || row.role !== "assistant"
			|| typeof row.content !== "string" || !metadata || !Array.isArray(metadata.parts)
			|| !metadata.parts.every(part => { const item = record(part); return item && typeof item.type === "string"; })
			|| typeof body.state !== "string" || !["verified", "notice", "pending", "withheld"].includes(body.state)
			|| typeof body.sourceDigest !== "string" || !/^[a-f0-9]{64}$/.test(body.sourceDigest)) return hidden();
		if (body.state === "pending" || body.state === "withheld") {
			const status = record(metadata.historyVerification);
			if (!status || typeof body.sourceDigest !== "string" || !/^[a-f0-9]{64}$/.test(body.sourceDigest)
				|| typeof status.code !== "string" || !/^[a-z_]{1,80}$/.test(status.code)) return hidden();
			return { ...feedback, id: source.id, role: "assistant", content: UNAVAILABLE, attachments: [],
				...(source.createdAt ? { createdAt: source.createdAt } : {}),
				metadata: { parts: [{ type: "text", text: UNAVAILABLE }], historyVerification: { state: body.state, code: status.code, sourceDigest: body.sourceDigest, ...locator } } };
		}
		if (Object.prototype.hasOwnProperty.call(metadata, "historyVerification")) return hidden();
		// The projector owns the entire returned display envelope. Never spread
		// legacy metadata/attachments back over its checked fields.
		const safeMetadata: Record<string, unknown> = {};
		for (const key of ["parts", "followUps", "retrievedVerses", "tavilyResults", "averageSimilarity", "translation"]) {
			if (Object.prototype.hasOwnProperty.call(metadata, key)) safeMetadata[key] = metadata[key];
		}
		return { ...feedback, id: source.id, role: "assistant", content: row.content, metadata: safeMetadata, attachments: [],
			...(source.createdAt ? { createdAt: source.createdAt } : {}) };
	} catch { return hidden(); }
}

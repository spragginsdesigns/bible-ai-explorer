const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** Bind the exact fields rendered and used by spoken choice controls. */
export function voiceAnswerEnvelope(value: unknown): string | null {
	if (!record(value) || value.role !== "assistant" || typeof value.content !== "string" || value.isStreaming === true || Object.prototype.hasOwnProperty.call(value, "historyVerification")) return null;
	const card = value.choiceCard;
	if (card === undefined) return JSON.stringify([value.content, null]);
	if (!record(card) || typeof card.step !== "string" || typeof card.question !== "string" || !Array.isArray(card.options) || !card.options.every(option => typeof option === "string")
		|| typeof card.allowOther !== "boolean" || typeof card.skipLabel !== "string" || !Array.isArray(card.terms) || !card.terms.every(term => typeof term === "string")) return null;
	return JSON.stringify([value.content, [card.step, card.question, card.options, card.allowOther, card.skipLabel, card.terms]]);
}

/** Only an exact safe saved projection may authorize narration or capture rearm. */
export function savedVoiceAnswer(body: unknown, messageId: string, expectedEnvelope: string, project: (row: unknown) => unknown): string | null {
	if (!record(body) || !Array.isArray(body.messages)) return null;
	const rows = body.messages.filter(item => record(item) && item.id === messageId);
	if (rows.length !== 1) return null;
	const row = rows[0];
	if (!record(row) || row.role !== "assistant" || typeof row.content !== "string" || !record(row.metadata) || Object.prototype.hasOwnProperty.call(row.metadata, "historyVerification")
		|| !Array.isArray(row.metadata.parts) || !row.metadata.parts.every(part => record(part) && typeof part.type === "string" && part.type.length > 0 && (part.type !== "text" || typeof part.text === "string"))) return null;
	try {
		const view = project(row);
		return voiceAnswerEnvelope(view) === expectedEnvelope && record(view) && typeof view.content === "string" ? view.content : null;
	} catch { return null; }
}

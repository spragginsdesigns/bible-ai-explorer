interface StudyQuestionMessage {
	content: string;
	metadata: unknown;
}

function dailyCrossReference(metadata: unknown): string | null {
	if (typeof metadata !== "object" || metadata === null) return null;
	const origin = (metadata as Record<string, unknown>).origin;
	if (typeof origin !== "object" || origin === null) return null;
	const record = origin as Record<string, unknown>;
	return record.surface === "daily-cross" &&
		record.action === "go-deeper" &&
		typeof record.reference === "string" &&
		record.reference.trim()
		? record.reference.trim()
		: null;
}

/** Preserve follow-up study while preventing it from masquerading as fresh intent. */
export function formatStudyQuestions(
	messages: readonly StudyQuestionMessage[],
	snippetLength = 200,
): string {
	return (
		messages
			.map((message) => {
				const reference = dailyCrossReference(message.metadata);
				const label = reference
					? `[Daily Cross study continuation on ${reference}; not an independent fresh interest] `
					: "";
				return `- ${label}${message.content.slice(0, snippetLength)}`;
			})
			.join("\n") || "(none)"
	);
}

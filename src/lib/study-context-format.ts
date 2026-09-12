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

/** The title every client gives a note nobody named. */
export const PLACEHOLDER_NOTE_TITLE = "Untitled Note";

/**
 * Whether a note is evidence of study. A blank note, or one still carrying the
 * placeholder title, is an abandoned tap on "new note": fed into a prompt it
 * gets read back to the user as a study called "Untitled Note".
 */
export function isMeaningfulNote(note: { title: string; plainText: string }): boolean {
	const title = note.title.trim();
	return (
		note.plainText.trim().length > 0 &&
		title.length > 0 &&
		title.toLowerCase() !== PLACEHOLDER_NOTE_TITLE.toLowerCase()
	);
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

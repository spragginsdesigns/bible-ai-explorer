/**
 * What each tool is called while it runs, keyed by tool name. Mobile keeps its
 * own copy for tool parts it renders itself, so the wording a user sees must
 * not drift apart between here and `mobile/src/lib/chatView.ts`.
 */
export const TOOL_ACTIVITY_LABELS: Record<string, string> = {
	searchScripture: "Searching the Scriptures",
	getPassage: "Opening the passage",
	webSearch: "Searching the web",
	addToNote: "Writing to your note",
	readNote: "Reading your note",
	updateNote: "Rewriting your note",
	findNotes: "Looking through your notes",
	getHighlights: "Reading your highlights",
	getCrossReferences: "Tracing cross-references",
	getOriginalText: "Opening the original text",
	lookupStrongs: "Studying the original word",
	getDailyCross: "Opening today's cross",
	setDailyCross: "Preparing your new day",
};

export function toolActivityLabel(toolName: string): string {
	return TOOL_ACTIVITY_LABELS[toolName] ?? "Working";
}

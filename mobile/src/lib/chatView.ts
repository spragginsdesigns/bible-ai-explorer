import type { UIMessage } from "ai";

/** View-model types ported from the web app (src/components/useChat.ts). */
export interface RetrievedVerse {
	reference: string;
	similarity: number;
	text?: string;
}

export interface TavilyResult {
	title: string;
	content: string;
	url: string;
}

export interface NoteAction {
	noteId: string;
	noteTitle: string;
	created: boolean;
}

export interface ChatViewMessage {
	id: string;
	role: "user" | "assistant";
	content: string;
	tavilyResults?: TavilyResult[];
	retrievedVerses?: RetrievedVerse[];
	averageSimilarity?: number;
	followUps?: string[];
	noteActions?: NoteAction[];
	activity?: string;
	isStreaming?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

const TOOL_ACTIVITY_LABELS: Record<string, string> = {
	"tool-searchScripture": "Searching the Scriptures",
	"tool-getPassage": "Opening the passage",
	"tool-webSearch": "Searching the web",
	"tool-addToNote": "Writing to your note",
	"tool-findNotes": "Looking through your notes",
};

export function visibleResponseContent(content: string): string {
	return content.replace(/\r?\n?\[FOLLOWUP\][\s\S]*$/, "").trimEnd();
}

export function parseFollowUps(content: string): string[] {
	const followUps: string[] = [];
	const seen = new Set<string>();
	const followUpRegex = /\[FOLLOWUP\]\s*([^\r\n]+)/g;
	let match: RegExpExecArray | null;
	while ((match = followUpRegex.exec(content)) !== null && followUps.length < 2) {
		const question = match[1].trim();
		const normalized = question.toLowerCase();
		if (question && !seen.has(normalized)) {
			seen.add(normalized);
			followUps.push(question);
		}
	}
	return followUps;
}

function parseVerses(value: unknown): RetrievedVerse[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((verse): RetrievedVerse[] => {
		if (
			!isRecord(verse) ||
			typeof verse.reference !== "string" ||
			typeof verse.similarity !== "number"
		) {
			return [];
		}
		return [{
			reference: verse.reference,
			similarity: verse.similarity,
			...(typeof verse.text === "string" ? { text: verse.text } : {}),
		}];
	});
}

function parseTavilyResults(value: unknown): TavilyResult[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((result): TavilyResult[] => {
		if (
			!isRecord(result) ||
			typeof result.title !== "string" ||
			typeof result.content !== "string" ||
			typeof result.url !== "string"
		) {
			return [];
		}
		return [{ title: result.title, content: result.content, url: result.url }];
	});
}

/** Convert a live or restored UIMessage into the render model. */
export function toViewMessage(
	message: UIMessage,
	options: { isStreaming: boolean }
): ChatViewMessage {
	const legacy = isRecord(message.metadata) ? message.metadata : {};

	let text = "";
	const retrievedVerses: RetrievedVerse[] = parseVerses(legacy.retrievedVerses);
	const similarities: number[] = [];
	const tavilyResults: TavilyResult[] = parseTavilyResults(legacy.tavilyResults);
	const noteActions: NoteAction[] = [];
	let activity: string | undefined;

	for (const part of message.parts) {
		if (part.type === "text") {
			text += part.text;
			continue;
		}
		if (!part.type.startsWith("tool-")) continue;
		const toolPart = part as unknown as { type: string; state: string; output?: unknown };

		if (toolPart.state === "input-streaming" || toolPart.state === "input-available") {
			activity = TOOL_ACTIVITY_LABELS[toolPart.type] ?? "Working";
			continue;
		}
		if (toolPart.state !== "output-available" || !isRecord(toolPart.output)) continue;

		const output = toolPart.output;
		if (toolPart.type === "tool-searchScripture") {
			const verses = parseVerses(output.verses);
			retrievedVerses.push(...verses);
			similarities.push(...verses.map((verse) => verse.similarity));
		} else if (toolPart.type === "tool-getPassage") {
			retrievedVerses.push(...parseVerses(output.verses));
		} else if (toolPart.type === "tool-webSearch") {
			tavilyResults.push(...parseTavilyResults(output.results));
		} else if (toolPart.type === "tool-addToNote") {
			if (typeof output.noteId === "string" && typeof output.noteTitle === "string") {
				noteActions.push({
					noteId: output.noteId,
					noteTitle: output.noteTitle,
					created: output.created === true,
				});
			}
		}
	}

	const followUps = options.isStreaming
		? parseFollowUps(text)
		: [
				...new Set([
					...parseFollowUps(text),
					...(Array.isArray(legacy.followUps)
						? legacy.followUps.filter((f): f is string => typeof f === "string")
						: []),
				]),
			].slice(0, 2);

	const averageSimilarity =
		typeof legacy.averageSimilarity === "number"
			? legacy.averageSimilarity
			: similarities.length > 0
				? similarities.reduce((sum, s) => sum + s, 0) / similarities.length
				: undefined;

	return {
		id: message.id,
		role: message.role === "user" ? "user" : "assistant",
		content: visibleResponseContent(text),
		...(retrievedVerses.length > 0 ? { retrievedVerses } : {}),
		...(averageSimilarity !== undefined ? { averageSimilarity } : {}),
		...(tavilyResults.length > 0 ? { tavilyResults } : {}),
		...(followUps.length > 0 ? { followUps } : {}),
		...(noteActions.length > 0 ? { noteActions } : {}),
		...(activity && options.isStreaming ? { activity } : {}),
		...(options.isStreaming ? { isStreaming: true } : {}),
	};
}

/** Map a stored DB message row to a UIMessage (same logic as the web client). */
export function dbMessageToUIMessage(value: unknown): UIMessage {
	if (
		!isRecord(value) ||
		typeof value.id !== "string" ||
		(value.role !== "user" && value.role !== "assistant") ||
		typeof value.content !== "string"
	) {
		throw new Error("History response contained an invalid message.");
	}

	const metadata = isRecord(value.metadata) ? value.metadata : {};
	const parts = Array.isArray(metadata.parts)
		? (metadata.parts as UIMessage["parts"])
		: [{ type: "text" as const, text: value.content }];

	const { parts: _ignored, ...legacyMetadata } = metadata;

	return {
		id: value.id,
		role: value.role,
		parts,
		...(Object.keys(legacyMetadata).length > 0 ? { metadata: legacyMetadata } : {}),
	};
}

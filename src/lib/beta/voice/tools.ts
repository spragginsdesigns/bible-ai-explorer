import "server-only";

import { asSchema, type Tool } from "ai";
import { buildSureWordTools } from "@/lib/ai-tools";
import { bookByOrder, resolveReference } from "@/lib/bible/books";
import { getChapter } from "@/lib/bible/translations";
import { READ_MAX_VERSES, READ_SCRIPTURE_TOOL, isVoiceScriptureTool } from "@/lib/beta/voice/voice-rules";

/**
 * Voice Study's tools (docs/beta/voice.md). The four Scripture tools are the
 * chat assistant's own (`buildSureWordTools`): the same descriptions, the same
 * retrieval, the same exact KJV text, so a spoken answer is grounded the way a
 * chat answer is. They run here, on the server, when the browser relays a call
 * from the realtime model. `readScripture` is answered by the browser, which
 * plays the narrated KJV; this file only resolves what to play.
 */

function scriptureTools(userId: string) {
	const tools = buildSureWordTools({ userId, translation: "KJV", webSearchEnabled: false });
	return {
		searchScripture: tools.searchScripture,
		findVerses: tools.findVerses,
		getPassage: tools.getPassage,
		getCrossReferences: tools.getCrossReferences,
	};
}

const READ_SCRIPTURE_DEFINITION = {
	type: "function",
	name: READ_SCRIPTURE_TOOL,
	description:
		"Play a passage aloud from SureWord's narrated King James Bible, so the listener hears Scripture word for word. Use it whenever they ask to hear a passage, and when hearing a verse would help your answer. One chapter or part of one chapter per call. Do not speak while it plays; you are told when it finished or when the listener stopped it.",
	parameters: {
		type: "object",
		properties: {
			reference: {
				type: "string",
				description: 'A whole chapter or a range inside one chapter, written like "Romans 5", "Psalm 23", "John 3:16" or "Romans 5:1-11".',
			},
		},
		required: ["reference"],
		additionalProperties: false,
	},
} as const;

async function functionDefinition<INPUT, OUTPUT>(name: string, tool: Tool<INPUT, OUTPUT>): Promise<Record<string, unknown>> {
	return { type: "function", name, description: tool.description, parameters: await asSchema(tool.inputSchema).jsonSchema };
}

/** The realtime session's `tools`: the chat Scripture tools plus readScripture. */
export async function voiceToolDefinitions(): Promise<Record<string, unknown>[]> {
	// The definitions do not depend on who is asking; any id builds them.
	const tools = scriptureTools("definitions");
	const definitions = await Promise.all([
		functionDefinition("searchScripture", tools.searchScripture),
		functionDefinition("findVerses", tools.findVerses),
		functionDefinition("getPassage", tools.getPassage),
		functionDefinition("getCrossReferences", tools.getCrossReferences),
	]);
	return [...definitions, READ_SCRIPTURE_DEFINITION];
}

export class VoiceToolInputError extends Error {}

/**
 * Runs one of the chat Scripture tools for the realtime model and returns the
 * text it should read: the tool's own `formatted` result, or an error the
 * model can recover from. Arguments are validated against the tool's schema.
 */
export async function runVoiceScriptureTool(userId: string, name: string, args: unknown, signal: AbortSignal): Promise<string> {
	if (!isVoiceScriptureTool(name)) throw new VoiceToolInputError(`unknown tool "${name}"`);
	const tools = scriptureTools(userId);
	const call = { toolCallId: `voice-${name}`, args, signal };
	switch (name) {
		case "searchScripture":
			return runTool(tools.searchScripture, call);
		case "findVerses":
			return runTool(tools.findVerses, call);
		case "getPassage":
			return runTool(tools.getPassage, call);
		case "getCrossReferences":
			return runTool(tools.getCrossReferences, call);
	}
}

async function runTool<INPUT, OUTPUT extends { formatted: string }>(
	tool: Tool<INPUT, OUTPUT>,
	call: { toolCallId: string; args: unknown; signal: AbortSignal },
): Promise<string> {
	const schema = asSchema(tool.inputSchema);
	const checked = schema.validate ? await schema.validate(call.args) : null;
	if (!checked?.success || !tool.execute) {
		return JSON.stringify({ error: "Those arguments do not fit this tool. Check the book name, chapter and verse." });
	}
	try {
		const result = await tool.execute(checked.value, {
			toolCallId: call.toolCallId,
			messages: [],
			abortSignal: call.signal,
			context: {},
		});
		if (!result || typeof result !== "object" || !("formatted" in result)) return JSON.stringify({ error: "The lookup returned nothing." });
		return result.formatted;
	} catch (error) {
		return JSON.stringify({ error: error instanceof Error ? error.message : "The lookup failed." });
	}
}

export interface VoiceReadingPlan {
	status: "ready";
	/** "Romans 5" for a whole chapter, "Romans 5:1-11" for a range. */
	reference: string;
	book: number;
	bookName: string;
	chapter: number;
	first: number;
	last: number;
	wholeChapter: boolean;
	/** Exact KJV from the bundled text, for the reading card on screen. */
	verses: { verse: number; text: string }[];
}

export type VoiceReadingResult = VoiceReadingPlan | { status: "not_found"; reference: string };

const RANGE_END = /:\s*\d+\s*[-–—]\s*(\d+)(?:\s*:\s*\d+)?\s*$/;
const CROSS_CHAPTER = /:\s*\d+\s*[-–—]\s*\d+\s*:\s*\d+\s*$/;

/**
 * Resolves what readScripture should play: one chapter, or a range inside one
 * chapter (a range that runs into the next chapter stops at this one's end).
 * The verses come from the bundled KJV; the browser fetches the recording and
 * its verse timings from the Audio Bible (`GET /api/bible/audio`).
 */
export async function planVoiceReading(rawReference: unknown): Promise<VoiceReadingResult> {
	const reference = typeof rawReference === "string" ? rawReference.trim().slice(0, 80) : "";
	const ref = reference ? resolveReference(reference) : null;
	const book = ref ? bookByOrder(ref.order) : null;
	if (!ref || !book) return { status: "not_found", reference };
	const chapterText = await getChapter("KJV", ref.order, ref.chapter);
	if (chapterText.length === 0) return { status: "not_found", reference };
	const wholeChapter = ref.verse === undefined;
	const first = ref.verse ?? 1;
	if (first > chapterText.length) return { status: "not_found", reference };
	const rangeEnd = RANGE_END.exec(reference);
	const askedLast = wholeChapter
		? chapterText.length
		: CROSS_CHAPTER.test(reference)
			? chapterText.length
			: rangeEnd
				? Number(rangeEnd[1])
				: first;
	const last = Math.min(Math.max(askedLast, first), chapterText.length, first + READ_MAX_VERSES - 1);
	const verses = chapterText.slice(first - 1, last).map((text, index) => ({ verse: first + index, text }));
	const label = wholeChapter
		? `${book.name} ${ref.chapter}`
		: `${book.name} ${ref.chapter}:${first}${last > first ? `-${last}` : ""}`;
	return { status: "ready", reference: label, book: ref.order, bookName: book.name, chapter: ref.chapter, first, last, wholeChapter, verses };
}

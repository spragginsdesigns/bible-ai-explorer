import { tool, type InferUITools, type UIDataTypes, type UIMessage } from "ai";
import { z } from "zod";
import {
	formatVersesForModel,
	searchScripture,
	type RetrievedVerse,
} from "@/lib/scripture-search";
import { tavilySearch, type TavilyResult } from "@/lib/tavily";
import {
	appendMarkdownToNote,
	findUserNotes,
	type AppendToNoteResult,
	type NoteSummary,
} from "@/lib/notes-io";
import { getKjvBookNumber, getKjvBookName, getKjvVerseText } from "@/utils/kjvBible";

export interface ScriptureSearchToolOutput {
	verses: RetrievedVerse[];
	averageSimilarity: number;
	formatted: string;
}

export interface PassageToolOutput {
	reference: string;
	verses: RetrievedVerse[];
	formatted: string;
}

export interface WebSearchToolOutput {
	results: TavilyResult[];
}

export interface FindNotesToolOutput {
	notes: NoteSummary[];
}

export type AddToNoteToolOutput = AppendToNoteResult;

const MAX_PASSAGE_VERSES = 30;

export interface VerseMindToolContext {
	userId: string;
	/** When set (note chat), addToNote defaults to this note. */
	defaultNoteId?: string;
}

export function buildVerseMindTools(context: VerseMindToolContext) {
	const searchScriptureTool = tool({
		description:
			"Semantic search over the entire King James Bible. Returns the most relevant verses with their exact KJV text. Call this before quoting or citing Scripture whenever you do not already have the exact wording in this conversation, and call it again with a different phrasing if the first results do not answer the question.",
		inputSchema: z.object({
			query: z
				.string()
				.describe(
					"A self-contained search phrase describing the topic, doctrine, or wording to find. Resolve pronouns from the conversation before searching."
				),
			limit: z.number().int().min(1).max(10).optional().describe("How many verses to return (default 5)."),
		}),
		execute: async ({ query, limit }): Promise<ScriptureSearchToolOutput> => {
			const result = await searchScripture(query, limit ?? 5);
			return { ...result, formatted: formatVersesForModel(result.verses) };
		},
	});

	const getPassageTool = tool({
		description:
			"Look up the exact KJV text of a specific passage by reference, e.g. John 3:16 or Romans 8:28-39. Use this when you or the user name a specific reference, so every quotation is word-for-word.",
		inputSchema: z.object({
			book: z.string().describe('KJV book name, e.g. "Genesis", "Psalms", "1 John".'),
			chapter: z.number().int().min(1),
			verseStart: z.number().int().min(1),
			verseEnd: z
				.number()
				.int()
				.min(1)
				.optional()
				.describe("Last verse of the range, inclusive. Omit for a single verse."),
		}),
		execute: async ({ book, chapter, verseStart, verseEnd }): Promise<PassageToolOutput> => {
			const bookNumber = getKjvBookNumber(book);
			if (!bookNumber) {
				throw new Error(`Unknown book name: "${book}". Use standard KJV book names.`);
			}
			const bookName = getKjvBookName(bookNumber) ?? book;
			const end = Math.min(verseEnd ?? verseStart, verseStart + MAX_PASSAGE_VERSES - 1);

			const verses: RetrievedVerse[] = [];
			for (let verse = verseStart; verse <= end; verse++) {
				const text = await getKjvVerseText(bookNumber, chapter, verse);
				if (!text) break;
				verses.push({ reference: `${bookName} ${chapter}:${verse}`, similarity: 1, text });
			}

			if (verses.length === 0) {
				throw new Error(
					`${bookName} ${chapter}:${verseStart} was not found. Check the chapter and verse numbers.`
				);
			}

			const reference =
				verses.length > 1
					? `${bookName} ${chapter}:${verseStart}-${verseStart + verses.length - 1}`
					: verses[0].reference;

			return { reference, verses, formatted: formatVersesForModel(verses) };
		},
	});

	const webSearchTool = tool({
		description:
			"Search the web for supplementary material: church history, archaeology, apologetics, current events, or original-language word studies. Never use it as an authority above or alongside Scripture; weigh everything it returns against the KJV.",
		inputSchema: z.object({
			query: z.string().describe("A self-contained web search query."),
		}),
		execute: async ({ query }): Promise<WebSearchToolOutput> => {
			const results = await tavilySearch(query);
			return { results };
		},
	});

	const addToNoteTool = tool({
		description: context.defaultNoteId
			? "Add content to the user's Bible study notes. Only call this when the user asks you to add, save, or write something to their note. ALWAYS omit noteId in this conversation - \"this note\" or \"my note\" means the note that is currently open, even if earlier tool results in this conversation mention another note id. Pass a noteId only when the user explicitly names a DIFFERENT note. Write the content as clean markdown (headings, lists, blockquotes for verses)."
			: "Add content to one of the user's Bible study notes, or create a new note. Only call this when the user asks you to add or save something to their notes. Use findNotes first when the user names an existing note; pass title (and no noteId) to create a new note. Write the content as clean markdown (headings, lists, blockquotes for verses).",
		inputSchema: z.object({
			markdown: z.string().describe("The content to append, as markdown."),
			noteId: z
				.string()
				.optional()
				.describe(
					"Target note id from findNotes. OMIT THIS FIELD ENTIRELY (do not pass an empty string) to write to the currently open note, or to create a new note when none is open."
				),
			title: z
				.string()
				.optional()
				.describe("Title for a new note when no noteId is given and no note is open."),
		}),
		execute: async ({ markdown, noteId, title }): Promise<AddToNoteToolOutput> => {
			// Models sometimes send noteId as an empty string; treat any blank
			// value as "not specified" so the open note (defaultNoteId) wins.
			const targetNoteId = noteId?.trim() || context.defaultNoteId;
			return appendMarkdownToNote({
				userId: context.userId,
				markdown,
				noteId: targetNoteId,
				title,
			});
		},
	});

	const findNotesTool = tool({
		description:
			"Search the user's Bible study notes by title or content. Use this to locate the right note before adding to it, or when the user refers to one of their notes.",
		inputSchema: z.object({
			query: z.string().describe("Words from the note title or content. Empty string lists recent notes."),
		}),
		execute: async ({ query }): Promise<FindNotesToolOutput> => {
			const notes = await findUserNotes(context.userId, query);
			return { notes };
		},
	});

	return {
		searchScripture: searchScriptureTool,
		getPassage: getPassageTool,
		webSearch: webSearchTool,
		addToNote: addToNoteTool,
		findNotes: findNotesTool,
	};
}

export type VerseMindTools = ReturnType<typeof buildVerseMindTools>;

/** UIMessage typed with the VerseMind tool set, shared by server and client. */
export type VerseMindUIMessage = UIMessage<
	unknown,
	UIDataTypes,
	InferUITools<VerseMindTools>
>;

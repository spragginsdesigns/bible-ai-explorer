import { tool, type InferUITools, type UIDataTypes, type UIMessage } from "ai";
import type { SureWordMessageMetadata } from "@/lib/chat-attachment-types";
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
import { getVerseText, type TranslationId } from "@/lib/bible/translations";
import {
	findTodayCross,
	generateDailyCross,
	replaceDailyCross,
	storeDailyCross,
	type StudyStep,
} from "@/lib/daily-cross";
import { getKjvBookNumber, getKjvBookName } from "@/utils/kjvBible";

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

/** Today's "Pick Up Your Cross", flattened for the model and the receipt card. */
export interface DailyCrossToolOutput {
	reference: string;
	book: string;
	chapter: number;
	verse: number;
	text: string;
	reason: string;
	whyToday: string | null;
	application: string | null;
	studyPath: StudyStep[];
	question: string | null;
	/** Set only by setDailyCross: the reference the new day displaced, if any. */
	previousReference?: string | null;
}

const MAX_PASSAGE_VERSES = 30;

export interface SureWordToolContext {
	userId: string;
	/** When set (note chat), addToNote defaults to this note. */
	defaultNoteId?: string;
	/** Bible translation the user selected in settings; Scripture tools quote it. */
	translation?: TranslationId;
}

export function buildSureWordTools(context: SureWordToolContext) {
	const translation: TranslationId = context.translation ?? "KJV";
	const searchScriptureTool = tool({
		description:
			`Semantic search over the entire Bible. Returns the most relevant verses with their exact ${translation} text. Call this before quoting or citing Scripture whenever you do not already have the exact wording in this conversation, and call it again with a different phrasing if the first results do not answer the question.`,
		inputSchema: z.object({
			query: z
				.string()
				.describe(
					"A self-contained search phrase describing the topic, doctrine, or wording to find. Resolve pronouns from the conversation before searching."
				),
			limit: z.number().int().min(1).max(10).optional().describe("How many verses to return (default 5)."),
		}),
		execute: async ({ query, limit }): Promise<ScriptureSearchToolOutput> => {
			const result = await searchScripture(query, limit ?? 5, translation);
			return { ...result, formatted: formatVersesForModel(result.verses, translation) };
		},
	});

	const getPassageTool = tool({
		description:
			`Look up the exact ${translation} text of a specific passage by reference, e.g. John 3:16 or Romans 8:28-39. Use this when you or the user name a specific reference, so every quotation is word-for-word.`,
		inputSchema: z.object({
			book: z.string().describe('Bible book name, e.g. "Genesis", "Psalms", "1 John".'),
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
				const text = await getVerseText(translation, bookNumber, chapter, verse);
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

			return { reference, verses, formatted: formatVersesForModel(verses, translation) };
		},
	});

	const webSearchTool = tool({
		description:
			`Search the web for supplementary material: church history, archaeology, apologetics, current events, or original-language word studies. Never use it as an authority above or alongside Scripture; weigh everything it returns against the ${translation}.`,
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

	const getDailyCrossTool = tool({
		description:
			"Read the user's \"Pick Up Your Cross\" for today — the guided day SureWord builds for them from their own reading, questions, notes and memories: today's verse, why it was chosen, how it applies, a short study path, and a question to carry. Call this whenever they ask what today's cross, verse or word is, or whenever an answer should build on the day they were already given. If no day has been prepared yet, this prepares it.",
		inputSchema: z.object({}),
		execute: async (): Promise<DailyCrossToolOutput> => {
			const existing = await findTodayCross(context.userId);
			if (existing) return toDailyCrossOutput(existing);
			const cross = await generateDailyCross(context.userId);
			await storeDailyCross(context.userId, cross);
			return toDailyCrossOutput(cross);
		},
	});

	const setDailyCrossTool = tool({
		description:
			"Replace today's \"Pick Up Your Cross\" with a newly prepared day, optionally centred on a theme the user named or pinned to a verse they chose. This overwrites the day they are currently carrying on every device. ONLY call it after the user has explicitly agreed, in this conversation, to today's word being replaced — ask them first and wait for a clear yes. Never call it to answer a question about the feature, and never call it twice for one request.",
		inputSchema: z.object({
			focus: z
				.string()
				.optional()
				.describe(
					'What the user asked the new day to centre on, in their own words, e.g. "patience with my kids" or "something out of Psalms". Omit when they just want a different word.'
				),
			book: z
				.string()
				.optional()
				.describe(
					'Only when the user pinned a specific verse: its KJV book name, e.g. "Psalms". Requires chapter and verse too.'
				),
			chapter: z.number().int().min(1).optional().describe("Chapter of the pinned verse."),
			verse: z.number().int().min(1).optional().describe("Verse number of the pinned verse."),
		}),
		execute: async ({ focus, book, chapter, verse }): Promise<DailyCrossToolOutput> => {
			// A half-given reference is a model slip; treat it as "no pin" rather
			// than guessing a chapter or verse on the user's behalf.
			const pinned =
				book && chapter !== undefined && verse !== undefined
					? { book, chapter, verse }
					: undefined;
			const result = await replaceDailyCross(context.userId, { focus, verse: pinned });
			return { ...toDailyCrossOutput(result.cross), previousReference: result.previousReference };
		},
	});

	return {
		searchScripture: searchScriptureTool,
		getPassage: getPassageTool,
		webSearch: webSearchTool,
		addToNote: addToNoteTool,
		findNotes: findNotesTool,
		getDailyCross: getDailyCrossTool,
		setDailyCross: setDailyCrossTool,
	};
}

function toDailyCrossOutput(cross: {
	book: string;
	chapter: number;
	verse: number;
	text: string;
	reason: string;
	whyToday: string | null;
	application: string | null;
	studyPath: StudyStep[];
	question: string | null;
}): DailyCrossToolOutput {
	return {
		reference: `${cross.book} ${cross.chapter}:${cross.verse}`,
		book: cross.book,
		chapter: cross.chapter,
		verse: cross.verse,
		text: cross.text,
		reason: cross.reason,
		whyToday: cross.whyToday,
		application: cross.application,
		studyPath: cross.studyPath,
		question: cross.question,
	};
}

export type SureWordTools = ReturnType<typeof buildSureWordTools>;

/** UIMessage typed with the SureWord tool set, shared by server and client. */
export type SureWordUIMessage = UIMessage<
	SureWordMessageMetadata,
	UIDataTypes,
	InferUITools<SureWordTools>
>;

import { tool, type InferUITools, type UIMessage } from "ai";
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
	readUserNote,
	rewriteNote,
	type AppendToNoteResult,
	type NoteContent,
	type NoteSummary,
	type RewriteNoteResult,
} from "@/lib/notes-io";
import { getVerseText, type TranslationId } from "@/lib/bible/translations";
import {
	formatHighlightsForModel,
	listUserHighlights,
	type HighlightedVerse,
} from "@/lib/highlights.server";
import {
	findTodayCross,
	generateDailyCross,
	replaceDailyCross,
	storeDailyCross,
	type StudyStep,
} from "@/lib/daily-cross";
import {
	MAX_PLAN_DAYS,
	MIN_PLAN_DAYS,
	READING_PLAN_PRESETS,
	describeReadings,
} from "@/lib/reading-plan-presets";
import {
	getActivePlan,
	setDayDone,
	startPlan,
	type PlanWithProgress,
} from "@/lib/reading-plans";
import { getKjvBookNumber, getKjvBookName } from "@/utils/kjvBible";
import { getCrossReferencesFor } from "@/lib/bible/crossRefs";
import {
	ATLAS_ERAS,
	findOccurrences,
	getEntity,
	getTimeline,
	searchAtlas,
	type AtlasEntityView,
	type AtlasEventView,
} from "@/lib/bible/atlas";
import {
	getOriginalVerse,
	lookupStrongsEntry,
	type OriginalVerse,
	type StrongsEntry,
} from "@/lib/bible/originals";

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
	answer: string | null;
	results: TavilyResult[];
}

export interface FindNotesToolOutput {
	notes: NoteSummary[];
}

export type AddToNoteToolOutput = AppendToNoteResult;

export type ReadNoteToolOutput = NoteContent;

export type UpdateNoteToolOutput = RewriteNoteResult;

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

/** One day of a reading plan, flattened for the model. */
export interface ReadingPlanDayOutput {
	day: number;
	/** "Matthew 10-12" */
	reference: string;
	focus: string;
	done: boolean;
}

/** The user's reading plan as the model sees it, plus what they could start. */
export interface ReadingPlanToolOutput {
	hasPlan: boolean;
	title: string | null;
	description: string | null;
	status: string | null;
	dayCount: number;
	/** The day to put in front of them: the oldest one still unread. */
	currentDay: number;
	/** The day the calendar says they are on. */
	todayDay: number;
	completedCount: number;
	percent: number;
	streak: number;
	today: ReadingPlanDayOutput | null;
	next: ReadingPlanDayOutput[];
	presets: { key: string; title: string; description: string; dayCount: number }[];
	formatted: string;
}

/** Days shown after today's - enough to answer "what's coming up?". */
const PLAN_DAYS_AHEAD = 3;

const MAX_PASSAGE_VERSES = 30;
const MAX_CROSS_REFERENCES = 8;

export interface CrossReferencesToolOutput {
	reference: string;
	crossReferences: { reference: string; text?: string }[];
	formatted: string;
}

export interface OriginalTextToolOutput extends OriginalVerse {
	reference: string;
	formatted: string;
}

export interface StrongsToolOutput extends StrongsEntry {
	number: string;
}

/** How many atlas hits a lookup hands back before it is just a list. */
const MAX_ATLAS_MATCHES = 5;
/** Events one timeline call may return; the whole atlas is far larger. */
const MAX_TIMELINE_EVENTS = 25;

/** One person or place the atlas matched, with the KJV's own count of them. */
export interface BibleEntityMatch {
	id: string;
	kind: "person" | "place" | "event";
	name: string;
	description: string;
	era: string | null;
	yearLabel: string | null;
	refs: string[];
	/** Verses in the whole KJV that name them; null for an event. */
	occurrences: number | null;
	alsoCalled: string[];
	related: string[];
	events: string[];
}

export interface BibleEntityToolOutput {
	query: string;
	matches: BibleEntityMatch[];
	formatted: string;
}

export interface BibleTimelineToolOutput {
	scope: string;
	eras: string[];
	events: {
		id: string;
		title: string;
		era: string;
		yearLabel: string;
		summary: string;
		refs: string[];
		people: string[];
		places: string[];
	}[];
	/** Events matching the filter that did not fit in the list above. */
	truncated: number;
	formatted: string;
}

/** The verses the user has marked in the Bible reader, with their colours. */
export interface HighlightsToolOutput {
	/** How many highlights match the requested scope in total. */
	total: number;
	/** Human phrase for what was searched, e.g. "in Psalms 23" or "in their Bible". */
	scope: string;
	highlights: HighlightedVerse[];
	formatted: string;
}

export interface SureWordToolContext {
	userId: string;
	/** When set (note chat), addToNote defaults to this note. */
	defaultNoteId?: string;
	/** Bible translation the user selected in settings; Scripture tools quote it. */
	translation?: TranslationId;
	/** Settings → Web Search toggle. When false, the webSearch tool declines to run. */
	webSearchEnabled?: boolean;
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
			let formatted = formatVersesForModel(result.verses, translation);
			if (result.degraded) {
				formatted = `NOTE: semantic search is temporarily unavailable, so these are exact-keyword matches only. Prefer getPassage for references you already know, and tell the user nothing about this mechanism.\n${formatted}`;
			}
			return { ...result, formatted };
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

	const getCrossReferencesTool = tool({
		description:
			`Curated cross-references for one verse (from the Treasury-style openbible.info set), with their exact ${translation} text: Scripture interpreting Scripture. Use it to find related passages when explaining a verse, tracing a doctrine, or when the user asks what else the Bible says about what a verse teaches.`,
		inputSchema: z.object({
			book: z.string().describe('Bible book name, e.g. "Genesis", "Psalms", "1 John".'),
			chapter: z.number().int().min(1),
			verse: z.number().int().min(1),
		}),
		execute: async ({ book, chapter, verse }): Promise<CrossReferencesToolOutput> => {
			const bookNumber = getKjvBookNumber(book);
			if (!bookNumber) {
				throw new Error(`Unknown book name: "${book}". Use standard KJV book names.`);
			}
			const bookName = getKjvBookName(bookNumber) ?? book;
			const refs = (await getCrossReferencesFor(bookNumber, chapter, verse)).slice(
				0,
				MAX_CROSS_REFERENCES
			);

			const crossReferences = await Promise.all(
				refs.map(async (ref) => {
					const refBookName = getKjvBookName(ref.order) ?? `Book ${ref.order}`;
					const isRange =
						ref.endChapter !== undefined &&
						ref.endVerse !== undefined &&
						(ref.endChapter !== ref.chapter || ref.endVerse !== ref.verse);
					const reference = isRange
						? ref.endChapter === ref.chapter
							? `${refBookName} ${ref.chapter}:${ref.verse}-${ref.endVerse}`
							: `${refBookName} ${ref.chapter}:${ref.verse}-${ref.endChapter}:${ref.endVerse}`
						: `${refBookName} ${ref.chapter}:${ref.verse}`;

					// Quote single verses and short same-chapter ranges; long ranges
					// stay reference-only (the model can getPassage them if needed).
					const lastVerse =
						isRange && ref.endChapter === ref.chapter
							? Math.min(ref.endVerse ?? ref.verse, ref.verse + 3)
							: ref.verse;
					const texts: string[] = [];
					if (!isRange || ref.endChapter === ref.chapter) {
						for (let v = ref.verse; v <= lastVerse; v++) {
							const text = await getVerseText(translation, ref.order, ref.chapter, v);
							if (!text) break;
							texts.push(text);
						}
					}
					const text = texts.length > 0 ? texts.join(" ") : undefined;
					return { reference, ...(text ? { text } : {}) };
				})
			);

			const source = `${bookName} ${chapter}:${verse}`;
			const formatted =
				crossReferences.length === 0
					? `No cross-references on record for ${source}.`
					: crossReferences
							.map((ref) =>
								ref.text
									? `${ref.reference} ${translation}: "${ref.text}"`
									: `${ref.reference} (reference only; use getPassage for its text)`
							)
							.join("\n");
			return { reference: source, crossReferences, formatted };
		},
	});

	const getOriginalTextTool = tool({
		description:
			"The inspired original-language text of one verse, word by word: Hebrew from the Westminster Leningrad Codex (OT) or Greek from Scrivener's 1894 Textus Receptus, the Greek text underlying the KJV (NT). Each word carries its Strong's number, morphology code, lemma, transliteration, and KJV gloss. Use this whenever you discuss what a word means in the original languages, compare translations, or the user asks about the Hebrew or Greek. Ground every original-language claim in this tool rather than memory.",
		inputSchema: z.object({
			book: z.string().describe('Bible book name, e.g. "Genesis", "Psalms", "1 John".'),
			chapter: z.number().int().min(1),
			verse: z.number().int().min(1),
		}),
		execute: async ({ book, chapter, verse }): Promise<OriginalTextToolOutput> => {
			const bookNumber = getKjvBookNumber(book);
			if (!bookNumber) {
				throw new Error(`Unknown book name: "${book}". Use standard KJV book names.`);
			}
			const bookName = getKjvBookName(bookNumber) ?? book;
			const original = await getOriginalVerse(bookNumber, chapter, verse);
			if (!original) {
				throw new Error(
					`${bookName} ${chapter}:${verse} was not found in the original-language text. Note that Hebrew versification can differ slightly from the KJV (e.g. Psalm titles count as verse 1).`
				);
			}
			const reference = `${bookName} ${chapter}:${verse}`;
			const formatted = [
				`${reference} (${original.textName}):`,
				original.words.map((word) => word.text).join(" "),
				...original.words.map((word) => {
					const parts = [word.text];
					if (word.lemma && word.lemma !== word.text) parts.push(`lemma ${word.lemma}`);
					if (word.translit) parts.push(word.translit);
					if (word.strongs) parts.push(word.strongs);
					if (word.morph) parts.push(word.morph);
					if (word.gloss) parts.push(`KJV: ${word.gloss.slice(0, 90)}`);
					return `- ${parts.join(" | ")}`;
				}),
			].join("\n");
			return { reference, ...original, formatted };
		},
	});

	const lookupStrongsTool = tool({
		description:
			"Look up a Strong's dictionary entry by number (e.g. H430 or G26): lemma, transliteration, definition, and how the KJV translates it. Use it for word studies when you already know the Strong's number (usually from getOriginalText).",
		inputSchema: z.object({
			number: z
				.string()
				.describe('Strong\'s number with its language prefix: "H430" (Hebrew) or "G26" (Greek).'),
		}),
		execute: async ({ number }): Promise<StrongsToolOutput> => {
			const entry = await lookupStrongsEntry(number);
			if (!entry) {
				throw new Error(`No Strong's entry found for "${number}". Use H#### for Hebrew or G#### for Greek.`);
			}
			return { number: number.trim().toUpperCase(), ...entry };
		},
	});

	const lookupBibleEntityTool = tool({
		description:
			"Look up a person, place or event of Scripture in SureWord's own Bible atlas: who they were or where it was, in the Bible's own words, with their key references, the names Scripture also calls them by, who and where they are connected to, and how many verses of the whole KJV name them. Prefer this over webSearch for every who / where / what-happened question about the Bible - it is grounded in the KJV text itself, and the web is not.",
		inputSchema: z.object({
			query: z
				.string()
				.min(1)
				.max(80)
				.describe(
					'A name as Scripture or the user gives it, e.g. "Moses", "Saul of Tarsus", "Capernaum", "the fiery furnace".'
				),
		}),
		execute: async ({ query }): Promise<BibleEntityToolOutput> => {
			const hits = await searchAtlas(query, MAX_ATLAS_MATCHES);
			const matches: BibleEntityMatch[] = [];

			for (const hit of hits) {
				const entity: AtlasEntityView | null =
					hit.kind === "event" ? null : await getEntity(hit.id);
				// Counting is a scan of the whole KJV, so only the best match pays for it.
				const occurrences =
					matches.length === 0 && entity
						? (await findOccurrences(entity.name, 0)).total
						: null;
				matches.push({
					id: hit.id,
					kind: hit.kind,
					name: hit.name,
					description: hit.description,
					era: hit.era,
					yearLabel: hit.yearLabel,
					refs: hit.refs,
					occurrences,
					alsoCalled: entity?.alsoCalled ?? [],
					related: entity?.related.map((related) => related.name) ?? [],
					events: entity?.events.map((event) => event.title) ?? [],
				});
			}

			const formatted =
				matches.length === 0
					? `Nothing in the Bible atlas matches "${query}". Say so plainly rather than guessing, and search the Scriptures for the name instead.`
					: matches
							.map((match) => {
								const lines = [
									`${match.name}${match.alsoCalled.length > 0 ? ` (also called ${match.alsoCalled.join(", ")})` : ""} - ${match.kind}${match.era ? `, ${match.era}` : ""}${match.yearLabel ? `, ${match.yearLabel}` : ""}`,
									match.description,
									`Key references: ${match.refs.join("; ")}`,
								];
								if (match.occurrences !== null) {
									lines.push(`Named in ${match.occurrences} verses of the KJV.`);
								}
								if (match.related.length > 0) {
									lines.push(`Connected to: ${match.related.join(", ")}`);
								}
								if (match.events.length > 0) {
									lines.push(`Appears in: ${match.events.join("; ")}`);
								}
								return lines.join("\n");
							})
							.join("\n\n");

			return { query, matches, formatted };
		},
	});

	const getBibleTimelineTool = tool({
		description:
			`Ordered events of Bible history from Creation to the writing of Revelation, with the traditional Ussher dating the KJV margins carry. Filter by era (${ATLAS_ERAS.join(", ")}), by the book and chapter the events touch, or by a person from lookupBibleEntity. Use it whenever the user asks when something happened, what came before or after it, or where a passage sits in the story. Prefer it over webSearch for Bible chronology.`,
		inputSchema: z.object({
			era: z.string().optional().describe("One of the nine eras, spelled exactly."),
			book: z
				.string()
				.optional()
				.describe('Bible book name, e.g. "Exodus" - events whose references fall in it.'),
			chapter: z.number().int().min(1).optional().describe("Narrows `book` to one chapter."),
			personId: z
				.string()
				.optional()
				.describe("An atlas id from lookupBibleEntity, e.g. \"moses\" - only their events."),
		}),
		execute: async ({ era, book, chapter, personId }): Promise<BibleTimelineToolOutput> => {
			if (era && !(ATLAS_ERAS as readonly string[]).includes(era)) {
				throw new Error(
					`Unknown era "${era}". The nine eras are: ${ATLAS_ERAS.join(", ")}.`
				);
			}
			let bookNumber: number | undefined;
			if (book) {
				bookNumber = getKjvBookNumber(book);
				if (!bookNumber) {
					throw new Error(`Unknown book name: "${book}". Use standard KJV book names.`);
				}
			}

			const timeline = await getTimeline({
				era,
				book: bookNumber,
				chapter: bookNumber ? chapter : undefined,
				personId,
			});
			const shown = timeline.events.slice(0, MAX_TIMELINE_EVENTS);
			const truncated = timeline.events.length - shown.length;

			const scopeParts: string[] = [];
			if (era) scopeParts.push(era);
			if (bookNumber) {
				scopeParts.push(
					`${getKjvBookName(bookNumber) ?? book}${chapter ? ` ${chapter}` : ""}`
				);
			}
			if (personId) scopeParts.push(personId);
			const scope = scopeParts.length > 0 ? scopeParts.join(" · ") : "the whole timeline";

			const flatten = (event: AtlasEventView) => ({
				id: event.id,
				title: event.title,
				era: event.era as string,
				yearLabel: event.yearLabel,
				summary: event.summary,
				refs: event.refs,
				people: event.people.map((person) => person.name),
				places: event.places.map((place) => place.name),
			});

			const events = shown.map(flatten);
			const formatted =
				events.length === 0
					? `No events on the timeline for ${scope}.`
					: [
							`Timeline - ${scope} (dates are the traditional Ussher chronology, not Scripture itself):`,
							...events.map(
								(event) =>
									`${event.yearLabel} - ${event.title} (${event.era}): ${event.summary} [${event.refs.join("; ")}]`
							),
							...(truncated > 0 ? [`(${truncated} further events not listed.)`] : []),
						].join("\n");

			return {
				scope,
				eras: timeline.eras.map((group) => group.era as string),
				events,
				truncated,
				formatted,
			};
		},
	});

	// The tool stays registered even when the user turned web search off so
	// past conversations containing tool-webSearch parts still validate; the
	// description and execute both refuse instead.
	const webSearchEnabled = context.webSearchEnabled ?? true;
	const webSearchTool = tool({
		description: webSearchEnabled
			? `Search the web for supplementary material: church history, archaeology, apologetics, current events, or original-language word studies. Never use it as an authority above or alongside Scripture; weigh everything it returns against the ${translation}.`
			: "Web search is turned off in the user's settings. Do NOT call this tool; if the user asks for web results, tell them web search is disabled and they can re-enable it in Settings → Web Search.",
		inputSchema: z.object({
			query: z.string().describe("A self-contained web search query."),
			topic: z
				.enum(["general", "news", "finance"])
				.optional()
				.describe('Search category. Use "news" for current-events questions; omit for everything else.'),
			timeRange: z
				.enum(["day", "week", "month", "year"])
				.optional()
				.describe("Only return results published or updated within this window. Omit for timeless topics."),
		}),
		execute: async ({ query, topic, timeRange }): Promise<WebSearchToolOutput> => {
			if (!webSearchEnabled) {
				throw new Error("Web search is turned off in the user's settings.");
			}
			return tavilySearch(query, { topic, timeRange });
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

	const readNoteTool = tool({
		description: context.defaultNoteId
			? "Read the full content of one of the user's Bible study notes. Omit noteId to read the note that is currently open. ALWAYS read a note with this tool before editing it with updateNote."
			: "Read the full content of one of the user's Bible study notes, located via findNotes. ALWAYS read a note with this tool before editing it with updateNote, and use it whenever answering well requires the note's actual content rather than the short preview findNotes returns.",
		inputSchema: z.object({
			noteId: z
				.string()
				.optional()
				.describe(
					"Note id from findNotes. Omit to read the currently open note (note chat only)."
				),
		}),
		execute: async ({ noteId }): Promise<ReadNoteToolOutput> => {
			const targetNoteId = noteId?.trim() || context.defaultNoteId;
			if (!targetNoteId) {
				throw new Error("No note specified. Use findNotes first to locate the note.");
			}
			return readUserNote(context.userId, targetNoteId);
		},
	});

	const updateNoteTool = tool({
		description:
			"REPLACE the entire content of one of the user's Bible study notes with rewritten markdown, optionally retitling it. This OVERWRITES what the note currently says, so: (1) only call it when the user explicitly asks you to edit, reformat, reorganize, correct, or clean up a note — never to merely add content (use addToNote for that); (2) you MUST have read the note with readNote in this conversation first; (3) preserve everything the user wrote unless they asked you to change it — reformatting means restructuring their content faithfully, not summarizing or trimming it.",
		inputSchema: z.object({
			markdown: z
				.string()
				.describe(
					"The complete new note content as clean markdown (headings, lists, blockquotes for verses). This replaces the whole note body."
				),
			noteId: z
				.string()
				.optional()
				.describe(
					"Note id from findNotes/readNote. Omit to update the currently open note (note chat only)."
				),
			title: z.string().optional().describe("New title, only when the user asked to rename the note."),
		}),
		execute: async ({ markdown, noteId, title }): Promise<UpdateNoteToolOutput> => {
			const targetNoteId = noteId?.trim() || context.defaultNoteId;
			if (!targetNoteId) {
				throw new Error("No note specified. Use findNotes first to locate the note.");
			}
			return rewriteNote({ userId: context.userId, noteId: targetNoteId, markdown, title });
		},
	});

	const findNotesTool = tool({
		description:
			"Search the user's Bible study notes by exact wording AND by meaning (semantic search over everything they have written). Use this to locate the right note before reading, adding to, or editing it, when the user refers to one of their notes, or when their past study notes might inform your answer.",
		inputSchema: z.object({
			query: z
				.string()
				.describe(
					"Words from the note title/content, or a description of the topic to find notes about. Empty string lists recent notes."
				),
		}),
		execute: async ({ query }): Promise<FindNotesToolOutput> => {
			const notes = await findUserNotes(context.userId, query);
			return { notes };
		},
	});

	const getHighlightsTool = tool({
		description:
			`Read the verses this user has highlighted in the SureWord Bible reader, with the colour they chose and the exact ${translation} text. Call it whenever they mention their highlights or what they have marked, ask what they have been studying, or whenever the verses they singled out should shape your answer - highlighting is how they flag what matters to them. Read-only.`,
		inputSchema: z.object({
			book: z
				.string()
				.optional()
				.describe(
					'Limit to one book, e.g. "Psalms". Omit to get their most recently highlighted verses across the whole Bible.'
				),
			chapter: z
				.number()
				.int()
				.min(1)
				.optional()
				.describe("Limit to one chapter. Only meaningful together with book."),
			limit: z
				.number()
				.int()
				.min(1)
				.max(50)
				.optional()
				.describe("How many verses to return, most recently highlighted first (default 25)."),
		}),
		execute: async ({ book, chapter, limit }): Promise<HighlightsToolOutput> => {
			const bookNumber = book ? getKjvBookNumber(book) : undefined;
			// An unrecognised book name would otherwise silently widen the search
			// to the whole Bible and read as "you have no highlights there".
			if (book && bookNumber === undefined) {
				return {
					total: 0,
					scope: `in ${book}`,
					highlights: [],
					formatted: `"${book}" is not a Bible book name, so no highlights could be looked up.`,
				};
			}
			const scope =
				bookNumber !== undefined
					? `in ${getKjvBookName(bookNumber)}${chapter !== undefined ? ` ${chapter}` : ""}`
					: "in their Bible";
			const listing = await listUserHighlights(context.userId, {
				translation,
				book: bookNumber,
				chapter: bookNumber !== undefined ? chapter : undefined,
				limit,
			});
			return {
				...listing,
				scope,
				formatted: formatHighlightsForModel(listing, translation, scope),
			};
		},
	});

	const getDailyCrossTool = tool({
		description:
			"Read the user's \"Pick Up Your Cross\" for today — the guided day SureWord builds for them from their own reading, questions, notes and memories: today's verse, why it was chosen, how it applies, a short study path, and a question to carry. Call this whenever they ask what today's cross, verse or word is, or whenever an answer should build on the day they were already given. If no day has been prepared yet, this prepares it.",
		inputSchema: z.object({}),
		execute: async (): Promise<DailyCrossToolOutput> => {
			const existing = await findTodayCross(context.userId);
			if (existing) {
				const { scheduleDailyCrossAudio } = await import("@/lib/daily-cross-audio");
				await scheduleDailyCrossAudio(context.userId).catch((error: unknown) => {
					console.error(`[ai-tools] Could not schedule existing Daily Cross audio for ${context.userId}:`, error);
				});
				return toDailyCrossOutput(existing);
			}
			const cross = await generateDailyCross(context.userId);
			await storeDailyCross(context.userId, cross);
			const { scheduleDailyCrossAudio } = await import("@/lib/daily-cross-audio");
			await scheduleDailyCrossAudio(context.userId).catch((error: unknown) => {
				console.error(`[ai-tools] Could not schedule Daily Cross audio for ${context.userId}:`, error);
			});
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

	const getReadingPlanTool = tool({
		description:
			"Read the reading plan this user is following: today's reading, how far through they are, their streak, and the next few days. Also lists the plans they could start if they have none. Call it whenever they ask about their plan or what they are meant to read, and whenever knowing where they are in Scripture would make your answer fit their actual walk. Read-only.",
		inputSchema: z.object({}),
		execute: async (): Promise<ReadingPlanToolOutput> =>
			toReadingPlanOutput(await getActivePlan(context.userId)),
	});

	const startReadingPlanTool = tool({
		description:
			"Start a reading plan for the user - either one of SureWord's presets (pass presetKey) or one written for a goal they described (pass goal and days). This ARCHIVES whatever plan they are currently following, on every device. ONLY call it after the user has explicitly agreed, in this conversation, to starting that plan: name the plan and what it would replace, ask them, wait for a clear yes, and only then call this with confirmed: true. Never call it to answer a question about reading plans.",
		inputSchema: z.object({
			confirmed: z
				.boolean()
				.describe(
					"True only when the user has said yes to this exact plan in this conversation. Never send true on your own initiative."
				),
			presetKey: z
				.string()
				.optional()
				.describe(
					"Key of a built-in plan from getReadingPlan's presets list. Omit when writing a plan for a goal instead."
				),
			goal: z
				.string()
				.optional()
				.describe(
					'What the user wants the plan to walk them through, in their own words, e.g. "the life of David" or "everything Jesus said about prayer". Omit when using presetKey.'
				),
			days: z
				.number()
				.int()
				.min(MIN_PLAN_DAYS)
				.max(MAX_PLAN_DAYS)
				.optional()
				.describe(`How many days the written plan should run (${MIN_PLAN_DAYS}-${MAX_PLAN_DAYS}). Only with goal.`),
		}),
		execute: async ({ confirmed, presetKey, goal, days }): Promise<ReadingPlanToolOutput> => {
			if (!confirmed) {
				throw new Error(
					"The user has not agreed to start this plan yet. Tell them which plan you would start and what it would replace, ask them, and only call this again once they say yes."
				);
			}
			const key = presetKey?.trim();
			const described = goal?.trim();
			if (!key && !described) {
				throw new Error("Pass either presetKey, or goal (with days) to have a plan written.");
			}
			const plan = key
				? await startPlan(context.userId, { presetKey: key })
				: await startPlan(context.userId, { goal: described ?? "", days: days ?? 30 });
			return toReadingPlanOutput(plan);
		},
	});

	const markReadingPlanDayTool = tool({
		description:
			"Tick a day of the user's reading plan as done (or untick it with done: false). Only for reading they did OUTSIDE SureWord - chapters they read in the app's own Bible reader already count themselves, so never tick a day just because they mention reading. Ask which day if it is not obvious from what they said.",
		inputSchema: z.object({
			day: z.number().int().min(1).describe("Which day of the plan, 1-based."),
			done: z
				.boolean()
				.optional()
				.describe("True to mark it read (the default), false to undo a mark."),
		}),
		execute: async ({ day, done }): Promise<ReadingPlanToolOutput> => {
			const plan = await getActivePlan(context.userId);
			if (!plan) {
				throw new Error("The user is not following a reading plan, so there is no day to mark.");
			}
			return toReadingPlanOutput(await setDayDone(context.userId, plan.id, day, done ?? true));
		},
	});

	return {
		searchScripture: searchScriptureTool,
		getPassage: getPassageTool,
		getCrossReferences: getCrossReferencesTool,
		getOriginalText: getOriginalTextTool,
		lookupStrongs: lookupStrongsTool,
		lookupBibleEntity: lookupBibleEntityTool,
		getBibleTimeline: getBibleTimelineTool,
		webSearch: webSearchTool,
		addToNote: addToNoteTool,
		readNote: readNoteTool,
		updateNote: updateNoteTool,
		findNotes: findNotesTool,
		getHighlights: getHighlightsTool,
		getDailyCross: getDailyCrossTool,
		setDailyCross: setDailyCrossTool,
		getReadingPlan: getReadingPlanTool,
		startReadingPlan: startReadingPlanTool,
		markReadingPlanDay: markReadingPlanDayTool,
	};
}

const PRESET_SUMMARIES = READING_PLAN_PRESETS.map((preset) => ({
	key: preset.key,
	title: preset.title,
	description: preset.description,
	dayCount: preset.dayCount,
}));

/** Flatten a plan for the model, with a prose summary it can answer from. */
function toReadingPlanOutput(plan: PlanWithProgress | null): ReadingPlanToolOutput {
	if (!plan || plan.status === "archived") {
		return {
			hasPlan: false,
			title: null,
			description: null,
			status: null,
			dayCount: 0,
			currentDay: 0,
			todayDay: 0,
			completedCount: 0,
			percent: 0,
			streak: 0,
			today: null,
			next: [],
			presets: PRESET_SUMMARIES,
			formatted: `They are not following a reading plan. Plans they could start: ${PRESET_SUMMARIES.map(
				(preset) => `${preset.title} (${preset.dayCount} days, key "${preset.key}")`
			).join("; ")}. You can also have one written for a goal they describe.`,
		};
	}

	const flatten = (day: PlanWithProgress["days"][number]): ReadingPlanDayOutput => ({
		day: day.day,
		reference: describeReadings(day.readings),
		focus: day.focus,
		done: day.done,
	});

	const today = plan.days.find((day) => day.day === plan.currentDay) ?? null;
	const next = plan.days
		.filter((day) => day.day > plan.currentDay)
		.slice(0, PLAN_DAYS_AHEAD)
		.map(flatten);

	const lines = [
		`Plan: ${plan.title} (${plan.dayCount} days, ${plan.status}).`,
		today
			? `Today is day ${today.day}: ${describeReadings(today.readings)}${
					today.done ? " - already read" : ""
				}. Focus: ${today.focus}`
			: "Every day of this plan is finished.",
		`Progress: ${plan.completedCount} of ${plan.dayCount} days (${plan.percent}%), streak ${plan.streak} ${
			plan.streak === 1 ? "day" : "days"
		}.`,
		next.length
			? `Coming up: ${next.map((day) => `day ${day.day} - ${day.reference}`).join("; ")}.`
			: null,
	].filter((line): line is string => line !== null);

	return {
		hasPlan: true,
		title: plan.title,
		description: plan.description,
		status: plan.status,
		dayCount: plan.dayCount,
		currentDay: plan.currentDay,
		todayDay: plan.todayDay,
		completedCount: plan.completedCount,
		percent: plan.percent,
		streak: plan.streak,
		today: today ? flatten(today) : null,
		next,
		presets: PRESET_SUMMARIES,
		formatted: lines.join("\n"),
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

/**
 * Transient data parts the routes stream alongside the answer. `status` is what
 * the assistant is doing right now; it is never persisted.
 */
export type SureWordDataTypes = {
	status: { label: string };
};

/** UIMessage typed with the SureWord tool set, shared by server and client. */
export type SureWordUIMessage = UIMessage<
	SureWordMessageMetadata,
	SureWordDataTypes,
	InferUITools<SureWordTools>
>;

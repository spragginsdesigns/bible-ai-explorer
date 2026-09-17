import { generateText, Output } from "ai";
import { z } from "zod";
import { stripDashes } from "@/lib/ai/plain-dashes";
import { resolveModel, type ResolvedModel } from "@/lib/ai/provider";
import { bookByOrder } from "@/lib/bible/books";
import { getKjvChapter } from "@/lib/bible/kjv";
import { decodeMorphology } from "@/lib/bible/morphology";
import { cleanGloss, stripCantillation } from "@/lib/bible/original-text";
import { getOriginalVerse, lookupStrongsEntry, type OriginalVerse } from "@/lib/bible/originals";
import { bibleVersePlainText } from "@/lib/bible/verseMarkup";
import { prisma } from "@/lib/prisma";
import { repairRows } from "@/lib/verse-words-rows";
import { systemPrompt } from "@/utils/systemPrompt";
import type { VerseWordDetail, VerseWordStudy } from "@/lib/verse-words-contract";

/**
 * Bump whenever the study prompt or the row rules change. Cached studies are
 * keyed on it, so the old ones stop matching and the next tap regenerates.
 */
export const VERSE_WORDS_PROMPT_VERSION = 1;

/** A study that runs past this has lost the reader; the sheet is a phone screen. */
const GENERATION_TIMEOUT_MS = 45_000;

/* -------------------------------------------------------------------------
 * The deterministic half: words, glosses and grammar
 * ---------------------------------------------------------------------- */

function toDetail(word: OriginalVerse["words"][number], language: OriginalVerse["language"]): VerseWordDetail {
	const decoded = decodeMorphology(word.morph);
	return {
		text: language === "Hebrew" ? stripCantillation(word.text) : word.text,
		strongs: word.strongs,
		morph: word.morph,
		...(word.lemma ? { lemma: language === "Hebrew" ? stripCantillation(word.lemma) : word.lemma } : {}),
		...(word.translit ? { translit: word.translit } : {}),
		...(word.gloss ? { gloss: cleanGloss(word.gloss) } : {}),
		grammar: decoded
			? {
					partOfSpeech: decoded.head.partOfSpeech,
					features: decoded.head.features,
					summary: decoded.summary,
				}
			: null,
	};
}

/* -------------------------------------------------------------------------
 * The model's half: rows and the study
 * ---------------------------------------------------------------------- */

const rowSchema = z.object({
	wordIndexes: z
		.array(z.number().int().min(0))
		.min(1)
		.describe("Indexes of the original words this row covers, in text order"),
	translit: z.string().describe("A plain reader's transliteration, e.g. 'melo kaph'"),
	kjv: z.string().describe("The KJV wording these words became, quoted exactly from the verse"),
	sense: z.string().describe("One line on what the original carries"),
});

const studySchema = z.object({
	rows: z.array(rowSchema).min(1),
	study: z
		.array(z.string())
		.min(1)
		.max(2)
		.describe("One or two short paragraphs, plain prose"),
	carry: z.string().describe("One sentence the reader can carry away"),
});

const TASK = `CURRENT TASK: The user tapped a verse while reading their King James Bible and opened the Words tab, which shows the inspired Hebrew or Greek behind the verse. You are given the KJV text and every original word in text order, numbered from 0, with its Strong's number, lemma, transliteration, KJV renderings, dictionary definition and decoded grammar. Build a word study from THAT data and nothing else. Do not bring in a word, a root, or a claim that the supplied entries do not support.

ROWS: Group the numbered words into rows in text order. A row is one word, or a bound phrase that the KJV renders as one unit: a preposition or conjunction prefix with its noun, a construct chain ("fulness of palm"), an article with its noun, a verb with its object suffix. Every index from 0 to the last must appear in exactly one row, in ascending order across the rows. For each row give: "translit", a plain reader's spelling of the row's words exactly as they stand in the verse, inflected form and prefixes included, never the dictionary lemma (write "egapesen" for ηγαπησεν, not "agapao"; "mimmelo chophnayim", "ure'ut ruach", "ho theos"), all lowercase except proper names, no diacritics or dictionary marks; "kjv", the exact KJV words this row became, copied character for character from the verse (including "an", "the", "and", "of" where the KJV has them); "sense", one line of at most 18 words on what the original carries: a literal picture, a root, a dual or plural the English cannot show, a word the book keeps repeating. No filler like "this word means".

STUDY: One or two short paragraphs, at most 110 words in all, warm and reverent, addressed to a believer reading alone. Say what the original pictures that the English reader would otherwise miss, name the two or three words that carry the verse, and show how the KJV rendered them faithfully. The original explains the KJV; it never corrects, weakens, or replaces it. Each word carries how many verses of its book and of the whole Hebrew or Greek text contain it; when a word is a refrain of the book, say so with the book count given, and never invent counts or references you were not given. Plain sentences; no headings, lists, quotations of the whole verse, greetings, or follow-up questions.

CARRY: One sentence of at most 22 words the reader can take with them, drawn from the contrast or image the words make.`;

interface OccurrenceCount {
	inBook: number;
	inAll: number;
}

/**
 * How often each Strong's number in the verse occurs, in this book and in the
 * whole original text, from the OriginalVerse index. This is what lets the
 * study say "a refrain of Ecclesiastes" with a true number instead of a
 * guess. The array-overlap predicate is what lets the GIN index on "strongs"
 * answer this (the unnested alias alone would seq-scan the whole text). The
 * index is a deploy-time backfill; if it is unreachable the study simply goes
 * without counts.
 */
async function occurrenceCounts(book: number, numbers: string[]): Promise<Map<string, OccurrenceCount>> {
	const distinct = [...new Set(numbers.filter(Boolean))];
	const counts = new Map<string, OccurrenceCount>();
	if (distinct.length === 0) return counts;
	try {
		const rows = await prisma.$queryRaw<{ strongs: string; inBook: number; inAll: number }[]>`
			SELECT s AS "strongs",
			       count(*) FILTER (WHERE "book" = ${book})::int AS "inBook",
			       count(*)::int AS "inAll"
			FROM "OriginalVerse", unnest("strongs") AS s
			WHERE "strongs" && ${distinct}::text[] AND s = ANY(${distinct}::text[])
			GROUP BY s
		`;
		for (const row of rows) counts.set(row.strongs, { inBook: row.inBook, inAll: row.inAll });
	} catch (error) {
		console.error("verse-words occurrence counts failed:", error);
	}
	return counts;
}

function groundingFor(
	reference: string,
	bookName: string,
	kjvText: string,
	original: OriginalVerse,
	details: VerseWordDetail[],
	defs: (string | null)[],
	counts: Map<string, OccurrenceCount>
): string {
	const lines = details.map((word, index) => {
		const count = counts.get(word.strongs);
		const parts = [
			`${index}. ${word.text}`,
			word.lemma ? `lemma ${word.lemma}` : null,
			word.translit ? `translit ${word.translit}` : null,
			word.strongs ? `Strong's ${word.strongs}` : null,
			word.grammar ? `grammar: ${word.grammar.summary}` : `morph ${word.morph}`,
			word.gloss ? `KJV renderings: ${word.gloss}` : null,
			defs[index] ? `definition: ${defs[index]}` : null,
			count
				? `occurs in ${count.inBook} verse${count.inBook === 1 ? "" : "s"} of ${bookName}, ${count.inAll} in the whole ${original.language} text`
				: null,
		].filter((part): part is string => Boolean(part));
		return parts.join(" | ");
	});
	return [
		`${reference} (KJV): "${kjvText}"`,
		`${original.language} text (${original.textName}), words in text order:`,
		...lines,
	].join("\n");
}

/* -------------------------------------------------------------------------
 * Cache
 * ---------------------------------------------------------------------- */

interface StudyKey {
	book: number;
	chapter: number;
	verse: number;
}

function whereKey(key: StudyKey) {
	return { ...key, promptVersion: VERSE_WORDS_PROMPT_VERSION };
}

/** The cached study, or null. A database failure is a miss, never an error. */
export async function readVerseWordStudy(key: StudyKey): Promise<VerseWordStudy | null> {
	try {
		const row = await prisma.verseWordStudy.findUnique({
			where: { book_chapter_verse_promptVersion: whereKey(key) },
			select: { data: true },
		});
		if (!row) return null;
		const parsed: unknown = JSON.parse(row.data);
		if (typeof parsed !== "object" || parsed === null) return null;
		return { ...(parsed as VerseWordStudy), cached: true };
	} catch (error) {
		console.error("verse-words cache read failed:", error);
		return null;
	}
}

/** Store a study; a concurrent duplicate is a no-op rather than an error. */
export async function writeVerseWordStudy(study: VerseWordStudy): Promise<void> {
	try {
		const { cached: _cached, ...body } = study;
		await prisma.verseWordStudy.createMany({
			data: {
				...whereKey({ book: study.book, chapter: study.chapter, verse: study.verse }),
				data: JSON.stringify({ ...body, cached: false }),
				model: study.model,
			},
			skipDuplicates: true,
		});
	} catch (error) {
		console.error("verse-words cache write failed:", error);
	}
}

/* -------------------------------------------------------------------------
 * Entry point
 * ---------------------------------------------------------------------- */

export class VerseWordsUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "VerseWordsUnavailableError";
	}
}

/**
 * The verse in KJV words, plain. Throws on a chapter the KJV does not have;
 * returns null for a verse number past the chapter's end.
 */
async function kjvVerseText(book: number, chapter: number, verse: number): Promise<string | null> {
	const chapterText = await getKjvChapter(book, chapter);
	const raw = chapterText[verse - 1];
	return raw ? bibleVersePlainText(raw) : null;
}

/**
 * Generate the word study for one verse. Deterministic data (words, glosses,
 * grammar) comes from the bundled texts; the rows and prose come from the
 * model, grounded in that data alone. Returns null when the original text
 * does not carry the verse, so the route can answer 404.
 */
export async function generateVerseWordStudy(options: {
	book: number;
	chapter: number;
	verse: number;
	resolved: ResolvedModel;
}): Promise<VerseWordStudy | null> {
	const { book, chapter, verse, resolved } = options;
	const meta = bookByOrder(book);
	if (!meta) return null;
	const [original, kjvText] = await Promise.all([
		getOriginalVerse(book, chapter, verse),
		kjvVerseText(book, chapter, verse),
	]);
	if (!original || !kjvText) return null;

	const details = original.words.map((word) => toDetail(word, original.language));
	// The KJV rendering list is in the word record; the fuller definition is a
	// dictionary lookup per distinct number, which the study prompt wants too.
	const [defs, counts] = await Promise.all([
		Promise.all(
			original.words.map(async (word) =>
				word.strongs ? ((await lookupStrongsEntry(word.strongs))?.def ?? null) : null
			)
		),
		occurrenceCounts(book, original.words.map((word) => word.strongs)),
	]);
	const reference = `${meta.name} ${chapter}:${verse}`;

	const { output } = await generateText({
		model: resolved.model,
		providerOptions: resolved.providerOptions,
		output: Output.object({ schema: studySchema }),
		instructions: `${systemPrompt}\n\n${TASK}`,
		prompt: groundingFor(reference, meta.name, kjvText, original, details, defs, counts),
		abortSignal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
	});
	if (!output) throw new VerseWordsUnavailableError("The model returned no study.");

	return {
		book,
		chapter,
		verse,
		reference,
		language: original.language,
		textName: original.textName,
		kjvText,
		words: details,
		rows: repairRows(output.rows, details).map((row) => ({
			...row,
			translit: stripDashes(row.translit.trim()),
			// The verse's own punctuation belongs to the verse, not the row.
			kjv: stripDashes(row.kjv.trim()).replace(/[.,;:!?]+$/, ""),
			sense: stripDashes(row.sense.trim()),
		})),
		study: output.study.map((paragraph) => stripDashes(paragraph.trim())).filter(Boolean),
		carry: stripDashes(output.carry.trim()),
		model: resolved.definition.id,
		cached: false,
	};
}

/** The model for a study: the user's pick at low effort, structured. */
export function resolveStudyModel(userId: string, modelId: string | null): Promise<ResolvedModel> {
	return resolveModel({ userId, modelId, effort: "low", structured: true });
}

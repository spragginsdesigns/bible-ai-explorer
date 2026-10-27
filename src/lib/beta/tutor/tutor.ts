import "server-only";

import { generateText, Output } from "ai";
import { z } from "zod";
import type { BetaItem } from "@prisma/client";
import { stripDashes } from "@/lib/ai/plain-dashes";
import { resolveModel, type ResolvedModel } from "@/lib/ai/provider";
import { bookByOrder, resolveReference } from "@/lib/bible/books";
import { getCrossReferencesFor } from "@/lib/bible/crossRefs";
import { getKjvChapter } from "@/lib/bible/kjv";
import { bibleVersePlainText } from "@/lib/bible/verseMarkup";
import { createBetaItem, deleteBetaItem, getBetaItem, listBetaItems, updateBetaItem } from "@/lib/beta/store";
import { BETA_DATA_MAX_BYTES, BETA_REFS_MAX } from "@/lib/beta/store-rules";
import { appendMarkdownToNote } from "@/lib/notes-io";
import { searchScripture } from "@/lib/scripture-search";
import { doctrinalFoundation, interpretationGuidance } from "@/utils/systemPrompt";
import { parsePassageInput } from "./passage";
import {
	TUTOR_MODULE,
	TUTOR_SESSION_KIND,
	TUTOR_TURNS_MAX,
	adaptLevel,
	answerVerdicts,
	checkPassageRange,
	effectiveAction,
	formatPassageReference,
	hintsPerQuestion,
	latestCheck,
	levelChangeText,
	newSessionData,
	nextHintStep,
	nextStageOptions,
	openQuestion,
	parseSessionData,
	passageRefKeys,
	sessionBody,
	sessionNoteMarkdown,
	sessionTitle,
	sessionView,
	settleNextStage,
	summarizeSession,
	transcriptForModel,
	type TutorActionInput,
	type TutorCitation,
	type TutorCitationSource,
	type TutorLevel,
	type TutorPassage,
	type TutorSessionData,
	type TutorSessionSummary,
	type TutorSessionView,
	type TutorStage,
	type TutorTurn,
} from "./tutor-rules";

/**
 * The Socratic Tutor's server half (LC-17650, docs/beta/tutor.md). A session
 * is one `BetaItem` (module "tutor", kind "session") in the shared study
 * store. Every founder action is one structured call to the house model,
 * grounded in the passage, the rest of its chapter, the chapter before, the
 * bundled cross-references and a Scripture search on the founder's own words.
 * The model cites verses by reference only: every citation is checked against
 * that grounding and its text is taken from the bundled KJV.
 */

export class TutorUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TutorUnavailableError";
	}
}

/** The route's budget is 60 s; the grounding, the store writes and the response share the rest. */
const GENERATION_TIMEOUT_MS = 45_000;
const SEARCH_TIMEOUT_MS = 8_000;
const CROSS_REFS_PER_VERSE = 3;
const CROSS_REFS_MAX = 36;
const CITATION_MAX_VERSES = 4;
const SEARCH_RESULTS = 6;
/** The store adds each verse key's chapter key and holds BETA_REFS_MAX in all, so verse keys get half. */
const REFS_MAX = Math.floor(BETA_REFS_MAX / 2);
/** A session this close to the store's data cap takes no new turn; one turn adds far less. */
const DATA_HEADROOM_BYTES = 32 * 1024;
const TOPICS_MAX = 8;

/* -------------------------------------------------------------------------
 * Scripture
 * ---------------------------------------------------------------------- */

interface GroundVerse {
	reference: string;
	text: string;
	source: TutorCitationSource;
}

interface Grounding {
	passage: TutorPassage;
	bookName: string;
	verses: { verse: number; text: string }[];
	/** Every verse the tutor may cite, by "book.chapter.verse". */
	allowed: Map<string, GroundVerse>;
	prompt: string;
}

const key = (book: number, chapter: number, verse: number) => `${book}.${chapter}.${verse}`;
const newId = () => crypto.randomUUID();

async function plainChapter(book: number, chapter: number): Promise<string[]> {
	return (await getKjvChapter(book, chapter)).map((raw) => bibleVersePlainText(raw).replace(/\s+/g, " ").trim());
}

/** The passage a founder typed, checked against the chapter's real length. */
export async function resolvePassage(input: string): Promise<TutorPassage | { error: string }> {
	const parsed = parsePassageInput(input);
	if ("error" in parsed) return parsed;
	const chapter = await plainChapter(parsed.book, parsed.chapter);
	const range = checkPassageRange(parsed.start, parsed.end, chapter.length);
	if (!range.ok) return { error: range.error };
	return {
		book: parsed.book,
		chapter: parsed.chapter,
		start: range.value.start,
		end: range.value.end,
		reference: formatPassageReference(parsed.bookName, parsed.chapter, range.value.start, range.value.end),
	};
}

/** The studied verses, as the session screen and the note show them. */
export async function passageVerses(passage: TutorPassage): Promise<{ verse: number; text: string }[]> {
	const chapter = await plainChapter(passage.book, passage.chapter);
	return chapter.slice(passage.start - 1, passage.end).map((text, index) => ({ verse: passage.start + index, text }));
}

function labelled(rows: readonly GroundVerse[]): string {
	return rows.map((row) => `[${row.reference}] ${row.text}`).join("\n");
}

/** Cross-references for the passage, ranked, round-robin across its verses so each verse contributes. */
async function crossReferences(passage: TutorPassage, allowed: Map<string, GroundVerse>): Promise<GroundVerse[]> {
	const perVerse = await Promise.all(
		Array.from({ length: passage.end - passage.start + 1 }, (_, index) =>
			getCrossReferencesFor(passage.book, passage.chapter, passage.start + index).catch(() => []),
		),
	);
	const picked: { book: number; chapter: number; start: number; end: number }[] = [];
	const seen = new Set<string>();
	for (let rank = 0; rank < CROSS_REFS_PER_VERSE && picked.length < CROSS_REFS_MAX; rank++) {
		for (const refs of perVerse) {
			const ref = refs[rank];
			if (!ref || picked.length >= CROSS_REFS_MAX) continue;
			// A range stays in its first chapter and is held to a few verses.
			const end = ref.endChapter === undefined || ref.endChapter !== ref.chapter ? ref.verse : Math.min(ref.endVerse ?? ref.verse, ref.verse + 2);
			const id = `${ref.order}.${ref.chapter}.${ref.verse}-${end}`;
			if (seen.has(id) || allowed.has(key(ref.order, ref.chapter, ref.verse))) continue;
			seen.add(id);
			picked.push({ book: ref.order, chapter: ref.chapter, start: ref.verse, end });
		}
	}
	const rows: GroundVerse[] = [];
	for (const ref of picked) {
		const meta = bookByOrder(ref.book);
		if (!meta) continue;
		const chapter = await plainChapter(ref.book, ref.chapter).catch(() => null);
		if (!chapter) continue;
		for (let verse = ref.start; verse <= ref.end && verse <= chapter.length; verse++) {
			const k = key(ref.book, ref.chapter, verse);
			if (allowed.has(k)) continue;
			const row = { reference: `${meta.name} ${ref.chapter}:${verse}`, text: chapter[verse - 1], source: "cross-reference" as const };
			allowed.set(k, row);
			rows.push(row);
		}
	}
	return rows;
}

/** Verses a Scripture search finds for the founder's own words, beyond what is already shown. */
async function searchedVerses(query: string, allowed: Map<string, GroundVerse>): Promise<GroundVerse[]> {
	const text = query.trim().slice(0, 400);
	if (text.length < 8) return [];
	try {
		const result = await searchScripture(text, SEARCH_RESULTS, "KJV", AbortSignal.timeout(SEARCH_TIMEOUT_MS));
		const rows: GroundVerse[] = [];
		for (const hit of result.verses) {
			const ref = resolveReference(hit.reference);
			const meta = ref?.verse ? bookByOrder(ref.order) : null;
			if (!ref?.verse || !meta) continue;
			const k = key(ref.order, ref.chapter, ref.verse);
			if (allowed.has(k)) continue;
			const chapter = await plainChapter(ref.order, ref.chapter);
			const verseText = chapter[ref.verse - 1];
			if (!verseText) continue;
			const row = { reference: `${meta.name} ${ref.chapter}:${ref.verse}`, text: verseText, source: "search" as const };
			allowed.set(k, row);
			rows.push(row);
		}
		return rows;
	} catch (error) {
		console.error("tutor scripture search failed:", error instanceof Error ? error.message : error);
		return [];
	}
}

/**
 * Everything the tutor reads for one turn: the passage, the rest of its
 * chapter, the whole chapter before (the wider context the issue asks for),
 * the bundled cross-references, and verses found for the founder's words.
 */
async function buildGrounding(passage: TutorPassage, searchFor: string | null): Promise<Grounding> {
	const meta = bookByOrder(passage.book);
	if (!meta) throw new TutorUnavailableError("Unknown book.");
	const allowed = new Map<string, GroundVerse>();
	const chapter = await plainChapter(passage.book, passage.chapter);
	const studied: GroundVerse[] = [];
	const rest: GroundVerse[] = [];
	chapter.forEach((text, index) => {
		const verse = index + 1;
		const inPassage = verse >= passage.start && verse <= passage.end;
		const row = { reference: `${meta.name} ${passage.chapter}:${verse}`, text, source: inPassage ? ("passage" as const) : ("chapter" as const) };
		allowed.set(key(passage.book, passage.chapter, verse), row);
		(inPassage ? studied : rest).push(row);
	});
	const before: GroundVerse[] = [];
	if (passage.chapter > 1) {
		const previous = await plainChapter(passage.book, passage.chapter - 1);
		previous.forEach((text, index) => {
			const row = { reference: `${meta.name} ${passage.chapter - 1}:${index + 1}`, text, source: "preceding" as const };
			allowed.set(key(passage.book, passage.chapter - 1, index + 1), row);
			before.push(row);
		});
	}
	const crossRefs = await crossReferences(passage, allowed);
	const found = searchFor ? await searchedVerses(searchFor, allowed) : [];

	const sections = [
		`THE PASSAGE BEING STUDIED: ${passage.reference} (KJV)\n${labelled(studied)}`,
		rest.length ? `THE REST OF ${meta.name.toUpperCase()} ${passage.chapter} (KJV)\n${labelled(rest)}` : "",
		before.length
			? `THE CHAPTER BEFORE: ${meta.name.toUpperCase()} ${passage.chapter - 1} (KJV)\n${labelled(before)}`
			: `THE CHAPTER BEFORE: none, this is the first chapter of ${meta.name}.`,
		crossRefs.length ? `CROSS-REFERENCES FROM THE PASSAGE'S VERSES (KJV)\n${labelled(crossRefs)}` : "",
		found.length ? `VERSES FOUND FOR THE LEARNER'S WORDS (KJV, by search; relevance is not proof)\n${labelled(found)}` : "",
	].filter(Boolean);

	return {
		passage,
		bookName: meta.name,
		verses: studied.map((row, index) => ({ verse: passage.start + index, text: row.text })),
		allowed,
		prompt: sections.join("\n\n"),
	};
}

/* -------------------------------------------------------------------------
 * Citations
 * ---------------------------------------------------------------------- */

interface RawCitation {
	ref: string;
	why: string;
}

/**
 * A citation the model wrote, resolved to verses it was actually shown.
 * "Romans 5:8", "Rom 4:3-5", "5:8" and "verse 8" (the passage's chapter) are
 * read; anything outside the grounding is dropped, never invented.
 */
function resolveCitation(raw: RawCitation, grounding: Grounding): TutorCitation | null {
	let text = raw.ref.replace(/[[\]()]/g, "").trim();
	const bareVerse = /^(?:verses?|vv?\.?)\s*(\d+)(?:\s*[-–—]\s*(\d+))?$/i.exec(text);
	if (bareVerse) text = `${grounding.bookName} ${grounding.passage.chapter}:${bareVerse[1]}${bareVerse[2] ? `-${bareVerse[2]}` : ""}`;
	else if (/^\d+\s*:\s*\d+/.test(text)) text = `${grounding.bookName} ${text}`;
	// A whole chapter is not a citation; the tutor must point to verses.
	if (!text.includes(":")) return null;
	const parsed = parsePassageInput(text);
	if ("error" in parsed) return null;
	const end = Math.min(parsed.end ?? parsed.start, parsed.start + CITATION_MAX_VERSES - 1);
	const kept: { verse: number; row: GroundVerse }[] = [];
	for (let verse = parsed.start; verse <= end; verse++) {
		const row = grounding.allowed.get(key(parsed.book, parsed.chapter, verse));
		if (!row) {
			if (kept.length) break;
			continue;
		}
		kept.push({ verse, row });
	}
	if (!kept.length) return null;
	const first = kept[0].verse;
	const last = kept[kept.length - 1].verse;
	return {
		reference: formatPassageReference(parsed.bookName, parsed.chapter, first, last),
		keys: kept.map(({ verse }) => key(parsed.book, parsed.chapter, verse)),
		text: kept.map(({ row }) => row.text).join(" "),
		why: plain(raw.why).slice(0, 160),
		source: kept[0].row.source,
	};
}

function resolveCitations(raw: readonly RawCitation[], grounding: Grounding, max: number): TutorCitation[] {
	const out: TutorCitation[] = [];
	for (const item of raw) {
		const citation = resolveCitation(item, grounding);
		if (citation && !out.some((existing) => existing.reference === citation.reference)) out.push(citation);
		if (out.length >= max) break;
	}
	return out;
}

/* -------------------------------------------------------------------------
 * The model
 * ---------------------------------------------------------------------- */

/** Plain, dash-free prose: the tutor's words are shown as text, never markdown. */
function plain(text: string): string {
	return stripDashes(text.replace(/\*\*|__|^#+\s*/gm, "").replace(/\s+/g, " ").trim());
}

/** Feedback asks nothing: the next question is the only one. Question sentences are dropped. */
function withoutQuestions(text: string): string {
	const sentences = text.match(/[^.!?]+[.!?]+["\u201d\u2019)]*\s*|[^.!?]+$/g) ?? [text];
	const kept = sentences.filter((sentence) => !/\?["\u201d\u2019)]*\s*$/.test(sentence)).join("").trim();
	return kept || text;
}

/** One question only: anything after the first question mark is dropped. */
function oneQuestion(text: string): string {
	const clean = plain(text);
	const mark = clean.indexOf("?");
	return mark >= 0 && mark < clean.length - 1 && clean.slice(mark + 1).includes("?") ? clean.slice(0, mark + 1) : clean;
}

const citationSchema = z.object({
	ref: z.string().describe('A verse shown above, by its bracketed label: "Romans 5:8", or a short range like "Romans 4:3-5"'),
	why: z.string().describe("What this verse shows here, at most 12 words"),
});

const questionSchema = z.object({
	lead: z
		.string()
		.nullable()
		.describe("Null, or one short sentence of setting from the text that the question needs (no interpretation, no answer)"),
	text: z.string().describe("Exactly one question about one thing, one sentence, at most 25 words, pointing to a verse"),
	focusVerses: z.array(z.number().int()).max(4).describe("Verse numbers in the studied passage the question points to"),
	contextVerses: z.array(citationSchema).max(2).describe("Verses outside the studied passage that the question asks about, or empty"),
});

const openSchema = z.object({
	topics: z.array(z.string()).min(1).max(3).describe("1 to 3 short lowercase labels for what the passage is about, like justification"),
	question: questionSchema,
});

const answerSchema = z.object({
	verdict: z.enum(["affirm", "partly", "correct", "unclear"]),
	response: z.string().describe("At most three short sentences to the learner about their answer, before the next question"),
	citations: z.array(citationSchema).max(3).describe("The verses your response points to: what supports or corrects their answer"),
	levelSignal: z.enum(["easier", "same", "deeper"]),
	next: questionSchema,
});

const hintSchema = z.object({
	hint: z.string().describe("One or two short sentences: a nudge, never the answer"),
	citations: z.array(citationSchema).max(1),
});

const readingSchema = z.object({
	reading: z.string().describe("Your reading of the passage, 3 to 6 sentences, plain prose"),
	forVerses: z.array(citationSchema).min(1).max(4),
	againstVerses: z.array(citationSchema).max(3),
});

const checkSchema = z.object({
	verdict: z.enum(["supported", "partly", "corrected"]),
	summary: z.string().describe("2 to 4 sentences to the learner about their conclusion"),
	supports: z.array(citationSchema).max(4),
	corrects: z.array(citationSchema).max(3),
	context: z.array(citationSchema).max(3),
	takeaways: z.array(z.string()).min(2).max(4),
	topics: z.array(z.string()).max(3),
});

const summarySchema = z.object({
	takeaways: z.array(z.string()).min(2).max(5),
});

const TUTOR_ROLE = `YOU ARE THE SOCRATIC TUTOR. A believer has opened a passage of their King James Bible to learn to read it closely for themselves. Your work is to ask before you tell. You guide them one question at a time, so that they see what the text says, understand what it means in its setting, and carry it into their life, and so that they learn to interpret Scripture thoughtfully instead of depending on an AI's answers.

HOW YOU TEACH:
- One question at a time, and only one. Never two questions in one message, never a list of questions.
- Move in order. Observation: what the text says (who speaks and to whom, what happens, which words are used, what is repeated, the connecting words: therefore, for, but, if, so). Interpretation: what it means in its setting (why the author says this here, how the chapter before shapes it, how a cross-reference confirms or sharpens it, what a key word means in this context). Application: what this truth asks of a believer, or what it means for how they trust, pray, and live today.
- Ask about one thing per question: never join two asks with "and" ("what do we have, and through whom?" is two questions). Write questions in plain modern English; when you use the verse's own words, put them in quotation marks ("what does tribulation \u201cwork\u201d, according to verse 3?"). Point to the verse every time ("Look at verse 4", "In verse 8, what does God commend?"). Questions are short: one sentence, at most about 25 words.
- When a question asks about a verse outside the studied passage (the chapter before, a cross-reference), list that verse in contextVerses so the learner can read it.
- Ask what the text and the context shown to you can answer. Never a trick question, never a question whose answer is a matter of taste when the text is plain.
- Speak to the learner as "you", warmly and plainly, like a patient teacher sitting beside them. No flattery, no "Great question", no exclamation marks.

RESPONDING TO AN ANSWER:
- Judge the answer to the question you asked. True observations beyond the question never lower the verdict; affirm them briefly.
- Affirm specifically what the text supports, naming the verse and its words ("Yes: verse 1 says we have peace with God, and verse 2 adds access into grace").
- If it is partly right, affirm the true part and point to the verse that completes it.
- If it is wrong, or reads into the text what it does not say, correct it gently ("Not quite", "Look again at verse 2") and clearly: say which part of their answer the verse does not say, and cite the verse that corrects it. Never pretend a wrong answer is right, never shame. Do not then spell out the right answer yourself: the cited verse is shown to them, so your next question asks them to read that verse again for the part they missed. That question must never be the same question in other words, and never one whose answer you have just given.
- If it is empty, off the point, or a question back to you, answer a simple factual question in one sentence (what a word means, who is speaking) and return to the question.
- Never lecture, and never ask anything in your response: the next question is the only question. At most three short sentences.
- A citation's note says what to notice in the verse. When the answer was wrong or unclear, the note points to where to look and never states the answer.
- Never give your own reading of the passage unless the learner asks for it; that is a separate request. Your work is to help them reach and test their own.

FAITHFULNESS:
- Be firm where the text is clear. If an answer contradicts the plain words of Scripture, say so plainly, with the verse. Keep what the text says apart from interpretation.
- Cite only verses shown to you below, by their bracketed label ("Romans 5:8") or a short range ("Romans 4:3-5"). The app shows the KJV text of every verse you cite beside your words, so refer to verses; do not quote them from memory.
- Plain text only: no markdown, no bullet characters, no dashes as punctuation (use commas, colons or full stops).`;

const LEVEL_BRIEF: Record<TutorLevel, string> = {
	beginner:
		"LEVEL: BEGINNER. The learner may be new to reading the Bible closely. Ask about what is plainly on the page: who is speaking and to whom, what happens, what a key phrase says. Use everyday words and explain any church word you use in a few words. Interpretation questions stay close to one verse (\"Why do you think verse 1 begins with therefore?\"). Be generous with encouragement for what is right.",
	growing:
		"LEVEL: GROWING. The learner knows the Bible's outline. Ask them to trace the argument: the connecting words, how one verse answers another, what the passage reveals about God, about Christ, about sin and salvation, and how the chapter before sets it up.",
	deep:
		"LEVEL: DEEP STUDY. The learner wants to read like a careful student of Scripture. Ask about the flow of the argument across the whole passage, how the chapter before changes the interpretation, how the cross-references shown confirm or sharpen a reading, how the author uses key terms (justified, faith, works, world, grace) in this context, and what the passage does not say. Expect evidence: ask what in the text supports their answer.",
};

function instructionsFor(level: TutorLevel, task: string): string {
	return `${doctrinalFoundation}\n\n${interpretationGuidance}\n\n${TUTOR_ROLE}\n\n${LEVEL_BRIEF[level]}\n\n${task}`;
}

/** What each stage's question asks, so the question written fits the stage it is filed under. */
const STAGE_ASK: Record<TutorStage, string> = {
	observation: "an observation question: what the text says",
	interpretation: "an interpretation question: what it means in its setting",
	application:
		"an application question: what this truth asks of them, or means for how they trust, pray or live today (not another question about what the text says)",
	conclusion:
		"the conclusion question: ask them to put what this passage teaches into a sentence or two of their own, saying you will check it against the text",
};

async function callModel<SCHEMA extends z.ZodType>(
	resolved: ResolvedModel,
	schema: SCHEMA,
	instructions: string,
	prompt: string,
): Promise<z.infer<SCHEMA>> {
	let output: z.infer<SCHEMA> | undefined;
	try {
		const result = await generateText({
			model: resolved.model,
			providerOptions: resolved.providerOptions,
			output: Output.object({ schema }),
			instructions,
			prompt,
			abortSignal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
		});
		output = result.output as z.infer<SCHEMA> | undefined;
	} catch (error) {
		if (error instanceof Response) throw error;
		console.error("tutor generation failed:", error instanceof Error ? error.message : error);
		throw new TutorUnavailableError("The tutor could not answer just now.");
	}
	if (!output) throw new TutorUnavailableError("The model returned nothing.");
	return output;
}

/** The house model at low effort, structured, like Quiz me: a tutor's turn should come back in seconds. */
export function resolveTutorModel(userId: string): Promise<ResolvedModel> {
	return resolveModel({ userId, effort: "low", structured: true });
}

function promptFor(grounding: Grounding, turns: readonly TutorTurn[], tail: string): string {
	return [grounding.prompt, `THE SESSION SO FAR:\n${turns.length ? transcriptForModel(turns) : "(not started)"}`, tail].join("\n\n");
}

function focusWithin(passage: TutorPassage, verses: readonly number[]): number[] {
	return [...new Set(verses.filter((verse) => Number.isInteger(verse) && verse >= passage.start && verse <= passage.end))].slice(0, 4);
}

function questionTurn(raw: z.infer<typeof questionSchema>, stage: TutorStage, grounding: Grounding, at: string): TutorTurn {
	const text = oneQuestion(raw.text);
	if (!text) throw new TutorUnavailableError("The model wrote an empty question.");
	const lead = raw.lead ? plain(raw.lead) : "";
	// Only verses beyond the passage: the passage itself is already on screen.
	const context = resolveCitations(raw.contextVerses, grounding, 2).filter((citation) => citation.source !== "passage");
	return {
		id: newId(),
		at,
		role: "tutor",
		kind: "question",
		stage,
		text,
		lead: lead && !lead.includes("?") ? lead : null,
		focus: focusWithin(grounding.passage, raw.focusVerses),
		...(context.length ? { context } : {}),
	};
}

function cleanTopics(topics: readonly string[]): string[] {
	return topics
		.map((topic) => topic.trim().toLowerCase().replace(/\s+/g, " "))
		.filter((topic) => topic.length > 0 && topic.length <= 60);
}

/* -------------------------------------------------------------------------
 * Sessions in the study store
 * ---------------------------------------------------------------------- */

export interface LoadedSession {
	item: BetaItem;
	data: TutorSessionData;
}

/** The founder's tutor session, or null for a missing, foreign or other module's id. */
export async function loadSession(userId: string, id: string): Promise<LoadedSession | null> {
	const item = await getBetaItem(userId, id);
	if (!item || item.module !== TUTOR_MODULE || item.kind !== TUTOR_SESSION_KIND) return null;
	const data = parseSessionData(item.data);
	return data ? { item, data } : null;
}

export async function viewOf(loaded: LoadedSession): Promise<TutorSessionView> {
	const { item, data } = loaded;
	return sessionView(
		{ id: item.id, title: item.title, createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() },
		data,
		await passageVerses(data.passage),
	);
}

export async function listSessions(userId: string): Promise<TutorSessionSummary[]> {
	const items = await listBetaItems(userId, { module: TUTOR_MODULE, kind: TUTOR_SESSION_KIND, parentId: null, take: 60 });
	return items.flatMap((item) => {
		const data = parseSessionData(item.data);
		return data ? [summarizeSession(item.id, item.title, item.updatedAt.toISOString(), data)] : [];
	});
}

function citationKeys(turns: readonly TutorTurn[]): string[] {
	const keys: string[] = [];
	for (const turn of turns) {
		if (turn.role !== "tutor") continue;
		const lists =
			turn.kind === "question"
				? [turn.context ?? []]
				: turn.kind === "feedback" || turn.kind === "hint"
				? [turn.citations]
				: turn.kind === "reading"
					? [turn.forVerses, turn.againstVerses]
					: turn.kind === "check"
						? [turn.supports, turn.corrects, turn.context]
						: [];
		for (const list of lists) for (const citation of list) keys.push(...citation.keys);
	}
	return keys;
}

/** The store's refs: the studied verses first, then every verse the session cited. */
function sessionRefs(data: TutorSessionData): string[] {
	const passage = passageRefKeys(data.passage);
	const cited = citationKeys(data.turns).filter((k) => !passage.includes(k));
	return [...new Set([...passage, ...cited])].slice(0, REFS_MAX);
}

/**
 * Write a session over the version read at `since`. "conflict" when another
 * request wrote it in between (the write is a compare-and-set in the store),
 * null when it no longer exists.
 */
async function persist(
	userId: string,
	id: string,
	data: TutorSessionData,
	topics: readonly string[],
	since: Date,
): Promise<LoadedSession | "conflict" | null> {
	const item = await updateBetaItem(
		userId,
		id,
		{
			data: data as unknown as Record<string, unknown>,
			body: sessionBody(data),
			refs: sessionRefs(data),
			topics: [...new Set(topics)].slice(0, TOPICS_MAX),
		},
		{ ifUpdatedAt: since },
	);
	if (item) return { item, data };
	return (await getBetaItem(userId, id)) ? "conflict" : null;
}

/** Start a session on a passage: the tutor reads it and asks its first question. */
export async function startSession(userId: string, passage: TutorPassage, level: TutorLevel): Promise<LoadedSession> {
	const resolved = await resolveTutorModel(userId);
	const grounding = await buildGrounding(passage, null);
	const output = await callModel(
		resolved,
		openSchema,
		instructionsFor(
			level,
			"TASK: Open the session. Ask the first observation question on the passage, usually about its first verse or its main statement. Give 1 to 3 topic labels for what the passage is about. The lead may set the scene in one sentence from the text when the passage starts mid-story; otherwise null.",
		),
		promptFor(grounding, [], "Write the opening question now."),
	);
	const data = newSessionData(passage, level);
	data.turns.push(questionTurn(output.question, "observation", grounding, new Date().toISOString()));
	const item = await createBetaItem(userId, {
		module: TUTOR_MODULE,
		kind: TUTOR_SESSION_KIND,
		title: sessionTitle(passage),
		body: sessionBody(data),
		data: data as unknown as Record<string, unknown>,
		refs: sessionRefs(data),
		topics: cleanTopics(output.topics).slice(0, 3),
	});
	return { item, data };
}

export type TurnOutcome =
	| { ok: true; session: LoadedSession }
	| { ok: false; status: 404 | 409; error: string };

/** One founder action on a session: an answer, a hint, the tutor's reading, or a conclusion check. */
export async function takeTurn(userId: string, id: string, input: TutorActionInput): Promise<TurnOutcome> {
	const loaded = await loadSession(userId, id);
	if (!loaded) return { ok: false, status: 404, error: "not_found" };
	const { data, item } = loaded;
	if (input.expect !== data.turns.length) return { ok: false, status: 409, error: "stale" };
	if (data.turns.length >= TUTOR_TURNS_MAX || new TextEncoder().encode(JSON.stringify(data)).length > BETA_DATA_MAX_BYTES - DATA_HEADROOM_BYTES) {
		return { ok: false, status: 409, error: "session_full" };
	}
	const action = effectiveAction(input.action, data.turns);
	const open = openQuestion(data.turns);
	const hintStep = nextHintStep(data.turns);
	if (action === "hint" && (!open || open.stage === "conclusion" || hintStep === null || latestCheckAfterOpen(data))) {
		return { ok: false, status: 409, error: "no_hint" };
	}

	const resolved = await resolveTutorModel(userId);
	const searchFor = action === "answer" || action === "conclude" ? input.text : null;
	const grounding = await buildGrounding(data.passage, searchFor);
	const at = new Date().toISOString();
	const added: TutorTurn[] = [];
	let level = data.level;
	let answersSinceLevelChange = data.answersSinceLevelChange;
	let finished = data.finished;
	let topics = item.topics;

	if (action === "answer" && open) {
		const options = nextStageOptions(data.turns, data.level);
		const output = await callModel(
			resolved,
			answerSchema,
			instructionsFor(
				data.level,
				`TASK: The learner has just answered your last question (the ${open.stage} question at the end of THE SESSION SO FAR); their answer is below. Judge it against the text and respond, then ask the next question.
- verdict: affirm (the text supports it), partly (part is right, part missing or beyond the text), correct (wrong, or reads into the text what it does not say), unclear (empty, off the point, or a question back to you).
- citations: the verses your response points to, at most three.
- next: if your verdict is affirm or partly, ask ${STAGE_ASK[options.ifCredited]}; if it is correct or unclear, ask ${options.ifNot === open.stage ? `a narrower ${open.stage} question that helps them look again at the verse` : STAGE_ASK[options.ifNot]}. Do not repeat a question already asked.
- levelSignal: deeper if the answer read the text closely beyond what was asked, easier if they are struggling with what the text plainly says, otherwise same.`,
			),
			promptFor(grounding, data.turns, `THE LEARNER'S ANSWER:\n${input.text}`),
		);
		const verdict = output.verdict;
		const response = withoutQuestions(plain(output.response));
		if (!response) throw new TutorUnavailableError("The model wrote an empty response.");
		added.push({ id: newId(), at, role: "you", kind: "answer", text: input.text });
		added.push({ id: newId(), at, role: "tutor", kind: "feedback", verdict, text: response, citations: resolveCitations(output.citations, grounding, 3) });
		answersSinceLevelChange += 1;
		const hints = hintsPerQuestion(data.turns);
		const adapted = adaptLevel({
			level,
			answersSinceLevelChange,
			verdicts: [...answerVerdicts(data.turns), verdict],
			hintsUsed: hints.at(-1) ?? 0,
			hintsBefore: hints.at(-2) ?? 0,
			signal: output.levelSignal,
		});
		if (adapted !== level) {
			added.push({ id: newId(), at, role: "tutor", kind: "level", from: level, to: adapted, by: "tutor", text: levelChangeText(level, adapted, "tutor") });
			level = adapted;
			answersSinceLevelChange = 0;
		}
		const stage = settleNextStage(verdict, options);
		added.push(questionTurn(output.next, stage, grounding, at));
	} else if (action === "hint" && open && hintStep !== null) {
		const output = await callModel(
			resolved,
			hintSchema,
			instructionsFor(
				data.level,
				`TASK: The learner is stuck on your last question and asked for a hint. This is hint ${hintStep} of 3. Give one short nudge, never the answer, never a lecture.
- Hint 1: point them to the verse, and to where in it to look.
- Hint 2: point to the exact words or connecting word that hold the answer.
- Hint 3: give them a sentence to finish, with a blank, built from the verse's own words.
Do not repeat an earlier hint. Cite at most the one verse you point to.`,
			),
			promptFor(grounding, data.turns, `The learner asked for hint ${hintStep}.`),
		);
		const hint = plain(output.hint);
		if (!hint) throw new TutorUnavailableError("The model wrote an empty hint.");
		added.push({ id: newId(), at, role: "you", kind: "hint", text: "" });
		added.push({ id: newId(), at, role: "tutor", kind: "hint", step: hintStep, text: hint, citations: resolveCitations(output.citations, grounding, 1) });
	} else if (action === "reading") {
		const output = await callModel(
			resolved,
			readingSchema,
			instructionsFor(
				data.level,
				`TASK: The learner asked for your own reading of the passage. Give it now, plainly, firm where the text is clear; it is shown to them labelled as interpretation, not Scripture.
- reading: 3 to 6 sentences on what the passage means in its setting, drawing on the chapter before where it matters.
- forVerses: 1 to 4 verses that support this reading, each with what it shows.
- againstVerses: 0 to 3 verses that a careful reader could genuinely raise against this reading, or that another reading leans on, each with how it fits beside yours (for example James 2:24 beside Romans 4:5). Leave it empty rather than force one: a verse that simply agrees with your reading never belongs here.
Ask no question of your own: the app hands them back to the question still open. Do not answer that question for them in other words; they can still answer it.`,
			),
			promptFor(grounding, data.turns, "The learner asked for your reading."),
		);
		const reading = plain(output.reading);
		if (!reading) throw new TutorUnavailableError("The model wrote an empty reading.");
		// One question at a time: the reading ends by handing back the question still open, never a new one.
		const stillOpen = open && !latestCheckAfterOpen(data) ? open : null;
		added.push({ id: newId(), at, role: "you", kind: "reading", text: "" });
		added.push({
			id: newId(),
			at,
			role: "tutor",
			kind: "reading",
			text: reading,
			forVerses: resolveCitations(output.forVerses, grounding, 4),
			againstVerses: resolveCitations(output.againstVerses, grounding, 3),
			consider: stillOpen ? `Back to your question: ${stillOpen.text}` : null,
		});
	} else if (action === "conclude") {
		const output = await callModel(
			resolved,
			checkSchema,
			instructionsFor(
				data.level,
				`TASK: The learner has stated their conclusion about the passage; it is below. Check it against the text.
- verdict: supported (the text says this), partly (some of it is not taught by the text, or it contradicts or misses a central point of the passage), corrected (the text says otherwise). Judge the substance against the passage as a whole: a conclusion that joins what the passage itself joins (a promise in one verse and its proof a few verses later) is supported, and so is one whose only flaw is a detail of wording. Mention such details in the summary without lowering the verdict.
- summary: 2 to 4 sentences to them: what in their conclusion the text supports, and what it corrects or completes, gently and clearly.
- supports: up to 4 verses that support what is right in it. Empty only if nothing does.
- corrects: up to 3 verses that correct or complete it. Empty when the verdict is supported.
- context: 1 to 3 verses from the wider context that bear on it, at least one from the chapter before or the cross-references, each with how it bears on it.
- takeaways: 2 to 4 short sentences of what this study shows from the text, written as the learner's own notes ("Peace with God comes through being justified by faith"), each ending with its reference in parentheses.
- topics: up to 3 short lowercase labels.`,
			),
			promptFor(grounding, data.turns, `THE LEARNER'S CONCLUSION:\n${input.text}`),
		);
		const summary = plain(output.summary);
		if (!summary) throw new TutorUnavailableError("The model wrote an empty check.");
		added.push({ id: newId(), at, role: "you", kind: "conclusion", text: input.text });
		added.push({
			id: newId(),
			at,
			role: "tutor",
			kind: "check",
			verdict: output.verdict,
			text: summary,
			supports: resolveCitations(output.supports, grounding, 4),
			corrects: resolveCitations(output.corrects, grounding, 3),
			context: resolveCitations(output.context, grounding, 3).filter(
				(citation) => ![...output.supports, ...output.corrects].some((other) => resolveCitation(other, grounding)?.reference === citation.reference),
			),
			takeaways: output.takeaways.map(plain).filter(Boolean).slice(0, 4),
		});
		finished = true;
		topics = [...topics, ...cleanTopics(output.topics)];
	} else {
		return { ok: false, status: 409, error: "no_question" };
	}

	// The model call took seconds: the write only lands over the version this turn was
	// written against, so a doubled send or a turn from another window is refused, not lost.
	const next: TutorSessionData = { ...data, level, answersSinceLevelChange, finished, pausedAt: null, turns: [...data.turns, ...added] };
	const saved = await persist(userId, id, next, topics, item.updatedAt);
	if (saved === "conflict") return { ok: false, status: 409, error: "stale" };
	return saved ? { ok: true, session: saved } : { ok: false, status: 404, error: "not_found" };
}

function latestCheckAfterOpen(data: TutorSessionData): boolean {
	const open = openQuestion(data.turns);
	const check = latestCheck(data.turns);
	return Boolean(open && check && data.turns.indexOf(check) > data.turns.indexOf(open));
}

/** Change the level (the founder's own choice) or mark the session paused. */
export async function changeSession(
	userId: string,
	id: string,
	patch: { level?: TutorLevel; paused?: boolean },
): Promise<LoadedSession | "conflict" | null> {
	const loaded = await loadSession(userId, id);
	if (!loaded) return null;
	const next: TutorSessionData = { ...loaded.data, turns: [...loaded.data.turns] };
	if (patch.level && patch.level !== next.level) {
		next.turns.push({
			id: newId(),
			at: new Date().toISOString(),
			role: "tutor",
			kind: "level",
			from: next.level,
			to: patch.level,
			by: "you",
			text: levelChangeText(next.level, patch.level, "you"),
		});
		next.level = patch.level;
		next.answersSinceLevelChange = 0;
	}
	if (patch.paused !== undefined) next.pausedAt = patch.paused ? new Date().toISOString() : null;
	return persist(userId, id, next, loaded.item.topics, loaded.item.updatedAt);
}

export function removeSession(userId: string, id: string): Promise<boolean> {
	return loadSession(userId, id).then((loaded) => (loaded ? deleteBetaItem(userId, id) : false));
}

const DATE_LABEL = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" });

export type NoteOutcome =
	| { ok: true; noteId: string; noteTitle: string; created: boolean; session: LoadedSession }
	| { ok: false; status: 404 | 409; error: string };

/**
 * Save the session, and what was learned, as a note in Notes. The first save
 * writes the whole study; a later one appends what happened since. What was
 * learned is the latest conclusion check's takeaways, or (with no check yet)
 * a short summary the tutor writes from the founder's own answers.
 */
export async function saveSessionNote(userId: string, id: string): Promise<NoteOutcome> {
	const loaded = await loadSession(userId, id);
	if (!loaded) return { ok: false, status: 404, error: "not_found" };
	const { data } = loaded;
	const answered = data.turns.some((turn) => turn.role === "you" && (turn.kind === "answer" || turn.kind === "conclusion"));
	if (!answered) return { ok: false, status: 409, error: "nothing_to_save" };
	if (data.noteId && data.noteTurns >= data.turns.length) {
		return { ok: true, noteId: data.noteId, noteTitle: loaded.item.title, created: false, session: loaded };
	}

	const verses = await passageVerses(data.passage);
	const dateLabel = DATE_LABEL.format(new Date());
	const write = async (fromTurn: number, noteId: string | undefined) => {
		const fresh = data.turns.slice(fromTurn);
		const takeaways = latestCheck(fresh)?.takeaways ?? (await summaryTakeaways(userId, data, fresh));
		return appendMarkdownToNote({
			userId,
			markdown: sessionNoteMarkdown({ data, verses, takeaways, dateLabel, fromTurn }),
			noteId,
			title: sessionTitle(data.passage),
			maxLength: 60_000,
		});
	};
	let result;
	try {
		result = await write(data.noteId ? data.noteTurns : 0, data.noteId ?? undefined);
	} catch (error) {
		// The note was deleted in Notes since the last save: write the whole study into a new one.
		if (!(error instanceof Error && error.message === "Note not found.") || !data.noteId) throw error;
		result = await write(0, undefined);
	}
	// The note now holds these turns, so record that even if a turn landed while it was written:
	// otherwise the next save would append them twice.
	let current: LoadedSession | null = loaded;
	for (let attempt = 0; current && attempt < 3; attempt++) {
		const saved = await persist(userId, id, { ...current.data, noteId: result.noteId, noteTurns: Math.max(current.data.noteTurns, data.turns.length) }, current.item.topics, current.item.updatedAt);
		if (saved === null) break;
		if (saved !== "conflict") return { ok: true, noteId: result.noteId, noteTitle: result.noteTitle, created: result.created, session: saved };
		current = await loadSession(userId, id);
	}
	return { ok: false, status: current ? 409 : 404, error: current ? "stale" : "not_found" };
}

/** What was learned, when no conclusion has been checked: 2 to 5 lines from the founder's own answers. */
async function summaryTakeaways(userId: string, data: TutorSessionData, turns: readonly TutorTurn[]): Promise<string[]> {
	if (!turns.some((turn) => turn.role === "you" && turn.kind === "answer")) return [];
	const resolved = await resolveTutorModel(userId);
	const grounding = await buildGrounding(data.passage, null);
	const output = await callModel(
		resolved,
		summarySchema,
		instructionsFor(
			data.level,
			"TASK: The learner is saving this study to their notes. Write 2 to 5 short takeaways of what they learned from the text in this session, as their own notes (\"Peace with God comes through being justified by faith\"), each ending with its reference in parentheses. Only what the text and the session established; where an answer was corrected, record the corrected truth, never the mistake.",
		),
		promptFor(grounding, turns, "Write the takeaways now."),
	);
	return output.takeaways.map(plain).filter(Boolean).slice(0, 5);
}


import "server-only";

import { bookByOrder, resolveReference } from "@/lib/bible/books";
import { getChapter, type TranslationId } from "@/lib/bible/translations";
import { createBetaItem, deleteBetaItem, listBetaItems } from "@/lib/beta/store";
import { betaRefKey } from "@/lib/beta/store-rules";
import { addCard, formatLearnReference, learnTimezone, learnVerseText, type LearnSource } from "@/lib/learn";
import { startOfTomorrow } from "@/lib/learn-schedule";
import { describeWhen, toolVerseReferences } from "@/lib/learn-suggestions";
import { DEFAULT_TRANSLATION, TRANSLATION_IDS } from "@/lib/preferences-contract";
import { prisma } from "@/lib/prisma";
import type { QuizQuestion } from "@/lib/quiz-contract";
import { parseVerseReferences } from "@/utils/verseParser";
import { BETA_MODULES } from "@/lib/beta/modules";
import {
	MEMORY_PASSAGE_MAX_VERSES,
	MEMORY_SESSION_LIMIT,
	cardStatus,
	choicePool,
	groupConsecutiveVerses,
	isCardDue,
	joinRanges,
	parseVerseSpan,
	planCandidates,
	planUnits,
	rangeKey,
	rangeLength,
	rangeReference,
	rangesOverlap,
	unitStage,
	type MemoryCardState,
	type MemoryPassageRecord,
	type MemorySignal,
	type MemorySource,
	type MemoryStatus,
	type PassageRange,
} from "@/lib/beta/memory/memory-rules";

/**
 * Scripture Memory's server half (LC-17651, docs/beta/memory.md).
 *
 * The deck is Learn a verse's `VerseMemory`: this module reads it, adds to it
 * only through Learn a verse's `addCard`, and never writes a schedule (reviews
 * go from the browser to `/api/learn/[id]/review`, the same route the Learn a
 * verse screen uses). What it keeps of its own lives in the beta study store:
 * `passage` items group verses learned together (Ephesians 2:8-9), and
 * `questions` items hold the comprehension questions a founder asked for.
 */

export const MEMORY_MODULE = "memory";

export class MemoryInputError extends Error {
	status: number;
	constructor(message: string, status = 400) {
		super(message);
		this.status = status;
	}
}

/** One Learn a verse card, as this module reads it. */
export interface MemoryCardRow extends MemoryCardState {
	translation: TranslationId;
	createdAt: string;
}

function toTranslation(value: string | null | undefined): TranslationId {
	return (TRANSLATION_IDS as readonly string[]).includes(value ?? "") ? (value as TranslationId) : DEFAULT_TRANSLATION;
}

function bookName(book: number): string {
	return bookByOrder(book)?.name ?? String(book);
}

/** The founder's whole deck, oldest first. Read only. */
async function loadCards(userId: string): Promise<MemoryCardRow[]> {
	const rows = await prisma.verseMemory.findMany({
		where: { userId },
		orderBy: [{ createdAt: "asc" }, { id: "asc" }],
		select: {
			id: true,
			revision: true,
			book: true,
			chapter: true,
			verse: true,
			translation: true,
			stage: true,
			intervalDays: true,
			dueAt: true,
			knownAt: true,
			createdAt: true,
		},
	});
	return rows.map((row) => ({
		...row,
		translation: toTranslation(row.translation),
		dueAt: row.dueAt.toISOString(),
		knownAt: row.knownAt ? row.knownAt.toISOString() : null,
		createdAt: row.createdAt.toISOString(),
	}));
}

function readRange(data: unknown): PassageRange | null {
	if (typeof data !== "object" || data === null) return null;
	const { book, chapter, start, end } = data as Record<string, unknown>;
	const ints = [book, chapter, start, end];
	if (!ints.every((value) => typeof value === "number" && Number.isInteger(value) && value >= 1)) return null;
	const range = { book, chapter, start, end } as PassageRange;
	if (range.book > 66 || range.end < range.start || rangeLength(range) > MEMORY_PASSAGE_MAX_VERSES) return null;
	return range;
}

async function loadPassages(userId: string): Promise<MemoryPassageRecord[]> {
	const items = await listBetaItems(userId, { module: MEMORY_MODULE, kind: "passage", take: 500 });
	return items.flatMap((item) => {
		const range = readRange(item.data);
		return range ? [{ id: item.id, ...range }] : [];
	});
}

/** Verse keys for the store ("49.2.8"), which also index the chapter. */
function rangeRefs(range: PassageRange): string[] {
	const refs: string[] = [];
	for (let verse = range.start; verse <= range.end; verse += 1) refs.push(betaRefKey(range.book, range.chapter, verse));
	return refs;
}

/* ------------------------------------------------------------------------ */
/* Overview: known, learning and due, by book and by verse                    */
/* ------------------------------------------------------------------------ */

export interface MemoryVerseView {
	id: string;
	verse: number;
	stage: number;
	intervalDays: number;
	dueAt: string;
	knownAt: string | null;
	status: MemoryStatus;
}

export interface MemoryUnitView {
	key: string;
	reference: string;
	chapter: number;
	start: number;
	end: number;
	passage: boolean;
	translation: TranslationId;
	/** Comprehension questions written for it in that translation. */
	questions: number;
	/** The unit's status: due if any verse is, then learning if any verse is, else known. */
	status: MemoryStatus;
	stage: number;
	/** The soonest date any of its verses comes back. */
	nextDueAt: string;
	verses: MemoryVerseView[];
}

export interface MemoryBookView {
	book: number;
	name: string;
	verses: number;
	due: number;
	known: number;
	learning: number;
	units: MemoryUnitView[];
}

export interface MemoryOverview {
	counts: { verses: number; due: number; known: number; learning: number };
	/** Due units, which is what a session counts. */
	dueUnits: number;
	/** The next time anything comes back, when nothing is due now. */
	nextDueAt: string | null;
	books: MemoryBookView[];
}

export async function memoryOverview(userId: string, now: Date = new Date()): Promise<MemoryOverview> {
	const [cards, passages, timezone, questionItems] = await Promise.all([
		loadCards(userId),
		loadPassages(userId),
		learnTimezone(userId),
		loadQuestions(userId),
	]);
	const dueBefore = startOfTomorrow(now, timezone).getTime();
	const questions = new Map(questionItems.map((item) => [questionsKey(item, item.translation), item.questions.length]));
	const books = new Map<number, MemoryBookView>();
	let dueUnits = 0;
	for (const unit of planUnits(cards, passages)) {
		const verses: MemoryVerseView[] = unit.cards.map((card) => ({
			id: card.id,
			verse: card.verse,
			stage: card.stage,
			intervalDays: card.intervalDays,
			dueAt: card.dueAt,
			knownAt: card.knownAt,
			status: cardStatus(card, dueBefore),
		}));
		const status: MemoryStatus = verses.some((verse) => verse.status === "due")
			? "due"
			: verses.some((verse) => verse.status === "learning")
				? "learning"
				: "known";
		if (status === "due") dueUnits += 1;
		const view: MemoryUnitView = {
			key: rangeKey(unit.range),
			reference: rangeReference(bookName(unit.range.book), unit.range),
			chapter: unit.range.chapter,
			start: unit.range.start,
			end: unit.range.end,
			passage: unit.cards.length > 1,
			translation: unit.cards[0].translation,
			questions: questions.get(questionsKey(unit.range, unit.cards[0].translation)) ?? 0,
			status,
			stage: unitStage(unit.cards),
			nextDueAt: unit.cards.map((card) => card.dueAt).sort()[0],
			verses,
		};
		const book = books.get(unit.range.book) ?? {
			book: unit.range.book,
			name: bookName(unit.range.book),
			verses: 0,
			due: 0,
			known: 0,
			learning: 0,
			units: [],
		};
		book.units.push(view);
		book.verses += verses.length;
		book.due += verses.filter((verse) => verse.status === "due").length;
		book.known += unit.cards.filter((card) => card.knownAt).length;
		book.learning += unit.cards.filter((card) => !card.knownAt).length;
		books.set(unit.range.book, book);
	}
	const future = cards.map((card) => card.dueAt).filter((dueAt) => Date.parse(dueAt) >= dueBefore).sort();
	const due = cards.filter((card) => isCardDue(card, dueBefore)).length;
	const known = cards.filter((card) => card.knownAt).length;
	return {
		counts: { verses: cards.length, due, known, learning: cards.length - known },
		dueUnits,
		nextDueAt: due === 0 ? (future[0] ?? null) : null,
		books: [...books.values()].sort((a, b) => a.book - b.book),
	};
}

/* ------------------------------------------------------------------------ */
/* The review session                                                         */
/* ------------------------------------------------------------------------ */

export interface MemorySessionCard {
	id: string;
	revision: number;
	verse: number;
	translation: TranslationId;
	stage: number;
	intervalDays: number;
	dueAt: string;
	knownAt: string | null;
	text: string;
	/** Reviewed by this unit: only due verses are, so an early look never moves a schedule. */
	due: boolean;
}

export interface MemorySessionUnit {
	key: string;
	reference: string;
	book: number;
	chapter: number;
	start: number;
	end: number;
	translation: TranslationId;
	cards: MemorySessionCard[];
	/** Chapter words for multiple choice's wrong answers. */
	pool: string[];
	/** Comprehension questions the founder asked for, in this translation, or null. */
	questions: QuizQuestion[] | null;
}

export interface MemorySession {
	/** Every due unit; `units` is the head of them. */
	dueUnits: number;
	units: MemorySessionUnit[];
}

/** A chapter as plain words, for the distractor pool only. */
async function chapterWords(translation: TranslationId, book: number, chapter: number): Promise<string[]> {
	try {
		const verses = await getChapter(translation, book, chapter);
		return verses.map((verse) => verse.replace(/<[^>]*>/g, " ").replace(/&[#\w]+;/g, " "));
	} catch {
		return [];
	}
}

interface QuestionsRecord extends PassageRange {
	id: string;
	translation: TranslationId;
	questions: QuizQuestion[];
}

function readQuestions(item: { id: string; data: unknown }): QuestionsRecord | null {
	const range = readRange(item.data);
	const data = item.data as { translation?: unknown; questions?: unknown };
	if (!range || typeof data.translation !== "string" || !Array.isArray(data.questions)) return null;
	const questions = data.questions.filter(
		(question): question is QuizQuestion =>
			typeof question === "object" &&
			question !== null &&
			typeof (question as QuizQuestion).prompt === "string" &&
			Array.isArray((question as QuizQuestion).options) &&
			(question as QuizQuestion).options.length === 4 &&
			Number.isInteger((question as QuizQuestion).answerIndex),
	);
	if (questions.length === 0) return null;
	return { id: item.id, ...range, translation: toTranslation(data.translation), questions };
}

async function loadQuestions(userId: string): Promise<QuestionsRecord[]> {
	const items = await listBetaItems(userId, { module: MEMORY_MODULE, kind: "questions", take: 500 });
	return items.flatMap((item) => {
		const record = readQuestions(item);
		return record ? [record] : [];
	});
}

function questionsKey(range: PassageRange, translation: TranslationId): string {
	return `${rangeKey(range)}:${translation}`;
}

/**
 * Today's session: due units, the longest-waiting first and then the newest,
 * as Learn a verse orders its own queue, at most MEMORY_SESSION_LIMIT.
 */
export async function memorySession(userId: string, now: Date = new Date()): Promise<MemorySession> {
	const [cards, passages, timezone, questionItems] = await Promise.all([
		loadCards(userId),
		loadPassages(userId),
		learnTimezone(userId),
		loadQuestions(userId),
	]);
	const dueBefore = startOfTomorrow(now, timezone).getTime();
	const due = planUnits(cards, passages)
		.map((unit) => ({ unit, dueCards: unit.cards.filter((card) => isCardDue(card, dueBefore)) }))
		.filter(({ dueCards }) => dueCards.length > 0)
		.sort((a, b) => {
			const oldest = (cards: MemoryCardRow[]) => cards.map((card) => card.dueAt).sort()[0];
			const newest = (cards: MemoryCardRow[]) => cards.map((card) => card.createdAt).sort().at(-1) ?? "";
			return oldest(a.dueCards).localeCompare(oldest(b.dueCards)) || newest(b.unit.cards).localeCompare(newest(a.unit.cards));
		});
	const questions = new Map(questionItems.map((item) => [questionsKey(item, item.translation), item.questions]));

	const units = await Promise.all(
		due.slice(0, MEMORY_SESSION_LIMIT).map(async ({ unit }): Promise<MemorySessionUnit | null> => {
			const translation = unit.cards[0].translation;
			const sessionCards = await Promise.all(
				unit.cards.map(async (card) => ({
					id: card.id,
					revision: card.revision,
					verse: card.verse,
					translation: card.translation,
					stage: card.stage,
					intervalDays: card.intervalDays,
					dueAt: card.dueAt,
					knownAt: card.knownAt,
					text: (await learnVerseText(card.translation, card.book, card.chapter, card.verse)) ?? "",
					due: isCardDue(card, dueBefore),
				})),
			);
			// A verse whose text cannot be resolved cannot be practised; Learn a verse shows its own notice for it.
			if (sessionCards.some((card) => !card.text.trim())) return null;
			return {
				key: rangeKey(unit.range),
				reference: rangeReference(bookName(unit.range.book), unit.range),
				...unit.range,
				translation,
				cards: sessionCards,
				pool: choicePool(await chapterWords(translation, unit.range.book, unit.range.chapter)),
				questions: questions.get(questionsKey(unit.range, translation)) ?? null,
			};
		}),
	);
	return { dueUnits: due.length, units: units.filter((unit): unit is MemorySessionUnit => unit !== null) };
}

/* ------------------------------------------------------------------------ */
/* Adding cards                                                               */
/* ------------------------------------------------------------------------ */

/** A reference typed by the founder, as a memory passage, or a reason it is not one. */
export function rangeFromReference(reference: string): PassageRange {
	const resolved = resolveReference(reference.trim());
	if (!resolved || resolved.verse === undefined) {
		throw new MemoryInputError("Type a verse or a passage, such as John 3:16 or Ephesians 2:8-9.");
	}
	const span = parseVerseSpan(reference);
	if (!span || span.start !== resolved.verse) {
		throw new MemoryInputError(`A memory card is one verse or up to ${MEMORY_PASSAGE_MAX_VERSES} verses of one chapter.`);
	}
	return { book: resolved.order, chapter: resolved.chapter, start: span.start, end: span.end };
}

async function founderTranslation(userId: string): Promise<TranslationId> {
	const user = await prisma.user.findUnique({ where: { id: userId }, select: { translation: true } });
	return toTranslation(user?.translation);
}

export interface MemoryPassagePreview {
	key: string;
	reference: string;
	book: number;
	chapter: number;
	start: number;
	end: number;
	translation: TranslationId;
	verses: { verse: number; text: string; inDeck: boolean }[];
}

/** The passage's verses in the founder's translation, and which are already in the deck. */
export async function previewPassage(
	userId: string,
	range: PassageRange,
	translation?: TranslationId,
): Promise<MemoryPassagePreview> {
	const [chosen, queued] = await Promise.all([
		translation ? Promise.resolve(translation) : founderTranslation(userId),
		prisma.verseMemory.findMany({
			where: { userId, book: range.book, chapter: range.chapter, verse: { gte: range.start, lte: range.end } },
			select: { verse: true },
		}),
	]);
	const inDeck = new Set(queued.map((row) => row.verse));
	const verses = [];
	for (let verse = range.start; verse <= range.end; verse += 1) {
		// Coordinates come from the KJV, as Learn a verse's own add route checks them.
		if (!(await learnVerseText("KJV", range.book, range.chapter, verse))) {
			throw new MemoryInputError(`${formatLearnReference(range.book, range.chapter, verse)} is not in the Bible.`);
		}
		const text = await learnVerseText(chosen, range.book, range.chapter, verse);
		if (!text) throw new MemoryInputError(`${chosen} text is temporarily unavailable. Please try again.`, 503);
		verses.push({ verse, text, inDeck: inDeck.has(verse) });
	}
	return {
		key: rangeKey(range),
		reference: rangeReference(bookName(range.book), range),
		...range,
		translation: chosen,
		verses,
	};
}

export interface MemoryAddResult {
	/** The unit as it now stands, joined with any passage it overlapped. */
	key: string;
	reference: string;
	range: PassageRange;
	added: number;
	alreadyInDeck: number;
}

/**
 * Add a verse or passage to Learn a verse's queue. Every verse goes through
 * `addCard`, so it is the same idempotent card the reader's "Learn this verse"
 * makes; a passage is also remembered as one unit, joined with any passage it
 * overlaps so a verse is never part of two.
 */
export async function addMemoryPassage(userId: string, range: PassageRange, source: LearnSource): Promise<MemoryAddResult> {
	const preview = await previewPassage(userId, range);
	const passages = await loadPassages(userId);
	const overlapping = passages.filter((passage) => rangesOverlap(passage, range));
	const joined = joinRanges(range, overlapping);
	if (!joined) {
		throw new MemoryInputError(
			`That overlaps ${overlapping.map((passage) => rangeReference(bookName(passage.book), passage)).join(", ")}, and together they are longer than ${MEMORY_PASSAGE_MAX_VERSES} verses.`,
			409,
		);
	}
	let added = 0;
	for (const verse of preview.verses) {
		const { created } = await addCard(userId, {
			book: range.book,
			chapter: range.chapter,
			verse: verse.verse,
			translation: preview.translation,
			source,
		});
		if (created) added += 1;
	}
	const same = overlapping.find((passage) => passage.start === joined.start && passage.end === joined.end);
	if (rangeLength(joined) > 1 && !same) {
		const texts: string[] = [];
		for (let verse = joined.start; verse <= joined.end; verse += 1) {
			texts.push((await learnVerseText(preview.translation, joined.book, joined.chapter, verse)) ?? "");
		}
		await createBetaItem(userId, {
			module: MEMORY_MODULE,
			kind: "passage",
			title: rangeReference(bookName(joined.book), joined),
			body: texts.join(" ").trim(),
			data: { book: joined.book, chapter: joined.chapter, start: joined.start, end: joined.end },
			refs: rangeRefs(joined),
		});
		for (const passage of overlapping) await deleteBetaItem(userId, passage.id);
	}
	return {
		key: rangeKey(joined),
		reference: rangeReference(bookName(joined.book), joined),
		range: joined,
		added,
		alreadyInDeck: preview.verses.length - added,
	};
}

/* ------------------------------------------------------------------------ */
/* Cards made from the founder's own study                                    */
/* ------------------------------------------------------------------------ */

const HIGHLIGHT_SCAN = 200;
const NOTE_SCAN = 40;
const NOTE_CHARS = 20_000;
const STUDY_SCAN = 20;
const CHAT_SCAN = 30;
const MODULE_SCAN = 200;

function logFailure(what: string): (error: unknown) => null {
	return (error: unknown) => {
		console.error(`[beta/memory] ${what} failed; continuing without it:`, error);
		return null;
	};
}

/** A written reference ("Ephesians 2:8-9") as a memory passage, or null. */
function referenceRange(reference: string): PassageRange | null {
	try {
		return rangeFromReference(reference);
	} catch {
		return null;
	}
}

export interface MemoryCandidate {
	key: string;
	source: MemorySource;
	reference: string;
	book: number;
	chapter: number;
	start: number;
	end: number;
	reason: string;
	text: string;
	newVerses: number;
}

function candidateReason(signal: MemorySignal, now: Date, timezone: string | null): string {
	const when = describeWhen(new Date(signal.at), now, timezone);
	const many = signal.range.end > signal.range.start;
	switch (signal.source) {
		case "highlight":
			return `You highlighted ${many ? "these verses" : "this"} ${when}.`;
		case "study":
			return signal.title ? `A passage in your study "${signal.title}", saved ${when}.` : `A passage in one of your studies, saved ${when}.`;
		case "note":
			return signal.title ? `You wrote it into your note "${signal.title}" ${when}.` : `You wrote it into one of your notes ${when}.`;
		case "module":
			return signal.title ? `From "${signal.title}" in SureWord Beta, ${when}.` : `From your work in SureWord Beta, ${when}.`;
		case "chat":
			return signal.title ? `It came up in your chat "${signal.title}" ${when}.` : `It came up in a chat ${when}.`;
	}
}

/**
 * Verses and passages from the founder's own study that are not yet cards:
 * consecutive highlights joined into passages, references written in notes,
 * the passages of saved studies, the passages other beta modules keep, and
 * verses cited in recent chats. Nothing is generated; every suggestion is a
 * record the founder made, named in its reason. Each read fails soft.
 */
export async function memoryCandidates(userId: string, now: Date = new Date()): Promise<MemoryCandidate[]> {
	const [timezone, translation, highlights, notes, studies, messages, items, queued] = await Promise.all([
		learnTimezone(userId).catch(logFailure("Timezone lookup")),
		founderTranslation(userId),
		prisma.verseHighlight
			.findMany({
				where: { userId },
				orderBy: { updatedAt: "desc" },
				take: HIGHLIGHT_SCAN,
				select: { book: true, chapter: true, verse: true, updatedAt: true },
			})
			.catch(logFailure("Highlight lookup")),
		prisma.note
			.findMany({ where: { userId }, orderBy: { updatedAt: "desc" }, take: NOTE_SCAN, select: { title: true, plainText: true, updatedAt: true } })
			.catch(logFailure("Note lookup")),
		prisma.agentStudy
			.findMany({ where: { userId }, orderBy: { updatedAt: "desc" }, take: STUDY_SCAN, select: { title: true, state: true, updatedAt: true } })
			.catch(logFailure("Study lookup")),
		prisma.message
			.findMany({
				where: { role: "assistant", conversation: { userId } },
				orderBy: { createdAt: "desc" },
				take: CHAT_SCAN,
				select: { createdAt: true, metadata: true, conversation: { select: { title: true } } },
			})
			.catch(logFailure("Chat citation lookup")),
		listBetaItems(userId, { take: MODULE_SCAN }).catch(logFailure("Beta item lookup")),
		prisma.verseMemory.findMany({ where: { userId }, select: { book: true, chapter: true, verse: true } }),
	]);

	const signals: MemorySignal[] = [];

	// Highlights are per verse; verses marked side by side are one passage.
	for (const group of groupConsecutiveVerses(highlights ?? [])) {
		const at = Math.max(...group.members.map((member) => member.updatedAt.getTime()));
		signals.push({ source: "highlight", range: group.range, at });
	}

	for (const note of notes ?? []) {
		const title = note.title.trim() || undefined;
		for (const segment of parseVerseReferences(note.plainText.slice(0, NOTE_CHARS))) {
			if (segment.type !== "verse-ref") continue;
			const range = referenceRange(segment.value);
			if (range) signals.push({ source: "note", range, at: note.updatedAt.getTime(), title });
		}
	}

	for (const study of studies ?? []) {
		const state = study.state as { passages?: unknown } | null;
		const passages = Array.isArray(state?.passages) ? state.passages : [];
		for (const passage of passages) {
			const range = typeof passage === "string" ? referenceRange(passage) : null;
			if (range) signals.push({ source: "study", range, at: study.updatedAt.getTime(), title: study.title.trim() || undefined });
		}
	}

	for (const item of items ?? []) {
		if (item.module === MEMORY_MODULE) continue;
		// Another module's verse keys ("49.2.8"); its chapter keys are not verses.
		const verses = item.refs.flatMap((ref) => {
			const match = /^(\d{1,2})\.(\d{1,3})\.(\d{1,3})$/.exec(ref);
			return match ? [{ book: Number(match[1]), chapter: Number(match[2]), verse: Number(match[3]) }] : [];
		});
		const moduleTitle = BETA_MODULES.find((entry) => entry.slug === item.module)?.title;
		// Whole runs: one longer than a memory passage is a reading (a Learning Paths lesson's
		// Ephesians 2:1-10), which planCandidates leaves out rather than offer six-verse cuts of it.
		for (const group of groupConsecutiveVerses(verses, Number.POSITIVE_INFINITY)) {
			signals.push({
				source: "module",
				range: group.range,
				at: item.updatedAt.getTime(),
				title: item.title.trim() ? `${item.title.trim()}${moduleTitle ? `, ${moduleTitle}` : ""}` : moduleTitle,
			});
		}
	}

	for (const message of messages ?? []) {
		const title = message.conversation?.title?.trim() || undefined;
		for (const reference of toolVerseReferences(message.metadata)) {
			const range = referenceRange(reference);
			if (range) signals.push({ source: "chat", range, at: message.createdAt.getTime(), title });
		}
	}

	const plans = planCandidates(signals, new Set(queued.map((row) => `${row.book}.${row.chapter}.${row.verse}`)));
	const resolved = await Promise.all(
		plans.map(async (plan): Promise<MemoryCandidate | null> => {
			const texts: string[] = [];
			for (let verse = plan.range.start; verse <= plan.range.end; verse += 1) {
				const text = await learnVerseText(translation, plan.range.book, plan.range.chapter, verse);
				// A reference that names a verse the chapter does not have is no card.
				if (!text) return null;
				texts.push(text);
			}
			return {
				key: plan.key,
				source: plan.source,
				reference: rangeReference(bookName(plan.range.book), plan.range),
				...plan.range,
				reason: candidateReason(plan, now, timezone ?? null),
				text: texts.join(" "),
				newVerses: plan.newVerses,
			};
		}),
	);
	return resolved.filter((candidate): candidate is MemoryCandidate => candidate !== null);
}

/* ------------------------------------------------------------------------ */
/* Comprehension questions (stored here; written in memory-questions.ts)      */
/* ------------------------------------------------------------------------ */

/** Replace the unit's questions in this translation with a fresh set. */
export async function saveQuestions(
	userId: string,
	range: PassageRange,
	translation: TranslationId,
	questions: QuizQuestion[],
	model: string | null,
	promptVersion: number,
): Promise<void> {
	const existing = await loadQuestions(userId);
	const reference = rangeReference(bookName(range.book), range);
	await createBetaItem(userId, {
		module: MEMORY_MODULE,
		kind: "questions",
		title: `Questions on ${reference}`,
		body: questions
			.map((question) => `${question.prompt} ${question.options[question.answerIndex]}`)
			.join("\n"),
		data: { ...range, translation, questions, model, promptVersion },
		refs: rangeRefs(range),
	});
	for (const item of existing) {
		if (item.translation === translation && rangeKey(item) === rangeKey(range)) await deleteBetaItem(userId, item.id);
	}
}

/** The verses of a unit as the deck holds them: each card's own translation and text. */
export async function unitForQuestions(
	userId: string,
	range: PassageRange,
): Promise<{ translation: TranslationId; verses: { verse: number; text: string }[] } | null> {
	const cards = await prisma.verseMemory.findMany({
		where: { userId, book: range.book, chapter: range.chapter, verse: { gte: range.start, lte: range.end } },
		orderBy: { verse: "asc" },
		select: { verse: true, translation: true },
	});
	if (cards.length !== rangeLength(range)) return null;
	const translation = toTranslation(cards[0].translation);
	const verses = [];
	for (const card of cards) {
		const text = await learnVerseText(translation, range.book, range.chapter, card.verse);
		if (!text) return null;
		verses.push({ verse: card.verse, text });
	}
	return { translation, verses };
}

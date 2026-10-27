import "server-only";

import type { BetaItem } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { BOOKS, bookByOrder, resolveReference } from "@/lib/bible/books";
import { getKjvChapter } from "@/lib/bible/kjv";
import { bibleVersePlainText } from "@/lib/bible/verseMarkup";
import { HIGHLIGHT_COLORS } from "@/lib/highlights";
import { appendMarkdownToNote } from "@/lib/notes-io";
import {
	createBetaItem,
	deleteBetaItem,
	getBetaItem,
	listBetaItems,
	updateBetaItem,
} from "@/lib/beta/store";
import { BETA_REFS_MAX, betaRefKey, normalizeBetaRefs, parseBetaRefKey } from "@/lib/beta/store-rules";
import { parseVerseReferences, stripTranslationTag } from "@/utils/verseParser";
import {
	PASTED_TITLE_MAX,
	PROJECT_DESCRIPTION_MAX,
	PROJECT_ITEMS_MAX,
	PROJECT_KINDS,
	PROJECT_TITLE_MAX,
	PROJECTS_MODULE,
	SOURCE_TEXT_MIN,
	applySectionChange,
	assignSourceLabels,
	chapterReferenceCandidates,
	checkProjectCreate,
	isChapterKey,
	isCoverId,
	nextSourceLabel,
	normalizeSourceText,
	parseProjectData,
	passageLabel,
	passageVerseKeys,
	projectProgress,
	questionItemText,
	studyMarkdown,
	topicsInText,
	type AssembledStudy,
	type ClaimBasis,
	type CoverId,
	type ProjectCounts,
	type ProjectCreateInput,
	type ProjectData,
	type ProjectProgress,
	type ProjectSection,
	type ResolvedCitation,
	type SectionChange,
} from "@/lib/beta/projects/projects-rules";

/**
 * Study Projects' server half (docs/beta/projects.md). Every object is a
 * `BetaItem` of module "projects" written through the shared store, so each
 * call is scoped to its owner: someone else's project id behaves exactly like
 * one that does not exist.
 *
 * Notes and highlights join a project as pointers (a note id, a verse key),
 * never copies, and are read live whenever the project is shown or asked
 * about. Scripture is always read from the bundled KJV.
 */

/** A validation failure the route turns into a 400 with this message. */
export class ProjectInputError extends Error {}

const BOOK_FACTS = BOOKS.map((book) => ({ order: book.order, name: book.name, chapters: book.chapters }));

export function bookName(order: number): string {
	return bookByOrder(order)?.name ?? `Book ${order}`;
}

/** The reader's link for a passage key's chapter, opened at its first verse. */
export function readerHref(book: number, chapter: number, verse?: number | null): string {
	return `/bible/chapter?book=${book}&chapter=${chapter}&translation=KJV${verse ? `&verse=${verse}` : ""}`;
}

/** A chapter of the bundled KJV as plain verse text. */
export async function kjvChapter(book: number, chapter: number): Promise<string[]> {
	return (await getKjvChapter(book, chapter)).map((raw) => bibleVersePlainText(raw).trim());
}

/* -------------------------------------------------------------------------
 * References
 * ---------------------------------------------------------------------- */

export interface ParsedPassage {
	book: number;
	chapter: number;
	/** Null for a whole chapter. */
	start: number | null;
	end: number | null;
	label: string;
}

const RANGE_TAIL = /[-–—]\s*(\d+)(?:\s*:\s*(\d+))?\s*$/;

/**
 * "Romans 5", "Rom 5:1-11" or "romans 8:28" as one passage within one
 * chapter, checked against the bundled KJV. Throws ProjectInputError with a
 * message for the founder.
 */
export async function parsePassage(input: string): Promise<ParsedPassage> {
	const reference = stripTranslationTag(input.trim().replace(/\s+/g, " "));
	if (!reference || reference.length > 60) throw new ProjectInputError("Type a reference like Romans 5 or Romans 5:1-11.");
	const start = resolveReference(reference);
	if (!start) throw new ProjectInputError(`"${reference}" is not a passage SureWord can find. Try Romans 5 or Romans 5:1-11.`);
	const verses = await kjvChapter(start.order, start.chapter);
	const name = bookName(start.order);
	if (start.verse === undefined) {
		return { book: start.order, chapter: start.chapter, start: null, end: null, label: passageLabel(name, start.chapter) };
	}
	if (start.verse > verses.length) {
		throw new ProjectInputError(`${name} ${start.chapter} has ${verses.length} verses, so verse ${start.verse} does not exist.`);
	}
	let end = start.verse;
	const tail = reference.match(RANGE_TAIL);
	if (tail) {
		if (tail[2] !== undefined && Number(tail[1]) !== start.chapter) {
			throw new ProjectInputError("Add one chapter at a time, for example Romans 5:12-21 and then Romans 6:1-4.");
		}
		end = Number(tail[2] ?? tail[1]);
		if (end < start.verse) throw new ProjectInputError(`"${reference}" runs backwards. Give the first verse before the last.`);
		end = Math.min(end, verses.length);
	}
	return { book: start.order, chapter: start.chapter, start: start.verse, end, label: passageLabel(name, start.chapter, start.verse, end) };
}

/** Passage keys an item may carry: under the store's limit, where every verse key also brings its chapter's. */
const REFS_KEPT = BETA_REFS_MAX - 20;

/**
 * Passage keys for every resolvable reference written in a text (a note, a
 * pasted source), each verse range held to its chapter's real verses and the
 * whole set to REFS_KEPT, so a long commentary keeps its first references
 * instead of being refused by the store and keeping none.
 */
export async function referenceKeysInText(text: string, max = REFS_KEPT): Promise<string[]> {
	const verses = new Set<string>();
	const chapters = new Set<string>();
	const full = () => verses.size + chapters.size >= max - 1;
	const lengths = new Map<string, number>();
	const versesIn = async (book: number, chapter: number): Promise<number> => {
		const key = betaRefKey(book, chapter);
		if (!lengths.has(key)) lengths.set(key, (await kjvChapter(book, chapter).catch(() => [])).length);
		return lengths.get(key) ?? 0;
	};
	const sample = text.slice(0, 120_000);
	for (const segment of parseVerseReferences(sample)) {
		if (full()) break;
		if (segment.type !== "verse-ref") continue;
		const value = stripTranslationTag(segment.value);
		const ref = resolveReference(value);
		if (!ref) continue;
		chapters.add(betaRefKey(ref.order, ref.chapter));
		if (ref.verse === undefined) continue;
		const last = await versesIn(ref.order, ref.chapter);
		if (ref.verse > last) continue;
		const tail = value.match(RANGE_TAIL);
		const end = tail && tail[2] === undefined ? Math.min(Number(tail[1]), ref.verse + 30, last) : ref.verse;
		for (let verse = ref.verse; verse <= Math.max(ref.verse, end) && !full(); verse++) verses.add(betaRefKey(ref.order, ref.chapter, verse));
	}
	// Whole chapters named in prose ("Matthew Henry on Romans 5"), which the verse detector skips.
	for (const candidate of chapterReferenceCandidates(sample)) {
		if (full()) break;
		const ref = resolveReference(candidate);
		if (ref && ref.verse === undefined) chapters.add(betaRefKey(ref.order, ref.chapter));
	}
	return normalizeBetaRefs([...verses, ...chapters]) ?? [];
}

/** "Romans 5:1" for a verse key, "Romans 5" for a chapter key. */
export function labelForKey(key: string): string | null {
	const parsed = parseBetaRefKey(key);
	if (!parsed) return null;
	return passageLabel(bookName(parsed.book), parsed.chapter, parsed.verse);
}

/* -------------------------------------------------------------------------
 * Projects
 * ---------------------------------------------------------------------- */

export interface ProjectSummary {
	id: string;
	title: string;
	description: string | null;
	cover: CoverId;
	scope: { type: "book"; book: number; bookName: string } | { type: "topic" };
	sections: ProjectSection[];
	progress: ProjectProgress;
	archived: boolean;
	archivedAt: string | null;
	counts: { passages: number; sources: number; questions: number };
	createdAt: string;
	updatedAt: string;
}

interface ProjectRow {
	item: BetaItem;
	data: ProjectData;
}

function isProjectItem(item: BetaItem | null): item is BetaItem {
	return Boolean(item && item.module === PROJECTS_MODULE && item.kind === PROJECT_KINDS.project && item.parentId === null);
}

/** The owner's project, or null for a missing, foreign or non-project id. */
export async function loadProject(userId: string, id: string): Promise<ProjectRow | null> {
	if (typeof id !== "string" || !id || id.length > 40) return null;
	const item = await getBetaItem(userId, id);
	if (!isProjectItem(item)) return null;
	const data = parseProjectData(item.data);
	return data ? { item, data } : null;
}

function countsOf(children: readonly BetaItem[]): ProjectCounts {
	const count = (kind: string) => children.filter((child) => child.kind === kind).length;
	return { passages: count(PROJECT_KINDS.passage), sources: count(PROJECT_KINDS.source), questions: count(PROJECT_KINDS.question) };
}

/** `children` when they are already loaded (the workspace); otherwise the counts kept on the project (the list). */
function summarize(row: ProjectRow, children: readonly BetaItem[] | null): ProjectSummary {
	const { item, data } = row;
	return {
		id: item.id,
		title: item.title,
		description: item.body,
		cover: data.cover,
		scope: data.scope.type === "book" ? { type: "book", book: data.scope.book, bookName: bookName(data.scope.book) } : { type: "topic" },
		sections: data.sections,
		progress: projectProgress(data.sections),
		archived: data.archived,
		archivedAt: data.archivedAt,
		counts: children ? countsOf(children) : data.counts,
		createdAt: item.createdAt.toISOString(),
		updatedAt: item.updatedAt.toISOString(),
	};
}

export async function listProjects(userId: string): Promise<ProjectSummary[]> {
	const items = await listBetaItems(userId, { module: PROJECTS_MODULE, kind: PROJECT_KINDS.project, parentId: null, take: 100 });
	return items.flatMap((item) => {
		const data = parseProjectData(item.data);
		return data ? [summarize({ item, data }, null)] : [];
	});
}

/** The chapters a project covers, for its `refs`: its book or sections, and its passages. */
function projectRefs(data: ProjectData, passages: readonly BetaItem[]): string[] {
	const keys = data.sections.flatMap((section) => (section.ref ? [section.ref] : []));
	for (const passage of passages) {
		const parsed = passageData(passage);
		if (parsed) keys.push(betaRefKey(parsed.book, parsed.chapter));
	}
	return normalizeBetaRefs([...new Set(keys)].slice(0, REFS_KEPT)) ?? [];
}

export async function createProject(userId: string, input: ProjectCreateInput): Promise<ProjectSummary> {
	const checked = checkProjectCreate(input, BOOK_FACTS);
	if (!checked.ok) throw new ProjectInputError(checked.error);
	const { title, description, data } = checked.value;
	const item = await createBetaItem(userId, {
		module: PROJECTS_MODULE,
		kind: PROJECT_KINDS.project,
		title,
		body: description,
		data: data as unknown as Record<string, unknown>,
		refs: projectRefs(data, []),
		topics: [],
	});
	return summarize({ item, data }, null);
}

export interface ProjectPatch {
	title?: unknown;
	description?: unknown;
	cover?: unknown;
	archived?: unknown;
	section?: SectionChange;
}

export async function updateProject(userId: string, id: string, patch: ProjectPatch): Promise<ProjectSummary | null> {
	const row = await loadProject(userId, id);
	if (!row) return null;
	let data = row.data;
	const change: { title?: string; body?: string | null; data?: Record<string, unknown>; refs?: string[] } = {};
	if (patch.title !== undefined) {
		const title = typeof patch.title === "string" ? patch.title.trim().replace(/\s+/g, " ") : "";
		if (!title || title.length > PROJECT_TITLE_MAX) throw new ProjectInputError(`Give the project a name of up to ${PROJECT_TITLE_MAX} characters.`);
		change.title = title;
	}
	if (patch.description !== undefined) {
		const description = patch.description === null ? "" : typeof patch.description === "string" ? patch.description.trim() : null;
		if (description === null || description.length > PROJECT_DESCRIPTION_MAX) throw new ProjectInputError(`Keep the description under ${PROJECT_DESCRIPTION_MAX} characters.`);
		change.body = description || null;
	}
	if (patch.cover !== undefined) {
		if (!isCoverId(patch.cover)) throw new ProjectInputError("Choose one of the covers.");
		data = { ...data, cover: patch.cover };
	}
	if (patch.archived !== undefined) {
		if (typeof patch.archived !== "boolean") throw new ProjectInputError("archived must be true or false.");
		data = { ...data, archived: patch.archived, archivedAt: patch.archived ? new Date().toISOString() : null };
	}
	if (patch.section !== undefined) {
		let section = patch.section;
		// A typed passage ("Acts 9") becomes the chapter key the section opens at.
		if (section.op === "add" && section.ref && !parseBetaRefKey(section.ref)) {
			const ref = resolveReference(section.ref);
			if (!ref) throw new ProjectInputError(`"${section.ref}" is not a passage SureWord can find.`);
			section = { ...section, ref: betaRefKey(ref.order, ref.chapter) };
		}
		if (section.op === "add" && section.ref && !isChapterKey(section.ref, BOOK_FACTS)) {
			throw new ProjectInputError("That chapter is not in the Bible.");
		}
		const applied = applySectionChange(data, section, new Date().toISOString());
		if (!applied.ok) throw new ProjectInputError(applied.error);
		data = applied.value;
	}
	if (data !== row.data) {
		change.data = data as unknown as Record<string, unknown>;
		const passages = await listBetaItems(userId, { module: PROJECTS_MODULE, parentId: id, kind: PROJECT_KINDS.passage, take: 500 });
		change.refs = projectRefs(data, passages);
	}
	if (Object.keys(change).length === 0) throw new ProjectInputError("Nothing to change.");
	const item = await updateBetaItem(userId, id, change);
	if (!item) return null;
	const children = await listBetaItems(userId, { module: PROJECTS_MODULE, parentId: id, take: 500 });
	return summarize({ item, data }, children);
}

/** Deletes the project and, through the store, everything gathered in it. Notes it pointed at are untouched. */
export function deleteProject(userId: string, id: string): Promise<boolean> {
	return loadProject(userId, id).then((row) => (row ? deleteBetaItem(userId, id) : false));
}

/* -------------------------------------------------------------------------
 * What a project holds
 * ---------------------------------------------------------------------- */

interface PassageData {
	book: number;
	chapter: number;
	start: number | null;
	end: number | null;
	origin: string;
}

function passageData(item: BetaItem): PassageData | null {
	const value = item.data as Record<string, unknown>;
	const book = Number(value?.book);
	const chapter = Number(value?.chapter);
	const meta = bookByOrder(book);
	if (!meta || !Number.isInteger(chapter) || chapter < 1 || chapter > meta.chapters) return null;
	const start = Number.isInteger(value.start) ? (value.start as number) : null;
	const end = Number.isInteger(value.end) ? (value.end as number) : start;
	return { book, chapter, start, end, origin: typeof value.origin === "string" ? value.origin : "typed" };
}

export interface PassageView {
	id: string;
	reference: string;
	book: number;
	chapter: number;
	start: number | null;
	end: number | null;
	href: string;
	verses: { verse: number; text: string }[];
	origin: string;
	addedAt: string;
}

export type SourceType = "note" | "highlight" | "pasted" | "upload";

export interface SourceView {
	id: string;
	/** "S1", "S2"... in the order added: how the assistant and its citations name it. */
	label: string;
	type: SourceType;
	title: string;
	preview: string;
	chars: number;
	truncated: boolean;
	/** The note or highlight it points at is gone. */
	missing: boolean;
	noteId: string | null;
	highlight: { book: number; chapter: number; verse: number; translation: string; color: string | null; reference: string; href: string } | null;
	fileName: string | null;
	pages: number | null;
	refs: string[];
	addedAt: string;
}

export interface QuestionView {
	id: string;
	text: string;
	status: "open" | "answered";
	answer: string | null;
	origin: string;
	topics: string[];
	addedAt: string;
}

export interface OverviewTheme {
	name: string;
	summary: string;
	refs: { reference: string; href: string }[];
}

export interface OverviewView {
	id: string;
	themes: OverviewTheme[];
	connected: { reference: string; href: string; why: string; from: string | null; text: string }[];
	questions: { text: string; theme: string | null }[];
	basis: { passages: number; sources: number };
	generatedAt: string;
}

export interface AnswerSegment {
	text: string;
	/** "gap" says the materials do not settle something; it needs no citation. */
	basis: ClaimBasis | "gap";
	citations: ResolvedCitation[];
	/** No citation survived checking, so nothing in the project backs this sentence. */
	unsupported: boolean;
	/** It quotes words that are not in the project's material. */
	unverifiedQuote: boolean;
}

export interface AnswerView {
	id: string;
	question: string;
	segments: AnswerSegment[];
	answerable: boolean;
	missing: string | null;
	askedAt: string;
}

export interface StudyView {
	id: string;
	mode: "outline" | "study";
	title: string;
	markdown: string;
	study: AssembledStudy;
	noteId: string | null;
	createdAt: string;
}

export interface ProjectView extends ProjectSummary {
	passages: PassageView[];
	sources: SourceView[];
	questions: QuestionView[];
	overview: OverviewView | null;
	answers: AnswerView[];
	studies: StudyView[];
}

const byCreated = (a: BetaItem, b: BetaItem) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);

async function passageView(item: BetaItem): Promise<PassageView | null> {
	const passage = passageData(item);
	if (!passage) return null;
	let chapterVerses: string[] = [];
	try {
		chapterVerses = await kjvChapter(passage.book, passage.chapter);
	} catch {
		return null;
	}
	const start = passage.start ?? 1;
	const end = Math.min(passage.end ?? chapterVerses.length, chapterVerses.length);
	return {
		id: item.id,
		reference: passageLabel(bookName(passage.book), passage.chapter, passage.start, passage.end),
		book: passage.book,
		chapter: passage.chapter,
		start: passage.start,
		end: passage.end,
		href: readerHref(passage.book, passage.chapter, passage.start),
		verses: chapterVerses.slice(start - 1, end).map((text, index) => ({ verse: start + index, text })),
		origin: passage.origin,
		addedAt: item.createdAt.toISOString(),
	};
}

interface SourceData {
	type: SourceType;
	label?: string;
	noteId?: string;
	highlight?: { book: number; chapter: number; verse: number; translation: string };
	fileName?: string;
	pages?: number | null;
	truncated?: boolean;
}

function sourceData(item: BetaItem): SourceData | null {
	const value = item.data as Record<string, unknown>;
	const type = value?.type;
	const label = typeof value?.label === "string" ? value.label : undefined;
	if (type === "note" && typeof value.noteId === "string") return { type, label, noteId: value.noteId };
	if (type === "highlight") {
		const h = value.highlight as Record<string, unknown> | undefined;
		if (h && Number.isInteger(h.book) && Number.isInteger(h.chapter) && Number.isInteger(h.verse)) {
			return { type, label, highlight: { book: h.book as number, chapter: h.chapter as number, verse: h.verse as number, translation: typeof h.translation === "string" ? h.translation : "KJV" } };
		}
		return null;
	}
	if (type === "pasted" || type === "upload") {
		return {
			type,
			label,
			fileName: typeof value.fileName === "string" ? value.fileName : undefined,
			pages: Number.isInteger(value.pages) ? (value.pages as number) : null,
			truncated: value.truncated === true,
		};
	}
	return null;
}

/** The labels a project's sources are cited by, in the order they were added (`assignSourceLabels`). */
function sourceLabels(children: readonly BetaItem[]): string[] {
	return assignSourceLabels(children.filter((child) => child.kind === PROJECT_KINDS.source).sort(byCreated).map((child) => sourceData(child)?.label));
}

/** A source's readable text, resolved live: a note's current body, a highlight's KJV verse, or the stored text. */
export interface ResolvedSource {
	item: BetaItem;
	view: SourceView;
	/** Null when the pointer is gone or holds no text. */
	text: string | null;
}

function preview(text: string, length = 220): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > length ? `${flat.slice(0, length - 1).trimEnd()}…` : flat;
}

export async function resolveSources(userId: string, items: readonly BetaItem[]): Promise<ResolvedSource[]> {
	const sources = items.filter((item) => item.kind === PROJECT_KINDS.source).sort(byCreated);
	const labels = sourceLabels(sources);
	const parsed = sources.map((item, index) => ({ item, data: sourceData(item), label: labels[index] }));
	const noteIds = parsed.flatMap(({ data }) => (data?.type === "note" && data.noteId ? [data.noteId] : []));
	const notes = noteIds.length
		? await prisma.note.findMany({ where: { userId, id: { in: noteIds } }, select: { id: true, title: true, plainText: true } })
		: [];
	const noteById = new Map(notes.map((note) => [note.id, note]));
	const highlightKeys = parsed.flatMap(({ data }) => (data?.type === "highlight" && data.highlight ? [data.highlight] : []));
	const highlights = highlightKeys.length
		? await prisma.verseHighlight.findMany({
				where: { userId, OR: highlightKeys.map((key) => ({ book: key.book, chapter: key.chapter, verse: key.verse, translation: key.translation })) },
				select: { book: true, chapter: true, verse: true, translation: true, color: true },
			})
		: [];
	const highlightColor = new Map(highlights.map((row) => [`${row.translation}:${row.book}.${row.chapter}.${row.verse}`, row.color]));

	const out: ResolvedSource[] = [];
	for (const { item, data, label } of parsed) {
		if (!data) continue;
		const base: SourceView = {
			id: item.id,
			label,
			type: data.type,
			title: item.title,
			preview: "",
			chars: 0,
			truncated: data.truncated === true,
			missing: false,
			noteId: data.noteId ?? null,
			highlight: null,
			fileName: data.fileName ?? null,
			pages: data.pages ?? null,
			refs: item.refs,
			addedAt: item.createdAt.toISOString(),
		};
		let text: string | null = null;
		if (data.type === "note") {
			const note = noteById.get(data.noteId!);
			if (note) {
				text = note.plainText.trim() || null;
				base.title = note.title || item.title;
			} else {
				base.missing = true;
			}
		} else if (data.type === "highlight" && data.highlight) {
			const key = data.highlight;
			const color = highlightColor.get(`${key.translation}:${key.book}.${key.chapter}.${key.verse}`) ?? null;
			let verseText = "";
			try {
				verseText = (await kjvChapter(key.book, key.chapter))[key.verse - 1] ?? "";
			} catch {
				verseText = "";
			}
			const reference = passageLabel(bookName(key.book), key.chapter, key.verse);
			base.highlight = { ...key, color, reference, href: readerHref(key.book, key.chapter, key.verse) };
			base.missing = color === null;
			text = verseText || null;
			base.title = reference;
		} else {
			text = item.body;
		}
		base.chars = text?.length ?? 0;
		base.preview = text ? preview(text) : "";
		out.push({ item, view: base, text: base.missing ? null : text });
	}
	return out;
}

function questionView(item: BetaItem): QuestionView {
	const value = item.data as Record<string, unknown>;
	return {
		id: item.id,
		text: typeof value?.question === "string" ? value.question : item.title,
		status: value?.status === "answered" ? "answered" : "open",
		answer: typeof value?.answer === "string" && value.answer ? value.answer : null,
		origin: typeof value?.origin === "string" ? value.origin : "user",
		topics: item.topics,
		addedAt: item.createdAt.toISOString(),
	};
}

function overviewView(item: BetaItem): OverviewView | null {
	const value = item.data as Record<string, unknown>;
	if (!Array.isArray(value?.themes)) return null;
	return {
		id: item.id,
		themes: value.themes as OverviewTheme[],
		connected: Array.isArray(value.connected) ? (value.connected as OverviewView["connected"]) : [],
		questions: Array.isArray(value.questions) ? (value.questions as OverviewView["questions"]) : [],
		basis: (value.basis as OverviewView["basis"]) ?? { passages: 0, sources: 0 },
		generatedAt: typeof value.generatedAt === "string" ? value.generatedAt : item.updatedAt.toISOString(),
	};
}

function answerView(item: BetaItem): AnswerView | null {
	const value = item.data as Record<string, unknown>;
	if (!Array.isArray(value?.segments)) return null;
	return {
		id: item.id,
		question: typeof value.question === "string" ? value.question : item.title,
		segments: value.segments as AnswerSegment[],
		answerable: value.answerable !== false,
		missing: typeof value.missing === "string" ? value.missing : null,
		askedAt: item.createdAt.toISOString(),
	};
}

function studyView(item: BetaItem): StudyView | null {
	const value = item.data as Record<string, unknown>;
	const study = value?.study as AssembledStudy | undefined;
	if (!study || !Array.isArray(study.sections)) return null;
	return {
		id: item.id,
		mode: study.mode === "outline" ? "outline" : "study",
		title: item.title,
		// Rebuilt from the study rather than stored beside it, so a long study stays within the store's data limit.
		markdown: studyMarkdown(study),
		study,
		noteId: typeof value.noteId === "string" ? value.noteId : null,
		createdAt: item.createdAt.toISOString(),
	};
}

/** What a project holds: only this module's items, so nothing another module nests under it is read or sent to the assistant. */
export async function projectChildren(userId: string, projectId: string): Promise<BetaItem[]> {
	return listBetaItems(userId, { module: PROJECTS_MODULE, parentId: projectId, take: 500 });
}

export async function projectView(userId: string, id: string): Promise<ProjectView | null> {
	const row = await loadProject(userId, id);
	if (!row) return null;
	const children = await projectChildren(userId, id);
	const [passages, sources] = await Promise.all([
		Promise.all(children.filter((item) => item.kind === PROJECT_KINDS.passage).sort(byCreated).map(passageView)),
		resolveSources(userId, children),
	]);
	const overviewItem = children.filter((item) => item.kind === PROJECT_KINDS.overview).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
	return {
		...summarize(row, children),
		passages: passages.filter((passage): passage is PassageView => passage !== null),
		sources: sources.map((source) => source.view),
		questions: children.filter((item) => item.kind === PROJECT_KINDS.question).sort(byCreated).map(questionView),
		overview: overviewItem ? overviewView(overviewItem) : null,
		answers: children.filter((item) => item.kind === PROJECT_KINDS.answer).sort(byCreated).flatMap((item) => answerView(item) ?? []),
		studies: children
			.filter((item) => item.kind === PROJECT_KINDS.study)
			.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
			.flatMap((item) => studyView(item) ?? []),
	};
}

/* -------------------------------------------------------------------------
 * Gathering
 * ---------------------------------------------------------------------- */

const GATHERED_KINDS: readonly string[] = [PROJECT_KINDS.passage, PROJECT_KINDS.source, PROJECT_KINDS.question];

/**
 * Room for one more gathered item. Answers and drafts are kept to their own
 * limits (ANSWERS_KEPT, STUDIES_KEPT), so a project never outgrows the store's
 * 500-row page and an old passage can never fall out of view.
 */
export async function assertRoom(userId: string, projectId: string): Promise<void> {
	const children = await listBetaItems(userId, { module: PROJECTS_MODULE, parentId: projectId, take: 500 });
	if (children.filter((child) => GATHERED_KINDS.includes(child.kind)).length >= PROJECT_ITEMS_MAX) {
		throw new ProjectInputError(`A project can hold up to ${PROJECT_ITEMS_MAX} passages, sources and questions. Remove some to add more.`);
	}
}

/** After something is added or removed: the project's chapter refs and its counts, from a fresh read. */
export async function touchProject(userId: string, projectId: string): Promise<void> {
	const [fresh, children] = await Promise.all([loadProject(userId, projectId), listBetaItems(userId, { module: PROJECTS_MODULE, parentId: projectId, take: 500 })]);
	if (!fresh) return;
	const passages = children.filter((child) => child.kind === PROJECT_KINDS.passage);
	await updateBetaItem(userId, projectId, {
		refs: projectRefs(fresh.data, passages),
		data: { ...fresh.data, counts: countsOf(children) } as unknown as Record<string, unknown>,
	});
}

export type AddInput =
	| { kind: "passage"; reference: string; origin?: string }
	| { kind: "note"; noteId: string }
	| { kind: "highlight"; book: number; chapter: number; verse: number; translation?: string }
	| { kind: "pasted"; title: string; text: string }
	| { kind: "question"; text: string; origin?: string; topics?: string[] };

const PASSAGE_ORIGINS = new Set(["typed", "reader", "last-read", "overview", "section"]);
const QUESTION_ORIGINS = new Set(["user", "overview", "answer"]);

export interface AddResult {
	id: string;
	duplicate: boolean;
}

export async function addToProject(userId: string, projectId: string, input: AddInput): Promise<AddResult | null> {
	const row = await loadProject(userId, projectId);
	if (!row) return null;
	const existing = await listBetaItems(userId, { module: PROJECTS_MODULE, parentId: projectId, take: 500 });

	switch (input.kind) {
		case "passage": {
			const passage = await parsePassage(String(input.reference ?? ""));
			const same = existing.find((item) => {
				if (item.kind !== PROJECT_KINDS.passage) return false;
				const data = passageData(item);
				return data && data.book === passage.book && data.chapter === passage.chapter && data.start === passage.start && data.end === passage.end;
			});
			if (same) return { id: same.id, duplicate: true };
			await assertRoom(userId, projectId);
			const verses = await kjvChapter(passage.book, passage.chapter);
			const first = passage.start ?? 1;
			const last = passage.end ?? verses.length;
			const keys = passageVerseKeys(passage.book, passage.chapter, first, last);
			const item = await createBetaItem(userId, {
				module: PROJECTS_MODULE,
				kind: PROJECT_KINDS.passage,
				parentId: projectId,
				title: passage.label,
				// The bundled KJV, so the Vault can search the words themselves.
				body: verses.slice(first - 1, last).map((text, index) => `${first + index} ${text}`).join("\n"),
				data: { book: passage.book, chapter: passage.chapter, start: passage.start, end: passage.end, origin: PASSAGE_ORIGINS.has(input.origin ?? "") ? input.origin : "typed" },
				refs: keys,
				topics: [],
			});
			await touchProject(userId, projectId);
			return { id: item.id, duplicate: false };
		}
		case "note": {
			const noteId = typeof input.noteId === "string" ? input.noteId : "";
			const same = existing.find((item) => item.kind === PROJECT_KINDS.source && (item.data as Record<string, unknown>)?.noteId === noteId);
			if (same) return { id: same.id, duplicate: true };
			const note = noteId ? await prisma.note.findFirst({ where: { id: noteId, userId }, select: { id: true, title: true, plainText: true } }) : null;
			if (!note) throw new ProjectInputError("That note could not be found.");
			await assertRoom(userId, projectId);
			const item = await createBetaItem(userId, {
				module: PROJECTS_MODULE,
				kind: PROJECT_KINDS.source,
				parentId: projectId,
				title: note.title.slice(0, 200) || "Untitled note",
				// A pointer, not a copy: the note is read live from Notes.
				body: null,
				data: { type: "note", label: nextSourceLabel(sourceLabels(existing)), noteId: note.id },
				refs: await referenceKeysInText(`${note.title}\n${note.plainText}`),
				topics: topicsInText(`${note.title}\n${note.plainText}`, row.item.topics),
			});
			await touchProject(userId, projectId);
			return { id: item.id, duplicate: false };
		}
		case "highlight": {
			const book = Number(input.book);
			const chapter = Number(input.chapter);
			const verse = Number(input.verse);
			const translation = typeof input.translation === "string" && input.translation ? input.translation.slice(0, 20) : "KJV";
			if (!bookByOrder(book) || !Number.isInteger(chapter) || chapter < 1 || chapter > 200 || !Number.isInteger(verse) || verse < 1 || verse > 200) {
				throw new ProjectInputError("That highlight could not be found.");
			}
			const highlight = await prisma.verseHighlight.findFirst({ where: { userId, book, chapter, verse, translation }, select: { id: true } });
			if (!highlight) throw new ProjectInputError("That highlight could not be found.");
			const same = existing.find((item) => {
				if (item.kind !== PROJECT_KINDS.source) return false;
				const h = (item.data as Record<string, unknown>)?.highlight as Record<string, unknown> | undefined;
				return h?.book === book && h?.chapter === chapter && h?.verse === verse && h?.translation === translation;
			});
			if (same) return { id: same.id, duplicate: true };
			await assertRoom(userId, projectId);
			const item = await createBetaItem(userId, {
				module: PROJECTS_MODULE,
				kind: PROJECT_KINDS.source,
				parentId: projectId,
				title: passageLabel(bookName(book), chapter, verse),
				body: null,
				data: { type: "highlight", label: nextSourceLabel(sourceLabels(existing)), highlight: { book, chapter, verse, translation } },
				refs: [betaRefKey(book, chapter, verse)],
				topics: [],
			});
			await touchProject(userId, projectId);
			return { id: item.id, duplicate: false };
		}
		case "pasted": {
			const title = typeof input.title === "string" ? input.title.trim().replace(/\s+/g, " ") : "";
			if (!title || title.length > PASTED_TITLE_MAX) throw new ProjectInputError(`Give the source a name of up to ${PASTED_TITLE_MAX} characters.`);
			const { text, truncated } = normalizeSourceText(typeof input.text === "string" ? input.text : "");
			if (text.length < SOURCE_TEXT_MIN) throw new ProjectInputError("Paste at least a sentence or two.");
			const item = await createSourceText(userId, projectId, { title, text, truncated, type: "pasted" }, row.item.topics);
			await touchProject(userId, projectId);
			return { id: item.id, duplicate: false };
		}
		case "question": {
			const checked = questionItemText(input.text);
			if (!checked.ok) throw new ProjectInputError(checked.error);
			const full = checked.value.body ?? checked.value.title;
			const same = existing.find((item) => item.kind === PROJECT_KINDS.question && questionView(item).text.toLowerCase() === full.toLowerCase());
			if (same) return { id: same.id, duplicate: true };
			await assertRoom(userId, projectId);
			const item = await createBetaItem(userId, {
				module: PROJECTS_MODULE,
				kind: PROJECT_KINDS.question,
				parentId: projectId,
				title: checked.value.title,
				body: full,
				data: { question: full, status: "open", answer: null, origin: QUESTION_ORIGINS.has(input.origin ?? "") ? input.origin : "user", answeredAt: null },
				refs: await referenceKeysInText(full),
				topics: [...new Set([...(input.topics ?? []).slice(0, 5), ...topicsInText(full, row.item.topics)])],
			});
			await touchProject(userId, projectId);
			return { id: item.id, duplicate: false };
		}
		default:
			throw new ProjectInputError("Unknown kind of item.");
	}
}

/** A pasted or uploaded source: its text is the item's body. */
export async function createSourceText(
	userId: string,
	projectId: string,
	source: { title: string; text: string; truncated: boolean; type: "pasted" | "upload"; fileName?: string; mediaType?: string; size?: number; pages?: number | null },
	/** The project's topics, so the source is tagged with the ones it names. */
	projectTopics: readonly string[] = [],
): Promise<BetaItem> {
	// Other modules save into projects through this (docs/beta/projects.md), so it checks the project and its room itself.
	if (!(await loadProject(userId, projectId))) throw new ProjectInputError("That project could not be found.");
	await assertRoom(userId, projectId);
	const existing = await listBetaItems(userId, { module: PROJECTS_MODULE, parentId: projectId, kind: PROJECT_KINDS.source, take: 500 });
	return createBetaItem(userId, {
		module: PROJECTS_MODULE,
		kind: PROJECT_KINDS.source,
		parentId: projectId,
		title: source.title,
		body: source.text,
		data: {
			type: source.type,
			label: nextSourceLabel(sourceLabels(existing)),
			chars: source.text.length,
			truncated: source.truncated,
			...(source.fileName ? { fileName: source.fileName, mediaType: source.mediaType ?? null, size: source.size ?? null, pages: source.pages ?? null } : {}),
		},
		refs: await referenceKeysInText(`${source.title}\n${source.text}`),
		topics: topicsInText(`${source.title}\n${source.text}`, projectTopics),
	});
}

/**
 * Tag the project's sources and questions with the topics each one names,
 * once an Overview has given the project its topics: the Vault and the Graph
 * can then find a commentary or a question by topic as well as by passage.
 */
export async function retagProjectItems(userId: string, projectId: string, topics: readonly string[]): Promise<void> {
	const children = await projectChildren(userId, projectId);
	const sources = await resolveSources(userId, children);
	const textById = new Map(sources.map((source) => [source.item.id, `${source.view.title}\n${source.text ?? ""}`]));
	await Promise.all(
		children
			.filter((child) => child.kind === PROJECT_KINDS.source || child.kind === PROJECT_KINDS.question)
			.map((child) => {
				const text = child.kind === PROJECT_KINDS.source ? textById.get(child.id) ?? child.title : `${child.body ?? child.title}`;
				const next = [...new Set([...child.topics.filter((topic) => !topics.includes(topic) && child.kind === PROJECT_KINDS.question), ...topicsInText(text, topics)])];
				return next.join("|") === child.topics.join("|") ? null : updateBetaItem(userId, child.id, { topics: next });
			}),
	);
}

/** A child of this project, or null. */
export async function loadChild(userId: string, projectId: string, itemId: string): Promise<BetaItem | null> {
	if (typeof itemId !== "string" || !itemId || itemId.length > 40) return null;
	const item = await getBetaItem(userId, itemId);
	return item && item.module === PROJECTS_MODULE && item.parentId === projectId ? item : null;
}

export interface ItemPatch {
	status?: unknown;
	answer?: unknown;
	text?: unknown;
	title?: unknown;
}

export async function updateChild(userId: string, projectId: string, itemId: string, patch: ItemPatch): Promise<boolean> {
	const row = await loadProject(userId, projectId);
	const item = row ? await loadChild(userId, projectId, itemId) : null;
	if (!item) return false;
	if (item.kind === PROJECT_KINDS.question) {
		const current = questionView(item);
		const data = { ...(item.data as Record<string, unknown>) };
		let title = item.title;
		let full = current.text;
		if (patch.text !== undefined) {
			const checked = questionItemText(patch.text);
			if (!checked.ok) throw new ProjectInputError(checked.error);
			title = checked.value.title;
			full = checked.value.body ?? checked.value.title;
			data.question = full;
		}
		if (patch.status !== undefined) {
			if (patch.status !== "open" && patch.status !== "answered") throw new ProjectInputError("A question is open or answered.");
			data.status = patch.status;
			data.answeredAt = patch.status === "answered" ? new Date().toISOString() : null;
		}
		if (patch.answer !== undefined) {
			const answer = patch.answer === null ? "" : typeof patch.answer === "string" ? patch.answer.trim() : null;
			if (answer === null || answer.length > 4_000) throw new ProjectInputError("Keep the answer under 4,000 characters.");
			data.answer = answer || null;
		}
		const answer = typeof data.answer === "string" ? data.answer : "";
		await updateBetaItem(userId, itemId, {
			title,
			body: answer ? `${full}\n\n${answer}` : full,
			data,
			refs: await referenceKeysInText(`${full}\n${answer}`),
		});
		return true;
	}
	if (item.kind === PROJECT_KINDS.source && patch.title !== undefined) {
		const type = (item.data as Record<string, unknown>)?.type;
		if (type !== "pasted" && type !== "upload") throw new ProjectInputError("Notes and highlights keep their own names.");
		const title = typeof patch.title === "string" ? patch.title.trim().replace(/\s+/g, " ") : "";
		if (!title || title.length > PASTED_TITLE_MAX) throw new ProjectInputError(`Give the source a name of up to ${PASTED_TITLE_MAX} characters.`);
		await updateBetaItem(userId, itemId, { title });
		return true;
	}
	throw new ProjectInputError("That item cannot be changed this way.");
}

export async function removeChild(userId: string, projectId: string, itemId: string): Promise<boolean> {
	const row = await loadProject(userId, projectId);
	const item = row ? await loadChild(userId, projectId, itemId) : null;
	if (!row || !item) return false;
	const removed = await deleteBetaItem(userId, itemId);
	if (removed) await touchProject(userId, projectId);
	return removed;
}

/* -------------------------------------------------------------------------
 * Pickers: the founder's own notes and highlights
 * ---------------------------------------------------------------------- */

export interface NoteChoice {
	id: string;
	title: string;
	preview: string;
	updatedAt: string;
}

export async function noteChoices(userId: string, query: string): Promise<NoteChoice[]> {
	const q = query.trim().slice(0, 100);
	const notes = await prisma.note.findMany({
		where: {
			userId,
			...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { plainText: { contains: q, mode: "insensitive" } }] } : {}),
		},
		orderBy: { updatedAt: "desc" },
		take: 30,
		select: { id: true, title: true, plainText: true, updatedAt: true },
	});
	return notes.map((note) => ({ id: note.id, title: note.title || "Untitled note", preview: preview(note.plainText, 140), updatedAt: note.updatedAt.toISOString() }));
}

export interface HighlightChoice {
	book: number;
	chapter: number;
	verse: number;
	translation: string;
	reference: string;
	text: string;
	color: string;
	colorName: string | null;
}

/** Highlights, those in `book` first when given; KJV text from the bundle whatever translation they were marked in. */
export async function highlightChoices(userId: string, book: number | null): Promise<HighlightChoice[]> {
	const rows = await prisma.verseHighlight.findMany({
		where: { userId },
		orderBy: { updatedAt: "desc" },
		take: 200,
		select: { book: true, chapter: true, verse: true, translation: true, color: true },
	});
	const sorted = book ? [...rows.filter((row) => row.book === book), ...rows.filter((row) => row.book !== book)] : rows;
	const out: HighlightChoice[] = [];
	for (const row of sorted.slice(0, 60)) {
		let text = "";
		try {
			text = (await kjvChapter(row.book, row.chapter))[row.verse - 1] ?? "";
		} catch {
			continue;
		}
		const colorName = HIGHLIGHT_COLORS.find((preset) => preset.hex.toLowerCase() === row.color.toLowerCase())?.name ?? null;
		out.push({ ...row, reference: passageLabel(bookName(row.book), row.chapter, row.verse), text, colorName });
	}
	return out;
}

/* -------------------------------------------------------------------------
 * Keeping an assembled study as a Note
 * ---------------------------------------------------------------------- */

/** Store the study in Notes through the same pipe as "Add to notes", once; a second press opens the same note. */
export async function saveStudyAsNote(userId: string, projectId: string, studyId: string): Promise<{ noteId: string; noteTitle: string; created: boolean } | null> {
	const row = await loadProject(userId, projectId);
	const item = row ? await loadChild(userId, projectId, studyId) : null;
	if (!item || item.kind !== PROJECT_KINDS.study) return null;
	const view = studyView(item);
	if (!view || !view.markdown) return null;
	if (view.noteId) {
		const existing = await prisma.note.findFirst({ where: { id: view.noteId, userId }, select: { id: true, title: true } });
		if (existing) return { noteId: existing.id, noteTitle: existing.title, created: false };
	}
	const saved = await appendMarkdownToNote({ userId, markdown: view.markdown, title: view.title, maxLength: 120_000 });
	await updateBetaItem(userId, studyId, { data: { ...(item.data as Record<string, unknown>), noteId: saved.noteId, savedAt: new Date().toISOString() } });
	return { noteId: saved.noteId, noteTitle: saved.noteTitle, created: saved.created };
}

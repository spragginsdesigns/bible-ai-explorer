/**
 * Pure rules for Study Projects (LC-17642, docs/beta/projects.md): the shape
 * of a project and its sections, progress and "Continue study", how gathered
 * material is cut into pieces and ranked against a question, how a quotation
 * the assistant attributes to a source is checked against that source, and
 * how an assembled study is written out as Markdown.
 *
 * No imports on purpose: `tests/beta-projects.test.mjs` loads this file with
 * Node's type stripping, which cannot resolve `@/` paths. Everything that
 * reads the Bible, the database or the model lives beside it in
 * `projects.ts` and `ai.ts`.
 */

export const PROJECTS_MODULE = "projects";

/** The item kinds this module writes to the shared study store. */
export const PROJECT_KINDS = {
	project: "project",
	passage: "passage",
	source: "source",
	question: "question",
	overview: "overview",
	answer: "answer",
	study: "study",
} as const;

export const PROJECT_TITLE_MAX = 120;
export const PROJECT_DESCRIPTION_MAX = 1_000;
export const SECTION_TITLE_MAX = 80;
export const SECTIONS_MAX = 150;
export const QUESTION_MAX = 1_000;
export const PASTED_TITLE_MAX = 120;
/** The store's body cap; a longer source is cut here and marked truncated. */
export const SOURCE_TEXT_MAX = 200_000;
export const SOURCE_TEXT_MIN = 20;
/** Children one project may hold (passages, sources, questions, answers...). */
export const PROJECT_ITEMS_MAX = 400;

export const COVER_IDS = ["dawn", "olive-path", "heavens", "sanctuary", "parchment", "olive", "dusk"] as const;
export type CoverId = (typeof COVER_IDS)[number];

export function isCoverId(value: unknown): value is CoverId {
	return typeof value === "string" && (COVER_IDS as readonly string[]).includes(value);
}

/** A stable default cover for a title, so two new projects rarely look alike. */
export function defaultCoverFor(title: string): CoverId {
	let hash = 0;
	for (const char of title) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
	return COVER_IDS[hash % COVER_IDS.length];
}

export type ProjectScope = { type: "book"; book: number } | { type: "topic" };

export interface ProjectSection {
	id: string;
	title: string;
	/** A passage key ("45.5") the section reads, or null for a topic section with no passage. */
	ref: string | null;
	done: boolean;
	doneAt: string | null;
}

export interface ProjectCounts {
	passages: number;
	sources: number;
	questions: number;
}

export interface ProjectData {
	v: 1;
	cover: CoverId;
	scope: ProjectScope;
	sections: ProjectSection[];
	archived: boolean;
	archivedAt: string | null;
	/** Kept up to date on every add and remove, so the list never reads a project's children to count them. */
	counts: ProjectCounts;
}

/** What the rules need to know about a book; `books.ts` supplies it. */
export interface BookFacts {
	order: number;
	name: string;
	chapters: number;
}

export type RuleResult<T> = { ok: true; value: T } | { ok: false; error: string };

const SECTION_ID = /^[a-z0-9-]{1,40}$/;
const PASSAGE_KEY = /^(\d{1,2})\.(\d{1,3})(?:\.(\d{1,3}))?$/;

function cleanLine(value: unknown, max: number): string | null {
	if (typeof value !== "string") return null;
	const text = value.trim().replace(/\s+/g, " ");
	return text && text.length <= max ? text : null;
}

/** A section's chapter key ("45.5") names a real chapter of a real book. */
export function isChapterKey(key: string, books: readonly BookFacts[]): boolean {
	const match = /^(\d{1,2})\.(\d{1,3})$/.exec(key);
	if (!match) return false;
	const book = books.find((entry) => entry.order === Number(match[1]));
	const chapter = Number(match[2]);
	return book !== undefined && chapter >= 1 && chapter <= book.chapters;
}

/** One section per chapter: a book study's sections are its chapters. */
export function bookSections(book: BookFacts): ProjectSection[] {
	return Array.from({ length: book.chapters }, (_, index) => ({
		id: `c${index + 1}`,
		title: `${book.name} ${index + 1}`,
		ref: `${book.order}.${index + 1}`,
		done: false,
		doneAt: null,
	}));
}

/** A new section id that is not already taken. */
export function newSectionId(sections: readonly ProjectSection[]): string {
	const taken = new Set(sections.map((section) => section.id));
	for (let n = sections.length + 1; ; n++) {
		const id = `s${n}`;
		if (!taken.has(id)) return id;
	}
}

function parseSection(raw: unknown): ProjectSection | null {
	if (typeof raw !== "object" || raw === null) return null;
	const value = raw as Record<string, unknown>;
	const id = typeof value.id === "string" && SECTION_ID.test(value.id) ? value.id : null;
	const title = cleanLine(value.title, SECTION_TITLE_MAX);
	const ref = value.ref === null || value.ref === undefined ? null : typeof value.ref === "string" && PASSAGE_KEY.test(value.ref) ? value.ref : undefined;
	if (!id || !title || ref === undefined) return null;
	const done = value.done === true;
	const doneAt = done && typeof value.doneAt === "string" ? value.doneAt : null;
	return { id, title, ref, done, doneAt };
}

/**
 * A project's `data` as read back from the store. Anything malformed falls
 * back to a safe default rather than breaking the page, except a missing
 * scope, which means the row is not a project this module wrote.
 */
export function parseProjectData(raw: unknown): ProjectData | null {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
	const value = raw as Record<string, unknown>;
	const scopeRaw = value.scope as Record<string, unknown> | undefined;
	let scope: ProjectScope;
	if (scopeRaw?.type === "book" && Number.isInteger(scopeRaw.book) && (scopeRaw.book as number) >= 1 && (scopeRaw.book as number) <= 66) {
		scope = { type: "book", book: scopeRaw.book as number };
	} else if (scopeRaw?.type === "topic") {
		scope = { type: "topic" };
	} else {
		return null;
	}
	const sections: ProjectSection[] = [];
	const seen = new Set<string>();
	for (const entry of Array.isArray(value.sections) ? value.sections : []) {
		const section = parseSection(entry);
		if (section && !seen.has(section.id)) {
			seen.add(section.id);
			sections.push(section);
		}
	}
	const counts = (value.counts ?? {}) as Record<string, unknown>;
	const count = (n: unknown) => (Number.isInteger(n) && (n as number) >= 0 ? (n as number) : 0);
	return {
		v: 1,
		cover: isCoverId(value.cover) ? value.cover : "parchment",
		scope,
		sections: sections.slice(0, SECTIONS_MAX),
		archived: value.archived === true,
		archivedAt: value.archived === true && typeof value.archivedAt === "string" ? value.archivedAt : null,
		counts: { passages: count(counts.passages), sources: count(counts.sources), questions: count(counts.questions) },
	};
}

export interface ProjectCreateInput {
	title?: unknown;
	description?: unknown;
	cover?: unknown;
	scope?: unknown;
	/** Topic studies may start with named sections ("Conversion", "First journey"). */
	sections?: unknown;
}

export interface ProjectDraft {
	title: string;
	description: string | null;
	data: ProjectData;
}

/** Validate a new project; `books` is the 66 books with their chapter counts. */
export function checkProjectCreate(input: ProjectCreateInput, books: readonly BookFacts[]): RuleResult<ProjectDraft> {
	const scopeRaw = (typeof input.scope === "object" && input.scope !== null ? input.scope : {}) as Record<string, unknown>;
	let scope: ProjectScope;
	let sections: ProjectSection[];
	let book: BookFacts | undefined;
	if (scopeRaw.type === "book") {
		book = books.find((entry) => entry.order === scopeRaw.book);
		if (!book) return { ok: false, error: "Choose a book of the Bible for a book study." };
		scope = { type: "book", book: book.order };
		sections = bookSections(book);
	} else if (scopeRaw.type === "topic" || scopeRaw.type === undefined) {
		scope = { type: "topic" };
		sections = [];
		const titles = Array.isArray(input.sections) ? input.sections : [];
		if (titles.length > SECTIONS_MAX) return { ok: false, error: `A project can have up to ${SECTIONS_MAX} sections.` };
		for (const raw of titles) {
			// A name, or { title, ref } to open the section at a chapter ("44.9").
			const entry: Record<string, unknown> = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : { title: raw };
			const title = cleanLine(entry.title, SECTION_TITLE_MAX);
			if (!title) return { ok: false, error: `Section names must be 1 to ${SECTION_TITLE_MAX} characters.` };
			const ref = entry.ref === undefined || entry.ref === null ? null : typeof entry.ref === "string" && isChapterKey(entry.ref, books) ? entry.ref : undefined;
			if (ref === undefined) return { ok: false, error: "That section's passage is not a Bible reference." };
			sections.push({ id: newSectionId(sections), title, ref, done: false, doneAt: null });
		}
	} else {
		return { ok: false, error: "A project is a book study or a topic study." };
	}
	const title = input.title === undefined || input.title === "" ? (book ? `The Book of ${book.name}` : null) : cleanLine(input.title, PROJECT_TITLE_MAX);
	if (!title) return { ok: false, error: `Give the project a name of up to ${PROJECT_TITLE_MAX} characters.` };
	const description = input.description === undefined || input.description === null ? null : typeof input.description === "string" ? input.description.trim() : undefined;
	if (description === undefined || (description && description.length > PROJECT_DESCRIPTION_MAX)) {
		return { ok: false, error: `Keep the description under ${PROJECT_DESCRIPTION_MAX} characters.` };
	}
	if (input.cover !== undefined && !isCoverId(input.cover)) return { ok: false, error: "Choose one of the covers." };
	const cover = isCoverId(input.cover) ? input.cover : defaultCoverFor(title);
	return {
		ok: true,
		value: { title, description: description || null, data: { v: 1, cover, scope, sections, archived: false, archivedAt: null, counts: { passages: 0, sources: 0, questions: 0 } } },
	};
}

export type SectionChange =
	| { op: "done"; id: string; done: boolean }
	| { op: "add"; title: string; ref?: string | null }
	| { op: "rename"; id: string; title: string }
	| { op: "remove"; id: string };

/** Apply one change to a project's sections. Book chapters can be ticked, not renamed or removed. */
export function applySectionChange(data: ProjectData, change: SectionChange, now: string): RuleResult<ProjectData> {
	const sections = data.sections.map((section) => ({ ...section }));
	const index = "id" in change ? sections.findIndex((section) => section.id === change.id) : -1;
	if ("id" in change && index < 0) return { ok: false, error: "That section is not in this project." };
	switch (change.op) {
		case "done":
			sections[index].done = change.done;
			sections[index].doneAt = change.done ? now : null;
			break;
		case "add": {
			if (data.scope.type === "book") return { ok: false, error: "A book study's sections are its chapters." };
			if (sections.length >= SECTIONS_MAX) return { ok: false, error: `A project can have up to ${SECTIONS_MAX} sections.` };
			const title = cleanLine(change.title, SECTION_TITLE_MAX);
			if (!title) return { ok: false, error: `Section names must be 1 to ${SECTION_TITLE_MAX} characters.` };
			const ref = change.ref ?? null;
			if (ref !== null && !PASSAGE_KEY.test(ref)) return { ok: false, error: "That passage is not a Bible reference." };
			sections.push({ id: newSectionId(sections), title, ref, done: false, doneAt: null });
			break;
		}
		case "rename": {
			if (data.scope.type === "book") return { ok: false, error: "A book study's sections are its chapters." };
			const title = cleanLine(change.title, SECTION_TITLE_MAX);
			if (!title) return { ok: false, error: `Section names must be 1 to ${SECTION_TITLE_MAX} characters.` };
			sections[index].title = title;
			break;
		}
		case "remove":
			if (data.scope.type === "book") return { ok: false, error: "A book study's sections are its chapters." };
			sections.splice(index, 1);
			break;
	}
	return { ok: true, value: { ...data, sections } };
}

export interface ProjectProgress {
	done: number;
	total: number;
	/** 0-100, rounded down so 15 of 16 never reads as 100%. */
	percent: number;
	/** Where "Continue study" goes: the first section not yet done. Null when all are done or there are none. */
	next: ProjectSection | null;
}

export function projectProgress(sections: readonly ProjectSection[]): ProjectProgress {
	const done = sections.filter((section) => section.done).length;
	const total = sections.length;
	return {
		done,
		total,
		percent: total ? Math.floor((done / total) * 100) : 0,
		next: sections.find((section) => !section.done) ?? null,
	};
}

/** The section after this one, for "Mark done and continue". */
export function sectionAfter(sections: readonly ProjectSection[], id: string): ProjectSection | null {
	const index = sections.findIndex((section) => section.id === id);
	if (index < 0) return null;
	return sections.slice(index + 1).find((section) => !section.done) ?? sections.find((section) => !section.done && section.id !== id) ?? null;
}

/** The project's workspace. */
export function projectHref(id: string): string {
	return `/beta/study/projects/${id}`;
}

/** The project's reader: a section, or any chapter (optionally while working a section). */
export function readHref(projectId: string, target: { section?: string; book?: number; chapter?: number }): string {
	const parts: string[] = [];
	if (target.book !== undefined && target.chapter !== undefined) parts.push(`book=${target.book}`, `chapter=${target.chapter}`);
	if (target.section) parts.push(`section=${encodeURIComponent(target.section)}`);
	return `/beta/study/projects/${projectId}/read${parts.length ? `?${parts.join("&")}` : ""}`;
}

/* -------------------------------------------------------------------------
 * Gathered material
 * ---------------------------------------------------------------------- */

/** "Romans 5", "Romans 5:3" or "Romans 5:1-11". */
export function passageLabel(bookName: string, chapter: number, start?: number | null, end?: number | null): string {
	if (!start) return `${bookName} ${chapter}`;
	return end && end > start ? `${bookName} ${chapter}:${start}-${end}` : `${bookName} ${chapter}:${start}`;
}

/** Every verse key a passage covers, in order. */
export function passageVerseKeys(book: number, chapter: number, start: number, end: number): string[] {
	const keys: string[] = [];
	for (let verse = start; verse <= end; verse++) keys.push(`${book}.${chapter}.${verse}`);
	return keys;
}

/** A question as a store item: the title holds up to 200 characters, the body the whole question when longer. */
export function questionItemText(text: unknown): RuleResult<{ title: string; body: string | null }> {
	if (typeof text !== "string") return { ok: false, error: "Write the question first." };
	const question = text.trim().replace(/[ \t]+/g, " ");
	if (!question) return { ok: false, error: "Write the question first." };
	if (question.length > QUESTION_MAX) return { ok: false, error: `Keep a question under ${QUESTION_MAX} characters.` };
	const oneLine = question.replace(/\s+/g, " ");
	if (oneLine.length <= 200) return { ok: true, value: { title: oneLine, body: question === oneLine ? null : question } };
	const cut = oneLine.slice(0, 199);
	const space = cut.lastIndexOf(" ");
	return { ok: true, value: { title: `${(space > 120 ? cut.slice(0, space) : cut).trimEnd()}…`, body: question } };
}

/** Pasted or extracted text, tidied for reading and searching; cut at the store's cap. */
export function normalizeSourceText(raw: string): { text: string; truncated: boolean } {
	const text = raw
		.replace(/\r\n?/g, "\n")
		.replace(/\u0000/g, "")
		.replace(/[ \t\f\v]+/g, " ")
		.replace(/ *\n */g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	if (text.length <= SOURCE_TEXT_MAX) return { text, truncated: false };
	const cut = text.slice(0, SOURCE_TEXT_MAX);
	const lastBreak = Math.max(cut.lastIndexOf("\n"), cut.lastIndexOf(". "));
	return { text: (lastBreak > SOURCE_TEXT_MAX * 0.9 ? cut.slice(0, lastBreak + 1) : cut).trimEnd(), truncated: true };
}

/** The label a new source is cited by ("S5"): one past the highest ever given, so labels never shift. */
export function nextSourceLabel(labels: readonly (string | null | undefined)[]): string {
	const highest = labels.reduce<number>((max, label) => {
		const match = typeof label === "string" ? /^S(\d{1,4})$/.exec(label) : null;
		return match ? Math.max(max, Number(match[1])) : max;
	}, 0);
	return `S${highest + 1}`;
}

/**
 * The labels sources are cited by, given in the order they were added. Each
 * keeps the label it was stored with (one past the highest, so removing a
 * source never shifts the rest); one that clashes with an earlier source's,
 * as when two are added at the same moment, takes the next free number. Only
 * earlier sources decide a label, so adding one never relabels an older one.
 */
export function assignSourceLabels(stored: readonly (string | null | undefined)[]): string[] {
	const used = new Set<string>();
	let highest = 0;
	return stored.map((label, index) => {
		const number = typeof label === "string" ? /^S(\d{1,4})$/.exec(label)?.[1] : undefined;
		let out = number ? `S${Number(number)}` : `S${index + 1}`;
		if (used.has(out)) out = `S${highest + 1}`;
		used.add(out);
		highest = Math.max(highest, Number(out.slice(1)));
		return out;
	});
}

/** A title for an uploaded file: its name without the extension. */
export function titleFromFilename(filename: string): string {
	const base = filename.split(/[\\/]/).pop() ?? filename;
	const title = base.replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
	return (title || "Uploaded source").slice(0, PASTED_TITLE_MAX);
}

/* -------------------------------------------------------------------------
 * Retrieval inside a project
 * ---------------------------------------------------------------------- */

const STOPWORDS = new Set(
	(
		"a an and are as at be but by for from has have he her his i in is it its me my of on or our shall she that the " +
		"their them they this to unto us was we what when who will with you your thou thee thy ye him not no do does did " +
		"how why which where there then than so if into out up about can could would should may might also all any been " +
		"being were said say says tell me explain show verse verses chapter bible scripture paul"
	).split(" "),
);

export function searchTokens(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[‘’]/g, "'")
		.replace(/[^a-z0-9']+/g, " ")
		.split(" ")
		.map((token) => token.replace(/^'+|'+$/g, "").replace(/'s$/, ""))
		.filter((token) => token.length > 2 && !STOPWORDS.has(token));
}

/** Cut a long text into pieces of about `size` characters, on paragraph and sentence breaks. */
export function chunkText(text: string, size = 1_400): string[] {
	const paragraphs = text.split(/\n{2,}|\n(?=[A-Z0-9"“(])/).map((part) => part.trim()).filter(Boolean);
	const chunks: string[] = [];
	let current = "";
	const push = () => {
		if (current.trim()) chunks.push(current.trim());
		current = "";
	};
	for (const paragraph of paragraphs) {
		if (paragraph.length > size) {
			push();
			const sentences = paragraph.match(/[^.!?]+[.!?]+["”']?\s*|[^.!?]+$/g) ?? [paragraph];
			for (const sentence of sentences) {
				if (current.length + sentence.length > size) push();
				if (sentence.length > size) {
					for (let i = 0; i < sentence.length; i += size) chunks.push(sentence.slice(i, i + size).trim());
				} else {
					current += sentence;
				}
			}
			push();
			continue;
		}
		if (current.length + paragraph.length + 2 > size) push();
		current += (current ? "\n\n" : "") + paragraph;
	}
	push();
	return chunks;
}

export interface RankablePiece {
	id: string;
	text: string;
	/** Always kept, whatever the question (the passages a founder gathered). */
	pinned?: boolean;
}

/**
 * The pieces worth sending for one question, best first, within a character
 * budget: pinned pieces, then everything else by rare-word overlap with the
 * question (IDF-weighted, so "propitiation" outweighs "faith"). With no
 * usable words in the question, pieces keep their original order.
 */
export function rankPieces<T extends RankablePiece>(question: string, pieces: readonly T[], budget: number): T[] {
	const tokens = [...new Set(searchTokens(question))];
	const docTokens = pieces.map((piece) => new Set(searchTokens(piece.text)));
	const df = new Map<string, number>();
	for (const token of tokens) df.set(token, docTokens.filter((set) => set.has(token)).length);
	const scored = pieces.map((piece, index) => ({
		piece,
		index,
		score: tokens.reduce((sum, token) => (docTokens[index].has(token) ? sum + Math.log(1 + pieces.length / Math.max(1, df.get(token) ?? 1)) : sum), 0),
	}));
	const pinnedAll = scored.filter((entry) => entry.piece.pinned);
	const pinnedChars = pinnedAll.reduce((sum, entry) => sum + entry.piece.text.length, 0);
	// When the pinned pieces alone overflow the budget, the ones that speak to the question go first.
	const pinned = pinnedChars > budget ? [...pinnedAll].sort((a, b) => b.score - a.score || a.index - b.index) : pinnedAll;
	const rest = scored.filter((entry) => !entry.piece.pinned).sort((a, b) => b.score - a.score || a.index - b.index);
	const out: T[] = [];
	let used = 0;
	for (const entry of [...pinned, ...rest]) {
		if (used + entry.piece.text.length > budget && out.length > 0) {
			if (entry.piece.pinned) continue;
			if (entry.score === 0) break;
			continue;
		}
		out.push(entry.piece);
		used += entry.piece.text.length;
	}
	return out;
}

/* -------------------------------------------------------------------------
 * Checking what the assistant quotes
 * ---------------------------------------------------------------------- */

interface Folded {
	text: string;
	/** Index in the original string of each folded character. */
	map: number[];
}

/** Lowercase letters and digits with single spaces between words, remembering where each came from. */
function fold(source: string): Folded {
	let text = "";
	const map: number[] = [];
	let pendingSpace = false;
	for (let i = 0; i < source.length; i++) {
		const char = source[i].toLowerCase();
		if (/[\p{L}\p{N}]/u.test(char)) {
			if (pendingSpace && text) {
				text += " ";
				map.push(i);
			}
			pendingSpace = false;
			text += char;
			map.push(i);
		} else {
			pendingSpace = true;
		}
	}
	return { text, map };
}

/** Folded characters an ellipsis may skip between two parts of one quotation. */
export const QUOTE_MAX_GAP = 300;

/**
 * Where `quote` appears in `source`, ignoring case, punctuation and spacing,
 * returned as the source's own words; null when it does not appear. An
 * ellipsis splits the quote into parts of at least two words that must each
 * appear, in order, each within QUOTE_MAX_GAP of the one before, so an
 * ellipsis cannot stitch a sentence together out of words scattered across a
 * chapter. Quotes under three words are refused: they prove nothing.
 */
export function findQuote(source: string, quote: string): string | null {
	const parts = quote
		.split(/\.{3}|…/)
		.map((part) => fold(part).text)
		.filter(Boolean);
	if (parts.length === 0 || parts.reduce((words, part) => words + part.split(" ").length, 0) < 3) return null;
	if (parts.length > 1 && parts.some((part) => part.split(" ").length < 2)) return null;
	const haystack = fold(source);
	let from = 0;
	let start = -1;
	let end = -1;
	for (const [index, part] of parts.entries()) {
		let at = haystack.text.indexOf(part, from);
		// Whole words only: "faith" must not match inside "faithful".
		while (at >= 0) {
			const before = at === 0 || haystack.text[at - 1] === " ";
			const afterIndex = at + part.length;
			const after = afterIndex === haystack.text.length || haystack.text[afterIndex] === " ";
			if (before && after) break;
			at = haystack.text.indexOf(part, at + 1);
		}
		if (at < 0) return null;
		// Later parts are searched from the end of the earlier one; too far away is no quotation.
		if (index > 0 && at - from > QUOTE_MAX_GAP) return null;
		if (start < 0) start = at;
		end = at + part.length - 1;
		from = at + part.length;
	}
	const originalStart = haystack.map[start];
	const originalEnd = haystack.map[end];
	return source.slice(originalStart, originalEnd + 1);
}

/**
 * Quotations inside the assistant's own prose (double or single quotes,
 * straight or curly) of at least three words. Every one must be found in the
 * material sent, or the sentence is left out: Scripture and sources are shown
 * from their own text, never from the model's memory.
 */
export function quotedSpans(text: string): string[] {
	const spans: string[] = [];
	// Double quotes straight or curly, and single quotes curly or straight. A
	// closing single quote followed by a letter is an apostrophe (God\u2019s,
	// Lord's), not the end; a straight one opens only after a non-letter.
	const pattern = /[\u201c"]([^\u201c\u201d"]{6,600})[\u201d"]|\u2018([^\u2018]{6,600}?)\u2019(?!\p{L})|(?<![\p{L}\p{N}])'([^'\n]{6,600}?)'(?![\p{L}\p{N}])/gu;
	for (const match of text.matchAll(pattern)) {
		const span = (match[1] ?? match[2] ?? match[3]).trim();
		if (span.split(/\s+/).length >= 3) spans.push(span);
	}
	return spans;
}

/**
 * A source citation's quote must carry at least two meaningful words: "it is
 * the" is in every commentary and proves nothing about the claim beside it.
 */
export function isSubstantialQuote(quote: string): boolean {
	return new Set(searchTokens(quote)).size >= 2;
}

/** True when every quotation in `text` is found, word for word, in `allowed`. */
export function quotesFoundIn(text: string, allowed: string): boolean {
	return quotedSpans(text).every((span) => findQuote(allowed, span) !== null);
}

/* -------------------------------------------------------------------------
 * Writing a study out
 * ---------------------------------------------------------------------- */

export interface ResolvedVerse {
	reference: string;
	text: string;
}

export type ResolvedCitation =
	| { type: "verse"; reference: string; href: string; verses: ResolvedVerse[] }
	| { type: "source"; sourceId: string; label: string; title: string; quote: string };

export type ClaimBasis = "scripture" | "interpretation" | "source";

export interface StudyPoint {
	text: string;
	basis: ClaimBasis;
	citations: ResolvedCitation[];
}

export interface StudySection {
	heading: string;
	points: StudyPoint[];
}

export interface AssembledStudy {
	mode: "outline" | "study";
	title: string;
	intro: string;
	sections: StudySection[];
}

/** Verses quoted under one citation: a written study carries more of the text than an outline. */
const VERSES_QUOTED = { outline: 3, study: 6 } as const;

function citationLabel(citation: ResolvedCitation): string {
	return citation.type === "verse" ? citation.reference : citation.title;
}

/** "Romans 2:1-3" for the verses actually quoted, from their own references. */
export function quotedRange(verses: readonly ResolvedVerse[]): string | null {
	if (verses.length === 0) return null;
	const first = verses[0].reference;
	const last = verses[verses.length - 1].reference.split(":").pop();
	return verses.length === 1 ? first : `${first}-${last}`;
}

function quoteBlock(citation: ResolvedCitation, indent: string, max: number): string[] {
	if (citation.type === "verse") {
		const verses = citation.verses.slice(0, max);
		const shown = quotedRange(verses);
		if (!shown) return [];
		const lines = verses.map((verse) => `${indent}> ${verse.text}`);
		// A long citation is quoted in part, and says so rather than labelling a part as the whole.
		const label = shown === citation.reference ? `${shown}, KJV` : `${shown}, KJV; the passage runs ${citation.reference}`;
		return [...lines, `${indent}> (${label})`];
	}
	return [`${indent}> ${citation.quote}`, `${indent}> (${citation.title})`];
}

/**
 * The study as Markdown, for "Copy as Markdown" and for saving as a Note.
 * Scripture appears only as the bundled KJV text each citation carries;
 * interpretation is labelled as such.
 */
export function studyMarkdown(study: AssembledStudy): string {
	const lines: string[] = [`# ${study.title}`, ""];
	if (study.intro) lines.push(study.intro, "");
	for (const section of study.sections) {
		lines.push(`## ${section.heading}`, "");
		for (const point of section.points) {
			const refs = point.citations.map(citationLabel);
			const label = point.basis === "interpretation" ? "*Interpretation:* " : "";
			const tail = refs.length ? ` (${refs.join("; ")})` : "";
			if (study.mode === "outline") {
				lines.push(`- ${label}${point.text}${tail}`);
				for (const citation of point.citations) lines.push(...quoteBlock(citation, "  ", VERSES_QUOTED.outline));
			} else {
				lines.push(`${label}${point.text}${tail}`, "");
				for (const citation of point.citations) lines.push(...quoteBlock(citation, "", VERSES_QUOTED.study), "");
			}
		}
		lines.push("");
	}
	lines.push("*Assembled in SureWord Study Projects. Scripture quoted from the King James Version.*");
	return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

/** Plain text a person can search, for an item's `body`. */
export function studyPlainText(study: AssembledStudy): string {
	const lines: string[] = [study.title];
	if (study.intro) lines.push(study.intro);
	for (const section of study.sections) {
		lines.push(section.heading);
		for (const point of section.points) {
			const refs = point.citations.map(citationLabel);
			lines.push(`${point.text}${refs.length ? ` (${refs.join("; ")})` : ""}`);
		}
	}
	return lines.join("\n");
}

/* -------------------------------------------------------------------------
 * Refs and topics for the Knowledge Vault and the Living Study Graph
 * ---------------------------------------------------------------------- */

/**
 * Whole-chapter references written in prose ("Matthew Henry on Romans 5",
 * "in 1 John 4 we read"), which the chat's verse detector skips because it
 * needs a verse. Candidates only: `projects.ts` keeps the ones
 * `resolveReference` accepts as a real book and chapter.
 */
export function chapterReferenceCandidates(text: string, max = 200): string[] {
	const out: string[] = [];
	for (const match of text.matchAll(/\b((?:[123]\s?)?[A-Z][a-z]+(?: of [A-Z][a-z]+)?)\s+(\d{1,3})\b(?![:.]\d)/g)) {
		out.push(`${match[1]} ${match[2]}`);
		if (out.length >= max) break;
	}
	return out;
}

/** The project's topics that a text actually names, as whole words, case-insensitively. */
export function topicsInText(text: string, topics: readonly string[]): string[] {
	const haystack = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ")} `;
	return topics.filter((topic) => {
		const needle = topic.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
		return needle.length > 0 && haystack.includes(` ${needle} `);
	});
}

/** How many answers and assembled drafts a project keeps; older ones are let go. */
export const ANSWERS_KEPT = 60;
export const STUDIES_KEPT = 20;

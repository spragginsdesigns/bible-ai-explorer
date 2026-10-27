/**
 * Pure rules for SureWord Groups (LC-17656, docs/beta/groups.md): a small
 * group or Bible class kept in a Study Room of purpose "group", with a week's
 * passage, discussion questions a leader prepares, guided sessions and a
 * prayer circle, all stored as the room's posts under module "groups".
 *
 * Who may do what, what each post may hold, the passage keys and topics every
 * object carries, the check that keeps SureWord's drafted questions to the
 * words of the KJV, and the views: allowlists of exactly what one member sees
 * of another. A member's account id, private plan, notes and prayer list never
 * appear in any view, whatever the rows carry.
 *
 * No imports on purpose: tests/beta-groups.test.mjs loads this file with
 * Node's type stripping, which cannot resolve `@/` paths.
 */

export const GROUPS_MODULE = "groups";

/** Rooms' roles (rooms-rules.ts): the owner started the group; leaders lead it with them. */
export type GroupRole = "owner" | "leader" | "member";

export type GroupPostKind = "week" | "question" | "reply" | "session" | "prayer" | "prayed";
export const GROUP_POST_KINDS: readonly GroupPostKind[] = ["week", "question", "reply", "session", "prayer", "prayed"];

/** The three movements of an inductive discussion. "Interpret" questions are labelled as interpretation. */
export type QuestionType = "observe" | "interpret" | "apply";
export const QUESTION_TYPES: readonly QuestionType[] = ["observe", "interpret", "apply"];
export const QUESTION_TYPE_LABEL: Readonly<Record<QuestionType, string>> = { observe: "Observe", interpret: "Interpretation", apply: "Apply" };

/** The guided session, in order: read the passage, observe, discuss the questions, pray. */
export type SessionStep = "read" | "observe" | "discuss" | "pray";
export const SESSION_STEPS: readonly SessionStep[] = ["read", "observe", "discuss", "pray"];
export const SESSION_STEP_LABEL: Readonly<Record<SessionStep, string>> = { read: "Read", observe: "Observe", discuss: "Discuss", pray: "Pray" };

export const GROUP_QUESTION_MAX = 600;
export const GROUP_REPLY_MAX = 2000;
export const PRAYER_MAX = 1000;
export const PRAYER_ANSWER_MAX = 600;
export const SESSION_NOTE_MAX = 4000;
/** Themes a leader gives a week, and topics SureWord may add. */
export const WEEK_THEMES_MAX = 5;
export const TOPIC_MAX_LENGTH = 60;
export const QUESTIONS_PER_WEEK_MAX = 15;
/** How many times a leader may ask SureWord to prepare one week's questions. */
export const PREPARE_PER_WEEK_MAX = 3;
/** Drafts SureWord's preparation keeps, after the checks. */
export const PREPARED_QUESTIONS_MAX = 9;
export const PREPARED_QUESTIONS_MIN = 3;
export const LEADER_NOTE_MAX = 900;
export const PLAN_WEEK_DAYS = 7;

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

/** A passage inside one chapter, as Study Rooms stores it (rooms-rules.ts RoomPassage). */
export interface GroupPassage {
	book: number;
	chapter: number;
	verseStart?: number;
	verseEnd?: number;
}

// ---------------------------------------------------------------------------
// Who may do what
// ---------------------------------------------------------------------------

export interface GroupViewer {
	userId: string;
	role: GroupRole;
}

export function isLeader(role: GroupRole): boolean {
	return role === "owner" || role === "leader";
}

/**
 * Removing a post: a week, a question or a session is the group's material,
 * which its leaders manage; a reply or a prayer request is its author's, which
 * leaders may still take down. A "prayed" mark is only ever undone by its own
 * member, through the prayer's toggle.
 */
export function canDeleteGroupPost(post: { kind: GroupPostKind; authorId: string }, viewer: GroupViewer): boolean {
	if (post.kind === "prayed") return false;
	if (post.kind === "reply" || post.kind === "prayer") return post.authorId === viewer.userId || isLeader(viewer.role);
	return isLeader(viewer.role);
}

/** Only the leader who started a session keeps its notes, and only while they still lead. */
export function canEditSession(session: { authorId: string }, viewer: GroupViewer): boolean {
	return session.authorId === viewer.userId && isLeader(viewer.role);
}

/** Others mark that they prayed; the one who asked marks it answered. */
export function canMarkPrayed(prayer: { authorId: string }, viewer: GroupViewer): boolean {
	return prayer.authorId !== viewer.userId;
}

export function canAnswerPrayer(prayer: { authorId: string }, viewer: GroupViewer): boolean {
	return prayer.authorId === viewer.userId;
}

// ---------------------------------------------------------------------------
// The group reading plan, by week
// ---------------------------------------------------------------------------

/** The plan week a plan day falls in: days 1-7 are week 1. */
export function planWeekOf(day: number): number {
	return Math.max(1, Math.ceil(day / PLAN_WEEK_DAYS));
}

/** A plan's days in weeks of seven, the last one shorter when the plan is. */
export function planWeeks<T>(days: readonly T[]): { week: number; firstDay: number; lastDay: number; days: T[] }[] {
	const weeks: { week: number; firstDay: number; lastDay: number; days: T[] }[] = [];
	for (let start = 0; start < days.length; start += PLAN_WEEK_DAYS) {
		const slice = days.slice(start, start + PLAN_WEEK_DAYS);
		weeks.push({ week: weeks.length + 1, firstDay: start + 1, lastDay: start + slice.length, days: slice });
	}
	return weeks;
}

// ---------------------------------------------------------------------------
// Passage keys and topics: what lets the Knowledge Vault and the Living Study
// Graph find a member's own contributions (docs/beta/README.md, the store)
// ---------------------------------------------------------------------------

/** Store-shaped passage keys: the chapter's key, then each verse's ("59.1", "59.1.19", ...). */
export function passageRefs(passage: GroupPassage): string[] {
	const chapter = `${passage.book}.${passage.chapter}`;
	if (passage.verseStart === undefined) return [chapter];
	const end = passage.verseEnd ?? passage.verseStart;
	const refs = [chapter];
	for (let verse = passage.verseStart; verse <= end; verse++) refs.push(`${chapter}.${verse}`);
	return refs;
}

/** A question's keys: the verses it rests on, or the whole passage when it names none. */
export function questionRefs(passage: GroupPassage, verses: readonly number[]): string[] {
	if (verses.length === 0) return passageRefs(passage);
	return [`${passage.book}.${passage.chapter}`, ...[...new Set(verses)].sort((a, b) => a - b).map((verse) => `${passage.book}.${passage.chapter}.${verse}`)];
}

/** Lowercase, single-spaced, de-duplicated labels; unusable ones are dropped, not fatal. */
export function cleanTopics(values: unknown, max: number = WEEK_THEMES_MAX): string[] {
	if (!Array.isArray(values)) return [];
	const out: string[] = [];
	for (const value of values) {
		if (typeof value !== "string") continue;
		const label = value.replace(/\s+/g, " ").trim().toLowerCase().replace(/^#/, "");
		if (!label || label.length > TOPIC_MAX_LENGTH || out.includes(label)) continue;
		out.push(label);
		if (out.length >= max) break;
	}
	return out;
}

/** "anger, listening; the tongue" -> ["anger", "listening", "the tongue"]. */
export function parseThemes(value: unknown): string[] {
	return typeof value === "string" ? cleanTopics(value.split(/[,;\n]/)) : [];
}

/** The passage's verse numbers, first to last. */
export function passageVerseRange(passage: GroupPassage, versesInChapter: number): { first: number; last: number } {
	if (passage.verseStart === undefined) return { first: 1, last: versesInChapter };
	return { first: passage.verseStart, last: Math.min(passage.verseEnd ?? passage.verseStart, versesInChapter) };
}

// ---------------------------------------------------------------------------
// What each kind of post may hold
// ---------------------------------------------------------------------------

/** One line: trimmed, inner whitespace collapsed. Null when empty or too long. */
export function cleanLine(value: unknown, max: number): string | null {
	if (typeof value !== "string") return null;
	const text = value.replace(/\s+/g, " ").trim();
	return text && text.length <= max ? text : null;
}

/** Prose: line endings unified, trailing spaces and runs of blank lines removed. Null when empty or too long. */
export function cleanText(value: unknown, max: number): string | null {
	if (typeof value !== "string") return null;
	const text = value
		.replace(/\r\n?/g, "\n")
		.replace(/[ \t]+$/gm, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	return text && text.length <= max ? text : null;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

export function isGroupId(value: unknown): value is string {
	return typeof value === "string" && ID_PATTERN.test(value);
}

export type GroupPostInput =
	| { kind: "week"; reference: string; themes: string[] }
	| { kind: "question"; parentId: string; draft: number }
	| { kind: "question"; parentId: string; text: string; type: QuestionType; verses: number[] }
	| { kind: "reply"; parentId: string; body: string }
	| { kind: "session"; parentId: string }
	| { kind: "prayer"; body: string; reference: string | null }
	| { kind: "prayer"; memoryId: string };

function record(input: unknown): Record<string, unknown> | null {
	return typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : null;
}

/** Shape and length checks; the server then resolves the passage, the parent and any private prayer. */
export function checkGroupPost(input: unknown): Checked<GroupPostInput> {
	const raw = record(input);
	if (!raw) return { ok: false, error: "Send a post." };
	const kind = raw.kind;
	const parentId = raw.parentId === undefined || raw.parentId === null ? null : isGroupId(raw.parentId) ? raw.parentId : undefined;
	if (parentId === undefined) return { ok: false, error: "Unknown post." };
	const needsParent = kind === "question" || kind === "reply" || kind === "session";
	if (needsParent && parentId === null) return { ok: false, error: kind === "reply" ? "A reply needs the question it answers." : "Which week is this for?" };
	if (!needsParent && parentId !== null) return { ok: false, error: "Only a question, a reply or a session belongs under another post." };

	switch (kind) {
		case "week": {
			const reference = cleanLine(raw.reference, 60);
			if (!reference) return { ok: false, error: "Which passage is the group reading? For example James 1:19-27." };
			if (raw.themes !== undefined && typeof raw.themes !== "string") return { ok: false, error: "Themes are a short line, like anger, listening." };
			return { ok: true, value: { kind, reference, themes: parseThemes(raw.themes) } };
		}
		case "question": {
			if (raw.draft !== undefined) {
				if (!Number.isInteger(raw.draft) || (raw.draft as number) < 0 || (raw.draft as number) >= PREPARED_QUESTIONS_MAX) return { ok: false, error: "Unknown prepared question." };
				return { ok: true, value: { kind, parentId: parentId as string, draft: raw.draft as number } };
			}
			const text = cleanLine(raw.text, GROUP_QUESTION_MAX);
			if (!text) return { ok: false, error: typeof raw.text === "string" && raw.text.trim() ? `Keep a question under ${GROUP_QUESTION_MAX} characters.` : "Write the question." };
			const type = raw.type === undefined ? "interpret" : raw.type;
			if (typeof type !== "string" || !(QUESTION_TYPES as readonly string[]).includes(type)) return { ok: false, error: "type must be observe, interpret or apply." };
			const verses = raw.verses === undefined || raw.verses === null ? [] : raw.verses;
			if (!Array.isArray(verses) || verses.length > 20 || !verses.every((verse) => Number.isInteger(verse) && verse >= 1 && verse <= 200)) {
				return { ok: false, error: "verses must be verse numbers." };
			}
			return { ok: true, value: { kind, parentId: parentId as string, text, type: type as QuestionType, verses: [...new Set(verses as number[])].sort((a, b) => a - b) } };
		}
		case "reply": {
			const body = cleanText(raw.body, GROUP_REPLY_MAX);
			if (!body) return { ok: false, error: typeof raw.body === "string" && raw.body.trim() ? `Keep a reply under ${GROUP_REPLY_MAX.toLocaleString("en-US")} characters.` : "Write a reply." };
			return { ok: true, value: { kind, parentId: parentId as string, body } };
		}
		case "session":
			return { ok: true, value: { kind, parentId: parentId as string } };
		case "prayer": {
			if (raw.memoryId !== undefined && raw.memoryId !== null) {
				if (!isGroupId(raw.memoryId)) return { ok: false, error: "Unknown prayer request." };
				if ((typeof raw.body === "string" && raw.body.trim()) || raw.reference) return { ok: false, error: "A request shared from your prayer list is copied as it is." };
				return { ok: true, value: { kind, memoryId: raw.memoryId } };
			}
			const body = cleanText(raw.body, PRAYER_MAX);
			if (!body) return { ok: false, error: typeof raw.body === "string" && raw.body.trim() ? `Keep a request under ${PRAYER_MAX.toLocaleString("en-US")} characters.` : "Write the prayer request." };
			const reference = raw.reference === undefined || raw.reference === null || raw.reference === "" ? null : cleanLine(raw.reference, 60);
			if (reference === null && typeof raw.reference === "string" && raw.reference.trim()) return { ok: false, error: "That passage reference is too long." };
			return { ok: true, value: { kind, body, reference } };
		}
		default:
			return { ok: false, error: "kind must be week, question, reply, session or prayer." };
	}
}

export interface SessionPatch {
	step?: number;
	notes?: Partial<Record<SessionStep, string>>;
	end?: true;
}

export function checkSessionPatch(input: unknown): Checked<SessionPatch> {
	const raw = record(input);
	if (!raw) return { ok: false, error: "Send the session's changes." };
	const patch: SessionPatch = {};
	if (raw.step !== undefined) {
		if (!Number.isInteger(raw.step) || (raw.step as number) < 0 || (raw.step as number) >= SESSION_STEPS.length) return { ok: false, error: "Unknown step." };
		patch.step = raw.step as number;
	}
	if (raw.notes !== undefined) {
		const notes = record(raw.notes);
		if (!notes) return { ok: false, error: "notes must name the steps." };
		const out: Partial<Record<SessionStep, string>> = {};
		for (const [key, value] of Object.entries(notes)) {
			if (!(SESSION_STEPS as readonly string[]).includes(key)) return { ok: false, error: "Unknown step." };
			if (typeof value !== "string") return { ok: false, error: "A note is text." };
			const text = value.trim() ? cleanText(value, SESSION_NOTE_MAX) : "";
			if (text === null) return { ok: false, error: `Keep each step's notes under ${SESSION_NOTE_MAX.toLocaleString("en-US")} characters.` };
			out[key as SessionStep] = text;
		}
		patch.notes = out;
	}
	if (raw.end !== undefined) {
		if (raw.end !== true) return { ok: false, error: "end must be true." };
		patch.end = true;
	}
	if (Object.keys(patch).length === 0) return { ok: false, error: "Send the session's changes." };
	return { ok: true, value: patch };
}

export type PrayerPatch = { prayed: boolean } | { answered: true; answer: string | null } | { answered: false };

export function checkPrayerPatch(input: unknown): Checked<PrayerPatch> {
	const raw = record(input);
	if (!raw) return { ok: false, error: "Send the change." };
	if (typeof raw.prayed === "boolean" && raw.answered === undefined) return { ok: true, value: { prayed: raw.prayed } };
	if (raw.answered === true && raw.prayed === undefined) {
		const blank = raw.answer === undefined || raw.answer === null || (typeof raw.answer === "string" && !raw.answer.trim());
		const answer = blank ? null : cleanText(raw.answer, PRAYER_ANSWER_MAX);
		if (!blank && answer === null) return { ok: false, error: `Keep it under ${PRAYER_ANSWER_MAX} characters.` };
		return { ok: true, value: { answered: true, answer } };
	}
	if (raw.answered === false && raw.prayed === undefined && raw.answer === undefined) return { ok: true, value: { answered: false } };
	return { ok: false, error: "Send prayed, or answered." };
}

// ---------------------------------------------------------------------------
// SureWord's prepared questions: Scripture is quoted from the KJV, or not at all
// ---------------------------------------------------------------------------

export interface DraftQuestion {
	type: QuestionType;
	text: string;
	/** Verse numbers inside the week's passage; empty means the whole passage. */
	verses: number[];
}

export interface PreparedQuestions {
	questions: DraftQuestion[];
	/** Background for the leader. Interpretation, labelled as SureWord's, never shown as Scripture. */
	leaderNote: string | null;
	topics: string[];
	model: string;
	generatedAt: string;
}

/** Lowercase letters and digits only, single-spaced, so a quotation matches the verse however it is punctuated. */
export function normalizeForQuote(text: string): string {
	return text
		.toLowerCase()
		.replace(/[’‘]/g, "'")
		.replace(/[^a-z0-9' ]+/g, " ")
		.replace(/'/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

/** What a text puts in quotation marks: "straight", “curly” or ‘curly single’ (a straight ' is an apostrophe). */
export function quotedSpans(text: string): string[] {
	const spans: string[] = [];
	for (const match of text.matchAll(/"([^"]+)"|“([^”]+)”|‘([^’]+)’/g)) {
		const span = (match[1] ?? match[2] ?? match[3] ?? "").trim();
		if (/[a-z0-9]/i.test(span)) spans.push(span);
	}
	return spans;
}

/** True when every quotation in `text` is word for word in the passage's KJV text. */
export function quotesAreFromPassage(text: string, passageText: string): boolean {
	const haystack = ` ${normalizeForQuote(passageText)} `;
	return quotedSpans(text).every((span) => {
		const needle = normalizeForQuote(span);
		return needle !== "" && haystack.includes(` ${needle} `);
	});
}

/**
 * Keeps only drafts that hold up: a known movement, a question of a sensible
 * length, verses inside the passage, and any quotation word for word from the
 * passage's KJV text (the model never supplies Scripture's words). The note
 * for the leader is dropped, not rewritten, when it misquotes. Null when too
 * few questions survive to be worth showing.
 */
export function checkPreparedDraft(
	raw: { questions: readonly { type: string; text: string; verses: readonly number[] }[]; leaderNote: string | null; topics: readonly string[] },
	passage: { first: number; last: number; text: string },
): { questions: DraftQuestion[]; leaderNote: string | null; topics: string[]; dropped: string[] } | null {
	const dropped: string[] = [];
	const questions: DraftQuestion[] = [];
	const seen = new Set<string>();
	for (const draft of raw.questions) {
		if (!(QUESTION_TYPES as readonly string[]).includes(draft.type)) {
			dropped.push("type");
			continue;
		}
		const text = cleanLine(draft.text, GROUP_QUESTION_MAX);
		if (!text || text.length < 12) {
			dropped.push("length");
			continue;
		}
		const verses = [...new Set(draft.verses)].filter((verse) => Number.isInteger(verse)).sort((a, b) => a - b);
		if (verses.some((verse) => verse < passage.first || verse > passage.last)) {
			dropped.push("verses");
			continue;
		}
		if (!quotesAreFromPassage(text, passage.text)) {
			dropped.push("quote");
			continue;
		}
		const key = normalizeForQuote(text);
		if (seen.has(key)) {
			dropped.push("duplicate");
			continue;
		}
		seen.add(key);
		questions.push({ type: draft.type as QuestionType, text, verses });
	}
	if (questions.length < PREPARED_QUESTIONS_MIN) return null;
	const note = raw.leaderNote ? cleanText(raw.leaderNote, LEADER_NOTE_MAX) : null;
	const leaderNote = note && quotesAreFromPassage(note, passage.text) ? note : null;
	if (note && !leaderNote) dropped.push("note_quote");
	// Observe, then interpret, then apply: the order a group walks through a passage.
	const order = (type: QuestionType) => QUESTION_TYPES.indexOf(type);
	const sorted = questions.map((question, index) => ({ question, index })).sort((a, b) => order(a.question.type) - order(b.question.type) || a.index - b.index);
	return { questions: sorted.slice(0, PREPARED_QUESTIONS_MAX).map(({ question }) => question), leaderNote, topics: cleanTopics(raw.topics, 4), dropped };
}

// ---------------------------------------------------------------------------
// Reading stored data back (tolerant: a malformed field reads as absent)
// ---------------------------------------------------------------------------

function strings(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function numbers(value: unknown): number[] {
	return Array.isArray(value) ? value.filter((entry): entry is number => Number.isInteger(entry)) : [];
}

function storedPassageOf(value: unknown): GroupPassage | null {
	const p = record(value);
	if (!p || !Number.isInteger(p.book) || !Number.isInteger(p.chapter)) return null;
	const out: GroupPassage = { book: p.book as number, chapter: p.chapter as number };
	if (Number.isInteger(p.verseStart)) out.verseStart = p.verseStart as number;
	if (Number.isInteger(p.verseEnd)) out.verseEnd = p.verseEnd as number;
	return out;
}

export interface WeekData {
	passage: GroupPassage | null;
	refs: string[];
	topics: string[];
	planWeek: number | null;
	/** The member id of the leader who set it up. */
	setBy: string | null;
	prep: PreparedQuestions | null;
	prepared: number;
}

export function readWeekData(data: unknown): WeekData {
	const d = record(data) ?? {};
	const prep = record(d.prep);
	return {
		passage: storedPassageOf(d.passage),
		refs: strings(d.refs),
		topics: strings(d.topics),
		planWeek: Number.isInteger(d.planWeek) ? (d.planWeek as number) : null,
		setBy: typeof d.setBy === "string" ? d.setBy : null,
		prep: prep
			? {
					questions: (Array.isArray(prep.questions) ? prep.questions : [])
						.map((q) => record(q))
						.filter((q): q is Record<string, unknown> => q !== null && typeof q.text === "string" && (QUESTION_TYPES as readonly string[]).includes(q.type as string))
						.map((q) => ({ type: q.type as QuestionType, text: q.text as string, verses: numbers(q.verses) })),
					leaderNote: typeof prep.leaderNote === "string" ? prep.leaderNote : null,
					topics: strings(prep.topics),
					model: typeof prep.model === "string" ? prep.model : "",
					generatedAt: typeof prep.generatedAt === "string" ? prep.generatedAt : "",
				}
			: null,
		prepared: Number.isInteger(d.prepared) ? (d.prepared as number) : 0,
	};
}

export interface QuestionData {
	refs: string[];
	topics: string[];
	type: QuestionType;
	verses: number[];
	prepared: boolean;
	mirrorId: string | null;
}

export function readQuestionData(data: unknown): QuestionData {
	const d = record(data) ?? {};
	return {
		refs: strings(d.refs),
		topics: strings(d.topics),
		type: (QUESTION_TYPES as readonly string[]).includes(d.type as string) ? (d.type as QuestionType) : "interpret",
		verses: numbers(d.verses),
		prepared: d.prepared === true,
		mirrorId: typeof d.mirrorId === "string" ? d.mirrorId : null,
	};
}

export interface SessionData {
	refs: string[];
	topics: string[];
	step: number;
	notes: Record<SessionStep, string>;
	endedAt: string | null;
	mirrorId: string | null;
}

export function readSessionData(data: unknown): SessionData {
	const d = record(data) ?? {};
	const notes = record(d.notes) ?? {};
	const step = Number.isInteger(d.step) ? Math.min(Math.max(d.step as number, 0), SESSION_STEPS.length - 1) : 0;
	return {
		refs: strings(d.refs),
		topics: strings(d.topics),
		step,
		notes: Object.fromEntries(SESSION_STEPS.map((key) => [key, typeof notes[key] === "string" ? (notes[key] as string) : ""])) as Record<SessionStep, string>,
		endedAt: typeof d.endedAt === "string" ? d.endedAt : null,
		mirrorId: typeof d.mirrorId === "string" ? d.mirrorId : null,
	};
}

export interface PrayerData {
	refs: string[];
	topics: string[];
	passage: GroupPassage | null;
	fromPrivateList: boolean;
	answeredAt: string | null;
	answer: string | null;
	mirrorId: string | null;
}

export function readPrayerData(data: unknown): PrayerData {
	const d = record(data) ?? {};
	return {
		refs: strings(d.refs),
		topics: strings(d.topics),
		passage: storedPassageOf(d.passage),
		fromPrivateList: d.fromPrivateList === true,
		answeredAt: typeof d.answeredAt === "string" ? d.answeredAt : null,
		answer: typeof d.answer === "string" ? d.answer : null,
		mirrorId: typeof d.mirrorId === "string" ? d.mirrorId : null,
	};
}

export function mirrorIdOf(data: unknown): string | null {
	const d = record(data);
	return d && typeof d.mirrorId === "string" ? d.mirrorId : null;
}

/** A session's notes as one searchable text, step by step. */
export function sessionNotesText(notes: Record<SessionStep, string>): string {
	return SESSION_STEPS.filter((step) => notes[step].trim())
		.map((step) => `${SESSION_STEP_LABEL[step]}\n${notes[step].trim()}`)
		.join("\n\n");
}

// ---------------------------------------------------------------------------
// Views: allowlists of what a member may see
// ---------------------------------------------------------------------------

/** Who wrote something, as the group sees them: their name in the group and their role, never their account. */
export interface GroupPersonView {
	memberId: string | null;
	displayName: string;
	role: GroupRole;
	isYou: boolean;
}

export function personView(
	member: { id: string; userId: string; role: GroupRole; displayName: string } | undefined,
	viewer: GroupViewer,
	fallback = "A former member",
): GroupPersonView {
	if (!member) return { memberId: null, displayName: fallback, role: "member", isYou: false };
	return { memberId: member.id, displayName: member.displayName, role: member.role, isYou: member.userId === viewer.userId };
}

export interface VerseView {
	verse: number;
	text: string;
}

export interface GroupReplyView {
	id: string;
	body: string;
	author: GroupPersonView;
	createdAt: string;
	canDelete: boolean;
}

export interface GroupQuestionView {
	id: string;
	type: QuestionType;
	text: string;
	/** The verses it rests on, from the bundled KJV. */
	verses: VerseView[];
	/** Taken as SureWord prepared it. */
	prepared: boolean;
	author: GroupPersonView;
	createdAt: string;
	canDelete: boolean;
	replies: GroupReplyView[];
}

export interface GroupSessionView {
	id: string;
	step: number;
	done: boolean;
	notes: Record<SessionStep, string>;
	leader: GroupPersonView;
	canEdit: boolean;
	canDelete: boolean;
	startedAt: string;
	endedAt: string | null;
}

export interface GroupPrayerView {
	id: string;
	body: string;
	author: GroupPersonView;
	createdAt: string;
	/** A copy its author chose to share from their own prayer list. */
	fromPrivateList: boolean;
	passage: { reference: string; href: string } | null;
	answered: { at: string; note: string | null } | null;
	prayedBy: GroupPersonView[];
	youPrayed: boolean;
	canPray: boolean;
	canAnswer: boolean;
	canDelete: boolean;
}

interface Row {
	id: string;
	kind: string;
	authorId: string;
	parentId: string | null;
	body: string;
	data: unknown;
	createdAt: Date | string;
}

const iso = (date: Date | string) => new Date(date).toISOString();

export function replyView(row: Row, author: GroupPersonView, viewer: GroupViewer): GroupReplyView {
	return { id: row.id, body: row.body, author, createdAt: iso(row.createdAt), canDelete: canDeleteGroupPost({ kind: "reply", authorId: row.authorId }, viewer) };
}

export function questionView(row: Row, author: GroupPersonView, viewer: GroupViewer, verses: VerseView[], replies: GroupReplyView[]): GroupQuestionView {
	const data = readQuestionData(row.data);
	return {
		id: row.id,
		type: data.type,
		text: row.body,
		verses,
		prepared: data.prepared,
		author,
		createdAt: iso(row.createdAt),
		canDelete: canDeleteGroupPost({ kind: "question", authorId: row.authorId }, viewer),
		replies,
	};
}

export function sessionView(row: Row, leader: GroupPersonView, viewer: GroupViewer): GroupSessionView {
	const data = readSessionData(row.data);
	return {
		id: row.id,
		step: data.step,
		done: data.endedAt !== null,
		notes: data.notes,
		leader,
		canEdit: canEditSession(row, viewer),
		canDelete: canDeleteGroupPost({ kind: "session", authorId: row.authorId }, viewer),
		startedAt: iso(row.createdAt),
		endedAt: data.endedAt,
	};
}

export function prayerView(
	row: Row,
	author: GroupPersonView,
	viewer: GroupViewer,
	prayed: { authorId: string; person: GroupPersonView }[],
	passage: { reference: string; href: string } | null,
): GroupPrayerView {
	const data = readPrayerData(row.data);
	// One mark per member, however many rows a double tap left behind.
	const byMember = new Map<string, GroupPersonView>();
	for (const mark of prayed) if (!byMember.has(mark.authorId)) byMember.set(mark.authorId, mark.person);
	return {
		id: row.id,
		body: row.body,
		author,
		createdAt: iso(row.createdAt),
		fromPrivateList: data.fromPrivateList,
		passage,
		answered: data.answeredAt ? { at: data.answeredAt, note: data.answer } : null,
		prayedBy: [...byMember.values()],
		youPrayed: byMember.has(viewer.userId),
		canPray: canMarkPrayed(row, viewer) && !data.answeredAt,
		canAnswer: canAnswerPrayer(row, viewer),
		canDelete: canDeleteGroupPost({ kind: "prayer", authorId: row.authorId }, viewer),
	};
}

/** Open requests first, newest first; then answered ones, most recently answered first. */
export function sortPrayers(prayers: readonly GroupPrayerView[]): GroupPrayerView[] {
	return [...prayers].sort((a, b) => {
		if (!a.answered !== !b.answered) return a.answered ? 1 : -1;
		if (a.answered && b.answered) return b.answered.at.localeCompare(a.answered.at);
		return b.createdAt.localeCompare(a.createdAt);
	});
}

/**
 * Pure rules for SureWord Beta's Socratic Tutor (LC-17650, docs/beta/tutor.md):
 * the shape of a session, how it moves from observation to interpretation to
 * application and a checked conclusion, when the level adapts, and how a
 * session becomes a note and a searchable transcript.
 *
 * No imports on purpose: `tests/beta-tutor.test.mjs` loads this file with
 * Node's type stripping, which cannot resolve `@/` paths. The server half,
 * which talks to the model, the Bible text and the study store, is `tutor.ts`.
 */

export const TUTOR_MODULE = "tutor";
export const TUTOR_SESSION_KIND = "session";
export const TUTOR_DATA_VERSION = 1;

export const TUTOR_LEVELS = ["beginner", "growing", "deep"] as const;
export type TutorLevel = (typeof TUTOR_LEVELS)[number];

export const TUTOR_LEVEL_LABEL: Record<TutorLevel, string> = {
	beginner: "Beginner",
	growing: "Growing",
	deep: "Deep study",
};

export const TUTOR_LEVEL_BLURB: Record<TutorLevel, string> = {
	beginner: "What the verses plainly say, in everyday words, with generous hints",
	growing: "Trace the argument and how the chapter before sets it up",
	deep: "Context, cross-references and key words, and the evidence for every answer",
};

export const TUTOR_STAGES = ["observation", "interpretation", "application", "conclusion"] as const;
export type TutorStage = (typeof TUTOR_STAGES)[number];
type QuestionStage = Exclude<TutorStage, "conclusion">;

export const TUTOR_STAGE_LABEL: Record<TutorStage, string> = {
	observation: "Observe",
	interpretation: "Interpret",
	application: "Apply",
	conclusion: "Conclude",
};

/** Questions answered well at each stage before the next one opens, by level. */
export const TUTOR_STAGE_TARGETS: Record<TutorLevel, Record<QuestionStage, number>> = {
	beginner: { observation: 3, interpretation: 2, application: 1 },
	growing: { observation: 2, interpretation: 2, application: 1 },
	deep: { observation: 2, interpretation: 3, application: 1 },
};

/** Extra questions a stage may take for look-again follow-ups before it moves on anyway. */
export const TUTOR_STAGE_EXTRA = 2;

export const TUTOR_ANSWER_MAX = 2_000;
/** A session past this many turns asks for a fresh one; it keeps `data` well under the store's cap. */
export const TUTOR_TURNS_MAX = 160;
export const TUTOR_PASSAGE_MAX_VERSES = 30;
export const TUTOR_HINT_STEPS = 3;
/** Answers that must pass after any level change before the tutor changes it again. */
export const TUTOR_ADAPT_COOLDOWN = 2;

export interface TutorPassage {
	book: number;
	chapter: number;
	start: number;
	end: number;
	/** "Romans 5:1-11", built from the canonical book name. */
	reference: string;
}

export type TutorCitationSource = "passage" | "chapter" | "preceding" | "cross-reference" | "search";

/** A verse (or short range) the tutor cites, with its KJV text from the bundled Bible. */
export interface TutorCitation {
	reference: string;
	/** Passage keys, "book.chapter.verse", for every verse in it. */
	keys: string[];
	text: string;
	/** What the tutor says this verse shows. */
	why: string;
	source: TutorCitationSource;
}

export type TutorVerdict = "affirm" | "partly" | "correct" | "unclear";
export type TutorCheckVerdict = "supported" | "partly" | "corrected";
export type TutorLevelSignal = "easier" | "same" | "deeper";

interface TurnBase {
	id: string;
	at: string;
}

export type TutorTurn =
	| (TurnBase & {
			role: "tutor";
			kind: "question";
			stage: TutorStage;
			text: string;
			lead: string | null;
			focus: number[];
			/** Verses beyond the passage the question asks about (the chapter before, a cross-reference). */
			context?: TutorCitation[];
	  })
	| (TurnBase & { role: "tutor"; kind: "feedback"; verdict: TutorVerdict; text: string; citations: TutorCitation[] })
	| (TurnBase & { role: "tutor"; kind: "hint"; step: number; text: string; citations: TutorCitation[] })
	| (TurnBase & {
			role: "tutor";
			kind: "reading";
			text: string;
			forVerses: TutorCitation[];
			againstVerses: TutorCitation[];
			consider: string | null;
	  })
	| (TurnBase & {
			role: "tutor";
			kind: "check";
			verdict: TutorCheckVerdict;
			text: string;
			supports: TutorCitation[];
			corrects: TutorCitation[];
			context: TutorCitation[];
			takeaways: string[];
	  })
	| (TurnBase & { role: "tutor"; kind: "level"; from: TutorLevel; to: TutorLevel; by: "you" | "tutor"; text: string })
	| (TurnBase & { role: "you"; kind: "answer" | "conclusion" | "hint" | "reading"; text: string });

export type TutorQuestionTurn = Extract<TutorTurn, { kind: "question" }>;
export type TutorCheckTurn = Extract<TutorTurn, { kind: "check" }>;

export interface TutorSessionData {
	v: number;
	passage: TutorPassage;
	level: TutorLevel;
	/** Answers given since the level last changed, by the founder or the tutor. */
	answersSinceLevelChange: number;
	/** True once a conclusion has been checked against the text. */
	finished: boolean;
	pausedAt: string | null;
	noteId: string | null;
	/** How many turns the saved note already holds; a later save appends the rest. */
	noteTurns: number;
	turns: TutorTurn[];
}

export const TUTOR_ACTIONS = ["answer", "hint", "reading", "conclude"] as const;
export type TutorAction = (typeof TUTOR_ACTIONS)[number];

export type TutorRuleResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function isTutorLevel(value: unknown): value is TutorLevel {
	return typeof value === "string" && (TUTOR_LEVELS as readonly string[]).includes(value);
}

export function isTutorAction(value: unknown): value is TutorAction {
	return typeof value === "string" && (TUTOR_ACTIONS as readonly string[]).includes(value);
}

/* -------------------------------------------------------------------------
 * The passage
 * ---------------------------------------------------------------------- */

/**
 * A verse range inside one chapter of `chapterLength` verses; `end` null means
 * "to the end of the chapter". At most TUTOR_PASSAGE_MAX_VERSES verses.
 */
export function checkPassageRange(
	start: number,
	end: number | null,
	chapterLength: number,
): TutorRuleResult<{ start: number; end: number }> {
	if (!Number.isInteger(chapterLength) || chapterLength < 1) return { ok: false, error: "That chapter does not exist." };
	const last = end ?? chapterLength;
	if (!Number.isInteger(start) || !Number.isInteger(last) || start < 1 || last < start) {
		return { ok: false, error: "Use a verse or a range like Romans 5:1-11." };
	}
	if (last > chapterLength) return { ok: false, error: `That chapter has ${chapterLength} verses.` };
	if (last - start + 1 > TUTOR_PASSAGE_MAX_VERSES) {
		return { ok: false, error: `Choose up to ${TUTOR_PASSAGE_MAX_VERSES} verses, so you can read them closely.` };
	}
	return { ok: true, value: { start, end: last } };
}

export function formatPassageReference(bookName: string, chapter: number, start: number, end: number): string {
	// The book is Psalms; one psalm is "Psalm 23", as SureWord writes it everywhere else.
	const book = bookName === "Psalms" ? "Psalm" : bookName;
	return start === end ? `${book} ${chapter}:${start}` : `${book} ${chapter}:${start}-${end}`;
}

/** The study store's passage keys for every verse studied ("45.5.1" ... "45.5.11"). */
export function passageRefKeys(passage: Pick<TutorPassage, "book" | "chapter" | "start" | "end">): string[] {
	const keys: string[] = [];
	for (let verse = passage.start; verse <= passage.end; verse++) keys.push(`${passage.book}.${passage.chapter}.${verse}`);
	return keys;
}

export function sessionTitle(passage: Pick<TutorPassage, "reference">): string {
	return `Close reading: ${passage.reference}`;
}

/* -------------------------------------------------------------------------
 * Where the session is
 * ---------------------------------------------------------------------- */

/** The question the founder is answering now: the last one asked. */
export function openQuestion(turns: readonly TutorTurn[]): TutorQuestionTurn | null {
	for (let i = turns.length - 1; i >= 0; i--) {
		const turn = turns[i];
		if (turn.kind === "question") return turn;
	}
	return null;
}

export function latestCheck(turns: readonly TutorTurn[]): TutorCheckTurn | null {
	for (let i = turns.length - 1; i >= 0; i--) {
		const turn = turns[i];
		if (turn.kind === "check") return turn;
	}
	return null;
}

/** Hints already given on the open question. */
export function hintsOnOpenQuestion(turns: readonly TutorTurn[]): number {
	let count = 0;
	for (let i = turns.length - 1; i >= 0; i--) {
		const turn = turns[i];
		if (turn.kind === "question") break;
		if (turn.role === "tutor" && turn.kind === "hint") count++;
	}
	return count;
}

/** The next hint's step (1 to TUTOR_HINT_STEPS), or null when every step has been given. */
export function nextHintStep(turns: readonly TutorTurn[]): number | null {
	const given = hintsOnOpenQuestion(turns);
	return given >= TUTOR_HINT_STEPS ? null : given + 1;
}

export interface StageTally {
	/** Questions asked at this stage. */
	asked: number;
	/** Of those, answered in a way the text supports (affirm or partly). */
	done: number;
}

/** Questions asked and answered well at each stage, from the transcript. */
export function stageProgress(turns: readonly TutorTurn[]): Record<TutorStage, StageTally> {
	const tally: Record<TutorStage, StageTally> = {
		observation: { asked: 0, done: 0 },
		interpretation: { asked: 0, done: 0 },
		application: { asked: 0, done: 0 },
		conclusion: { asked: 0, done: 0 },
	};
	let current: TutorStage | null = null;
	let credited = false;
	for (const turn of turns) {
		if (turn.kind === "question") {
			current = turn.stage;
			credited = false;
			tally[current].asked++;
		} else if (turn.kind === "feedback" && current && !credited && (turn.verdict === "affirm" || turn.verdict === "partly")) {
			tally[current].done++;
			credited = true;
		} else if (turn.kind === "check" && !credited) {
			tally.conclusion.done++;
			credited = true;
		}
	}
	return tally;
}

/**
 * The stage the next question belongs to: the first stage not yet answered
 * well often enough for this level, unless it has already taken every
 * look-again follow-up it is allowed; after application, the conclusion.
 */
export function plannedStage(turns: readonly TutorTurn[], level: TutorLevel): TutorStage {
	const tally = stageProgress(turns);
	const targets = TUTOR_STAGE_TARGETS[level];
	for (const stage of ["observation", "interpretation", "application"] as const) {
		const { asked, done } = tally[stage];
		if (done < targets[stage] && asked < targets[stage] + TUTOR_STAGE_EXTRA) return stage;
	}
	return "conclusion";
}

/** The two stages the next question may take after an answer, by the verdict it receives. */
export function nextStageOptions(
	turns: readonly TutorTurn[],
	level: TutorLevel,
): { ifCredited: TutorStage; ifNot: TutorStage } {
	const open = openQuestion(turns);
	const current = open?.stage ?? "observation";
	// Credit the open question as a well answered one and see where that leads.
	const credited: TutorTurn[] = [
		...turns,
		{ id: "_", at: "", role: "tutor", kind: "feedback", verdict: "affirm", text: "", citations: [] },
	];
	const ifCredited = plannedStage(credited, level);
	const tally = stageProgress(turns);
	const target = current === "conclusion" ? 1 : TUTOR_STAGE_TARGETS[level][current];
	const ifNot = current !== "conclusion" && tally[current].asked >= target + TUTOR_STAGE_EXTRA ? ifCredited : current;
	return { ifCredited, ifNot };
}

/**
 * The stage a new question is filed under: the one the verdict calls for.
 * The model is told both options and which verdict leads to each, so its
 * question is written for this stage; the label never follows a stage it
 * merely claims, which keeps a missed answer from moving the founder on.
 */
export function settleNextStage(verdict: TutorVerdict, options: { ifCredited: TutorStage; ifNot: TutorStage }): TutorStage {
	return verdict === "affirm" || verdict === "partly" ? options.ifCredited : options.ifNot;
}

/* -------------------------------------------------------------------------
 * Adapting the level
 * ---------------------------------------------------------------------- */

function stepLevel(level: TutorLevel, by: -1 | 1): TutorLevel {
	const index = TUTOR_LEVELS.indexOf(level) + by;
	return TUTOR_LEVELS[Math.min(Math.max(index, 0), TUTOR_LEVELS.length - 1)];
}

/** The verdicts on the founder's answers, oldest first. */
export function answerVerdicts(turns: readonly TutorTurn[]): TutorVerdict[] {
	return turns.flatMap((turn) => (turn.kind === "feedback" ? [turn.verdict] : []));
}

/**
 * Whether the tutor moves the level after this answer. It needs both the
 * model's read of the answer and the record: two answers in a row the text
 * fully supports, with no hints, to go deeper; two misses in a row, or a
 * second hint on one question, to go easier. Never within the cooldown after
 * any change, so a founder's own choice stands for a while.
 */
export function adaptLevel(input: {
	level: TutorLevel;
	answersSinceLevelChange: number;
	/** Verdicts including this answer's, oldest first. */
	verdicts: readonly TutorVerdict[];
	/** Hints given on the question just answered. */
	hintsUsed: number;
	/** Hints on the question before it. */
	hintsBefore: number;
	signal: TutorLevelSignal;
}): TutorLevel {
	if (input.answersSinceLevelChange < TUTOR_ADAPT_COOLDOWN) return input.level;
	const lastTwo = input.verdicts.slice(-2);
	if (lastTwo.length < 2) return input.level;
	if (
		input.signal === "deeper" &&
		input.level !== "deep" &&
		lastTwo.every((verdict) => verdict === "affirm") &&
		input.hintsUsed === 0 &&
		input.hintsBefore === 0
	) {
		return stepLevel(input.level, 1);
	}
	const missed = lastTwo.every((verdict) => verdict === "correct" || verdict === "unclear");
	const leaning = input.hintsUsed >= 2 && lastTwo[1] !== "affirm";
	if (input.signal === "easier" && input.level !== "beginner" && (missed || leaning)) return stepLevel(input.level, -1);
	return input.level;
}

/** Hints given on each question, in order asked. */
export function hintsPerQuestion(turns: readonly TutorTurn[]): number[] {
	const counts: number[] = [];
	for (const turn of turns) {
		if (turn.kind === "question") counts.push(0);
		else if (turn.role === "tutor" && turn.kind === "hint" && counts.length) counts[counts.length - 1]++;
	}
	return counts;
}

export function levelChangeText(from: TutorLevel, to: TutorLevel, by: "you" | "tutor"): string {
	const deeper = TUTOR_LEVELS.indexOf(to) > TUTOR_LEVELS.indexOf(from);
	if (by === "you") return `You moved to ${TUTOR_LEVEL_LABEL[to]}. The next questions are written for it.`;
	return deeper
		? `Going deeper: you are reading closely, so the next questions move to ${TUTOR_LEVEL_LABEL[to]}. You can change it back at any time.`
		: `Let's slow down: the next questions move to ${TUTOR_LEVEL_LABEL[to]}, one step at a time. You can change it back at any time.`;
}

/* -------------------------------------------------------------------------
 * Requests
 * ---------------------------------------------------------------------- */

export interface TutorActionInput {
	action: TutorAction;
	text: string;
	/** The number of turns the founder's screen has, so a stale or doubled send is refused. */
	expect: number;
}

/** A founder's action on a session, checked; the text is required for answers and conclusions. */
export function checkActionInput(body: unknown): TutorRuleResult<TutorActionInput> {
	if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, error: "invalid_body" };
	const data = body as Record<string, unknown>;
	if (!isTutorAction(data.action)) return { ok: false, error: "invalid_action" };
	if (typeof data.expect !== "number" || !Number.isInteger(data.expect) || data.expect < 0) return { ok: false, error: "invalid_expect" };
	const text = typeof data.text === "string" ? data.text.trim().replace(/\r\n?/g, "\n") : "";
	if ((data.action === "answer" || data.action === "conclude") && !text) return { ok: false, error: "empty_answer" };
	if (text.length > TUTOR_ANSWER_MAX) return { ok: false, error: "answer_too_long" };
	return { ok: true, value: { action: data.action, text, expect: data.expect } };
}

/**
 * An answer to the conclusion question is a conclusion, whichever button sent
 * it; an answer with no open question (after a check) is one too.
 */
export function effectiveAction(action: TutorAction, turns: readonly TutorTurn[]): TutorAction {
	if (action !== "answer") return action;
	const open = openQuestion(turns);
	if (!open || open.stage === "conclusion") return "conclude";
	const check = latestCheck(turns);
	return check && turns.indexOf(check) > turns.indexOf(open) ? "conclude" : "answer";
}

/* -------------------------------------------------------------------------
 * Reading what is stored
 * ---------------------------------------------------------------------- */

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPassage(value: unknown): value is TutorPassage {
	if (!isPlainObject(value)) return false;
	const { book, chapter, start, end, reference } = value;
	return (
		Number.isInteger(book) && Number.isInteger(chapter) && Number.isInteger(start) && Number.isInteger(end) &&
		(start as number) >= 1 && (end as number) >= (start as number) && typeof reference === "string"
	);
}

/** A stored session's data, or null when it is not one this version can read. */
export function parseSessionData(value: unknown): TutorSessionData | null {
	if (!isPlainObject(value)) return null;
	if (value.v !== TUTOR_DATA_VERSION || !isPassage(value.passage) || !isTutorLevel(value.level) || !Array.isArray(value.turns)) return null;
	const turns = value.turns.filter((turn): turn is TutorTurn => isPlainObject(turn) && typeof turn.kind === "string" && (turn.role === "tutor" || turn.role === "you"));
	return {
		v: TUTOR_DATA_VERSION,
		passage: value.passage,
		level: value.level,
		answersSinceLevelChange: Number.isInteger(value.answersSinceLevelChange) ? (value.answersSinceLevelChange as number) : 0,
		finished: value.finished === true,
		pausedAt: typeof value.pausedAt === "string" ? value.pausedAt : null,
		noteId: typeof value.noteId === "string" && value.noteId ? value.noteId : null,
		noteTurns: Number.isInteger(value.noteTurns) ? Math.max(0, value.noteTurns as number) : 0,
		turns,
	};
}

export function newSessionData(passage: TutorPassage, level: TutorLevel): TutorSessionData {
	return {
		v: TUTOR_DATA_VERSION,
		passage,
		level,
		answersSinceLevelChange: 0,
		finished: false,
		pausedAt: null,
		noteId: null,
		noteTurns: 0,
		turns: [],
	};
}

/* -------------------------------------------------------------------------
 * Text for the model, the Vault and the note
 * ---------------------------------------------------------------------- */

function citationList(citations: readonly TutorCitation[]): string {
	return citations.map((citation) => citation.reference).join(", ");
}

/** One line per turn, as the model reads the session so far. */
export function transcriptForModel(turns: readonly TutorTurn[], limit = 40): string {
	const recent = turns.slice(-limit);
	const lines = recent.map((turn) => {
		if (turn.role === "you") {
			if (turn.kind === "hint" || turn.kind === "reading") return `LEARNER: (asked for ${turn.kind === "hint" ? "a hint" : "your reading"})`;
			return `LEARNER${turn.kind === "conclusion" ? " (conclusion)" : ""}: ${turn.text}`;
		}
		switch (turn.kind) {
			case "question":
				return `TUTOR (${turn.stage} question${turn.focus.length ? `, verses ${turn.focus.join(", ")}` : ""}): ${turn.lead ? `${turn.lead} ` : ""}${turn.text}`;
			case "feedback":
				return `TUTOR (verdict: ${turn.verdict}${turn.citations.length ? `; cited ${citationList(turn.citations)}` : ""}): ${turn.text}`;
			case "hint":
				return `TUTOR (hint ${turn.step}): ${turn.text}`;
			case "reading":
				return `TUTOR (its own reading, given on request): ${turn.text}`;
			case "check":
				return `TUTOR (checked the learner's conclusion: ${turn.verdict}): ${turn.text}`;
			case "level":
				return `(level changed from ${turn.from} to ${turn.to})`;
		}
	});
	const skipped = turns.length - recent.length;
	return [skipped > 0 ? `(${skipped} earlier turns not shown)` : "", ...lines].filter(Boolean).join("\n");
}

/** Plain text the Knowledge Vault indexes: the passage, the questions and the founder's own words. */
export function sessionBody(data: Pick<TutorSessionData, "passage" | "turns">): string {
	const lines = [`Socratic Tutor close reading of ${data.passage.reference}.`];
	for (const turn of data.turns) {
		if (turn.role === "you") {
			if (turn.kind === "answer") lines.push(`My answer: ${turn.text}`);
			else if (turn.kind === "conclusion") lines.push(`My conclusion: ${turn.text}`);
			continue;
		}
		if (turn.kind === "question") lines.push(`Question: ${turn.text}`);
		else if (turn.kind === "feedback" || turn.kind === "hint") lines.push(`Tutor: ${turn.text}`);
		else if (turn.kind === "reading") lines.push(`Tutor's reading (interpretation): ${turn.text}`);
		else if (turn.kind === "check") {
			lines.push(`Checked against the text: ${turn.text}`);
			for (const takeaway of turn.takeaways) lines.push(`Learned: ${takeaway}`);
		}
	}
	return lines.join("\n");
}

/** User and model text dropped into markdown: no raw HTML, and no accidental markup. */
export function escapeMarkdownText(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/([\\`*_[\]#|])/g, "\\$1")
		.replace(/\s*\n\s*/g, " ")
		.trim();
}

const VERDICT_NOTE: Record<TutorVerdict, string> = {
	affirm: "The text supports this",
	partly: "Partly there",
	correct: "Look again",
	unclear: "Back to the question",
};

export const CHECK_VERDICT_LABEL: Record<TutorCheckVerdict, string> = {
	supported: "Supported by the text",
	partly: "Partly supported",
	corrected: "The text says otherwise",
};

/** Said outright when the tutor's reading has no verse against it, so an empty list is never mistaken for an unasked one. */
export const NO_AGAINST_VERSES = "None found in this passage and its context.";

function citedLine(label: string, citations: readonly TutorCitation[]): string[] {
	if (!citations.length) return [];
	return [
		`**${label}:**`,
		"",
		...citations.map((citation) => `- **${citation.reference}**: ${escapeMarkdownText(citation.text)} *(${escapeMarkdownText(citation.why)})*`),
		"",
	];
}

/** The conversation, as the note's "The questions" section. */
export function turnsMarkdown(turns: readonly TutorTurn[]): string[] {
	const out: string[] = [];
	for (const turn of turns) {
		if (turn.role === "you") {
			if (turn.kind === "answer") out.push(`**My answer:** ${escapeMarkdownText(turn.text)}`, "");
			else if (turn.kind === "conclusion") out.push(`**My conclusion:** ${escapeMarkdownText(turn.text)}`, "");
			continue;
		}
		switch (turn.kind) {
			case "question":
				out.push(
					`**Question (${TUTOR_STAGE_LABEL[turn.stage]}):** ${turn.lead ? `${escapeMarkdownText(turn.lead)} ` : ""}${escapeMarkdownText(turn.text)}${turn.context?.length ? ` (read with ${citationList(turn.context)})` : ""}`,
					"",
				);
				break;
			case "feedback":
				out.push(
					`**Tutor (${VERDICT_NOTE[turn.verdict]}):** ${escapeMarkdownText(turn.text)}${turn.citations.length ? ` (${citationList(turn.citations)})` : ""}`,
					"",
				);
				break;
			case "hint":
				out.push(`**Hint:** ${escapeMarkdownText(turn.text)}`, "");
				break;
			case "reading":
				out.push(
					`**The tutor's reading (interpretation, not Scripture):** ${escapeMarkdownText(turn.text)}`,
					"",
					...citedLine("Verses for it", turn.forVerses),
					...(turn.againstVerses.length
						? citedLine("Verses to weigh against it", turn.againstVerses)
						: [`**Verses to weigh against it:** ${NO_AGAINST_VERSES}`, ""]),
				);
				break;
			case "check":
				out.push(`**Checked against the text (${CHECK_VERDICT_LABEL[turn.verdict]}):** ${escapeMarkdownText(turn.text)}`, "");
				break;
			case "level":
				out.push(`*${escapeMarkdownText(turn.text)}*`, "");
				break;
		}
	}
	return out;
}

/**
 * The note a session saves as (Notes renders markdown). A first save holds the
 * passage, what was learned, the checked conclusion and the conversation; a
 * later save (`continuation`) appends only what happened since.
 */
export function sessionNoteMarkdown(input: {
	data: Pick<TutorSessionData, "passage" | "level" | "turns">;
	/** The verses studied, in order, from the bundled KJV. */
	verses: readonly { verse: number; text: string }[];
	takeaways: readonly string[];
	/** "26 October 2026" */
	dateLabel: string;
	/** Turns already in the note; 0 for a first save. */
	fromTurn: number;
}): string {
	const { data, verses, takeaways, dateLabel, fromTurn } = input;
	const turns = data.turns.slice(fromTurn);
	const check = latestCheck(turns);
	const lines: string[] = [];
	if (fromTurn === 0) {
		lines.push(
			`*A close reading with the Socratic Tutor in SureWord Beta, ${TUTOR_LEVEL_LABEL[data.level]}, ${dateLabel}.*`,
			"",
			`## ${data.passage.reference} (KJV)`,
			"",
			verses.map((row) => `> **${row.verse}** ${escapeMarkdownText(row.text)}`).join("\n>\n"),
			"",
		);
	} else {
		lines.push(`## Continued, ${dateLabel}`, "");
	}
	if (takeaways.length) {
		lines.push("## What I learned", "", ...takeaways.map((takeaway) => `- ${escapeMarkdownText(takeaway)}`), "");
	}
	if (check) {
		const conclusionTurn = [...turns.slice(0, turns.indexOf(check))].reverse().find((turn) => turn.kind === "conclusion");
		lines.push("## My conclusion, checked against the text", "");
		if (conclusionTurn) lines.push(`> ${escapeMarkdownText(conclusionTurn.text)}`, "");
		lines.push(
			`**${CHECK_VERDICT_LABEL[check.verdict]}.** ${escapeMarkdownText(check.text)}`,
			"",
			...citedLine("Verses that support it", check.supports),
			...citedLine("Verses that correct or complete it", check.corrects),
			...citedLine("The wider context", check.context),
		);
	}
	const conversation = turnsMarkdown(turns);
	if (conversation.length) lines.push("## The questions", "", ...conversation);
	return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** A short summary of a session for its list card. */
export interface TutorSessionSummary {
	id: string;
	title: string;
	reference: string;
	level: TutorLevel;
	stage: TutorStage;
	finished: boolean;
	noteId: string | null;
	answered: number;
	updatedAt: string;
}

export function summarizeSession(id: string, title: string, updatedAt: string, data: TutorSessionData): TutorSessionSummary {
	return {
		id,
		title,
		reference: data.passage.reference,
		level: data.level,
		stage: openQuestion(data.turns)?.stage ?? "observation",
		finished: data.finished,
		noteId: data.noteId,
		answered: data.turns.filter((turn) => turn.role === "you" && (turn.kind === "answer" || turn.kind === "conclusion")).length,
		updatedAt,
	};
}

/** What the session screen renders, from the server. */
export interface TutorSessionView {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	passage: TutorPassage;
	/** The verses studied, from the bundled KJV. */
	verses: { verse: number; text: string }[];
	level: TutorLevel;
	finished: boolean;
	noteId: string | null;
	/** True when everything in the session is already in its note. */
	noteCurrent: boolean;
	turns: TutorTurn[];
	stage: TutorStage;
	progress: Record<TutorStage, StageTally>;
	hintsLeft: number;
	full: boolean;
}

export function sessionView(
	item: { id: string; title: string; createdAt: string; updatedAt: string },
	data: TutorSessionData,
	verses: { verse: number; text: string }[],
): TutorSessionView {
	const open = openQuestion(data.turns);
	return {
		...item,
		passage: data.passage,
		verses,
		level: data.level,
		finished: data.finished,
		noteId: data.noteId,
		noteCurrent: data.noteId !== null && data.noteTurns >= data.turns.length,
		turns: data.turns,
		stage: open?.stage ?? "observation",
		progress: stageProgress(data.turns),
		hintsLeft: open ? TUTOR_HINT_STEPS - hintsOnOpenQuestion(data.turns) : 0,
		full: data.turns.length >= TUTOR_TURNS_MAX,
	};
}

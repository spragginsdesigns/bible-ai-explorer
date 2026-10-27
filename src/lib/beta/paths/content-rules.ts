/**
 * Pure rules for Learning Paths content (LC-17648, docs/beta/paths.md): how a
 * passage reference is read, and what makes a lesson or an exercise safe to
 * put in front of a founder. The written paths are checked against these by
 * `tests/beta-paths-content.test.mjs`; a generated curriculum lesson is checked
 * by the same functions at runtime, and anything that fails is dropped.
 *
 * The rule that matters most is Quiz me's: the answer is always the verse. An
 * answer, a step or a truth must be stated in the words of the verse it cites,
 * checked mechanically with Quiz me's own grounding rules (`quiz-rules.ts`),
 * which are passed in as `ContentDeps` so this file needs no imports and the
 * tests load it with Node's type stripping.
 */
import type { BlankExercise, ChoiceExercise, CourseLessonParts, MatchExercise, OrderExercise, PathDef, PathExercise, PathLesson, PathLevel, PathUnit } from "./paths-types";

export interface BookInfo {
	order: number;
	name: string;
	chapters: number;
}

/** A book by its KJV name ("Romans", "1 Corinthians", "Psalms" or "Psalm"), or null. */
export type BookResolver = (name: string) => BookInfo | null;

/** One run of verses inside one chapter. */
export interface Passage {
	book: number;
	bookName: string;
	chapter: number;
	start: number;
	end: number;
}

export interface ContentDeps {
	resolveBook: BookResolver;
	/** The plain KJV text of verses start..end, or null when any of them does not exist. */
	verses: (passage: Passage) => string[] | null;
	answerIsGrounded: (answer: string, verseText: string) => boolean;
	distractorContradictsVerse: (distractor: string, correct: string, verseText: string) => boolean;
	answerStandsOut: (correct: string, wrong: string[]) => boolean;
	foldWords: (text: string) => string[];
	overlapWithVerse: (text: string, verseText: string) => { words: number; share: number };
}

export const PATH_LIMITS = {
	title: 70,
	summary: 120,
	description: 600,
	teachingMin: 80,
	teachingMax: 700,
	prompt: 220,
	option: 90,
	note: 240,
	reflection: 220,
	readingVerses: 25,
	answerVerses: 3,
	poolMin: 7,
	poolMax: 10,
	lessonsMin: 10,
	lessonsMax: 12,
} as const;

/**
 * SureWord Academy courses (LC-17660): the tutor's passage fits a close
 * reading (the Socratic Tutor takes up to 30 verses of one chapter) and a
 * memory verse fits one Scripture Memory card (up to six verses).
 */
export const COURSE_LIMITS = {
	tutorMinVerses: 3,
	tutorMaxVerses: 30,
	focus: 220,
	focusMin: 30,
	memoryMin: 1,
	memoryMax: 3,
	memoryVerses: 6,
	outcomesMin: 3,
	outcomesMax: 5,
	outcome: 160,
} as const;

const PASSAGE_PATTERN = /^((?:[1-3] )?[A-Z][A-Za-z]*(?: [A-Za-z]+)*) (\d{1,3}):(\d{1,3})(?:-(\d{1,3}))?$/;
const CONCEPT_PATTERN = /^[a-z][a-z' ]{1,39}$/;
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Em and en dashes, and markdown a reader would see as symbols. */
const FORBIDDEN_TEXT = /[–—*#`_]|\s-\s/;

/** "Romans 3:21-26" or "John 3:16"; one chapter only. Null when it is not a real passage. */
export function parsePassage(ref: unknown, resolveBook: BookResolver): Passage | null {
	if (typeof ref !== "string") return null;
	const match = PASSAGE_PATTERN.exec(ref.trim());
	if (!match) return null;
	const book = resolveBook(match[1]);
	if (!book) return null;
	const chapter = Number(match[2]);
	const start = Number(match[3]);
	const end = match[4] === undefined ? start : Number(match[4]);
	if (chapter < 1 || chapter > book.chapters || start < 1 || end < start) return null;
	return { book: book.order, bookName: book.name, chapter, start, end };
}

/** "Romans 3:21-26", "Psalm 119:105" (one psalm is a Psalm). */
export function formatPassage(passage: Passage): string {
	const name = passage.bookName === "Psalms" ? "Psalm" : passage.bookName;
	const verses = passage.start === passage.end ? `${passage.start}` : `${passage.start}-${passage.end}`;
	return `${name} ${passage.chapter}:${verses}`;
}

export function passageLength(passage: Passage): number {
	return passage.end - passage.start + 1;
}

/** A verse's words as the reader sees them, with the punctuation around each word stripped. */
export function verseTokens(verseText: string): string[] {
	return verseText.split(/\s+/).filter(Boolean).map((token) => token.replace(/^[^A-Za-z0-9']+|[^A-Za-z0-9']+$/g, ""));
}

/**
 * Where `word` (one to three words, exactly as the verse has them) sits in the
 * verse, as token indexes, or null when it is not there exactly once.
 */
export function findWordSpan(verseText: string, word: string): { start: number; end: number } | null {
	const wanted = word.trim().split(/\s+/);
	const tokens = verseTokens(verseText);
	let found: { start: number; end: number } | null = null;
	for (let index = 0; index + wanted.length <= tokens.length; index += 1) {
		if (wanted.every((part, offset) => tokens[index + offset] === part)) {
			if (found) return null;
			found = { start: index, end: index + wanted.length - 1 };
		}
	}
	return found;
}

/**
 * The verse split around the blank: the text before it, the hidden words, and
 * the text after it, keeping the verse's own punctuation on either side.
 */
export function splitAroundBlank(verseText: string, word: string): { before: string; hidden: string; after: string } | null {
	const span = findWordSpan(verseText, word);
	if (!span) return null;
	const raw = verseText.split(/\s+/).filter(Boolean);
	const lead = raw[span.start].match(/^[^A-Za-z0-9']*/)?.[0] ?? "";
	const trail = raw[span.end].match(/[^A-Za-z0-9']*$/)?.[0] ?? "";
	const beforeWords = raw.slice(0, span.start).join(" ");
	const afterWords = raw.slice(span.end + 1).join(" ");
	return {
		before: `${beforeWords}${beforeWords ? " " : ""}${lead}`,
		hidden: word.trim(),
		after: `${trail}${afterWords ? ` ${afterWords}` : ""}`,
	};
}

function textProblem(label: string, value: unknown, max: number, min = 1): string | null {
	if (typeof value !== "string") return `${label} must be text`;
	const text = value.trim();
	if (text.length < min) return `${label} is ${min > 1 ? `shorter than ${min}` : "empty"}`;
	if (text.length > max) return `${label} is longer than ${max} (${text.length})`;
	if (text !== value) return `${label} has spaces at its ends`;
	if (FORBIDDEN_TEXT.test(text)) return `${label} has a dash or markdown`;
	return null;
}

/** The passage and its joined KJV text, or the problem with the reference. */
export function resolveAnswer(
	label: string,
	ref: unknown,
	deps: ContentDeps,
	maxVerses: number = PATH_LIMITS.answerVerses
): { passage: Passage; text: string } | { problem: string } {
	const passage = parsePassage(ref, deps.resolveBook);
	if (!passage) return { problem: `${label} "${String(ref)}" is not a passage like "Romans 3:23"` };
	if (passageLength(passage) > maxVerses) return { problem: `${label} "${String(ref)}" is longer than ${maxVerses} verses` };
	const verses = deps.verses(passage);
	if (!verses) return { problem: `${label} "${String(ref)}" runs past the end of the chapter` };
	return { passage, text: verses.join(" ") };
}

function folded(text: string, deps: ContentDeps): string {
	return deps.foldWords(text).join(" ");
}

function checkChoice(ex: ChoiceExercise, deps: ContentDeps, out: string[]): void {
	const at = ex.id;
	for (const [label, value, max] of [["prompt", ex.prompt, PATH_LIMITS.prompt], ["correct", ex.correct, PATH_LIMITS.option]] as const) {
		const problem = textProblem(`${at} ${label}`, value, max);
		if (problem) out.push(problem);
	}
	if (!Array.isArray(ex.wrong) || ex.wrong.length !== 3) {
		out.push(`${at} needs exactly three wrong answers`);
		return;
	}
	ex.wrong.forEach((option, index) => {
		const problem = textProblem(`${at} wrong[${index}]`, option, PATH_LIMITS.option);
		if (problem) out.push(problem);
	});
	if (ex.note !== undefined) {
		const problem = textProblem(`${at} note`, ex.note, PATH_LIMITS.note);
		if (problem) out.push(problem);
	}
	const options = [ex.correct, ...ex.wrong].map((option) => folded(String(option), deps));
	if (new Set(options).size !== options.length || options.some((option) => !option)) out.push(`${at} has duplicate choices`);
	if (deps.answerStandsOut(ex.correct, ex.wrong)) out.push(`${at}: the right choice is much longer than the others and gives itself away`);
	const answer = resolveAnswer(`${at} answer`, ex.answer, deps);
	if ("problem" in answer) {
		out.push(answer.problem);
		return;
	}
	if (!deps.answerIsGrounded(ex.correct, answer.text)) out.push(`${at}: "${ex.correct}" is not in the words of ${ex.answer}`);
	for (const option of ex.wrong) {
		if (deps.distractorContradictsVerse(option, ex.correct, answer.text)) out.push(`${at}: wrong answer "${option}" is something ${ex.answer} says`);
	}
}

function checkBlank(ex: BlankExercise, deps: ContentDeps, out: string[]): void {
	const at = ex.id;
	const answer = resolveAnswer(`${at} answer`, ex.answer, deps, 1);
	if ("problem" in answer) {
		out.push(answer.problem);
		return;
	}
	const wordProblem = textProblem(`${at} word`, ex.word, 40);
	if (wordProblem) {
		out.push(wordProblem);
		return;
	}
	const parts = ex.word.split(/\s+/);
	if (parts.length > 3) out.push(`${at}: the blank is more than three words`);
	if (!findWordSpan(answer.text, ex.word)) out.push(`${at}: "${ex.word}" is not in ${ex.answer} exactly once, as written`);
	if (!deps.answerIsGrounded(ex.word, answer.text)) out.push(`${at}: "${ex.word}" is too small a word to blank out`);
	if (!Array.isArray(ex.wrong) || ex.wrong.length !== 3) {
		out.push(`${at} needs exactly three other words`);
		return;
	}
	const seen = new Set([ex.word.toLowerCase()]);
	for (const option of ex.wrong) {
		const problem = textProblem(`${at} wrong word`, option, 40);
		if (problem) {
			out.push(problem);
			continue;
		}
		if (option.split(/\s+/).length > 3) out.push(`${at}: wrong word "${option}" is more than three words`);
		if (seen.has(option.toLowerCase())) out.push(`${at}: "${option}" repeats a choice`);
		seen.add(option.toLowerCase());
	}
}

function checkOrder(ex: OrderExercise, deps: ContentDeps, out: string[]): void {
	const at = ex.id;
	const prompt = textProblem(`${at} prompt`, ex.prompt, PATH_LIMITS.prompt);
	if (prompt) out.push(prompt);
	if (!Array.isArray(ex.steps) || ex.steps.length < 3 || ex.steps.length > 5) {
		out.push(`${at} needs three to five steps`);
		return;
	}
	const texts = new Set<string>();
	ex.steps.forEach((step, index) => {
		const problem = textProblem(`${at} step ${index + 1}`, step.text, PATH_LIMITS.option);
		if (problem) {
			out.push(problem);
			return;
		}
		texts.add(folded(step.text, deps));
		const answer = resolveAnswer(`${at} step ${index + 1} answer`, step.answer, deps);
		if ("problem" in answer) out.push(answer.problem);
		else if (!deps.answerIsGrounded(step.text, answer.text)) out.push(`${at}: step "${step.text}" is not in the words of ${step.answer}`);
	});
	if (texts.size !== ex.steps.length) out.push(`${at} has two steps that read the same`);
}

function checkMatch(ex: MatchExercise, deps: ContentDeps, out: string[]): void {
	const at = ex.id;
	const prompt = textProblem(`${at} prompt`, ex.prompt, PATH_LIMITS.prompt);
	if (prompt) out.push(prompt);
	if (!Array.isArray(ex.pairs) || ex.pairs.length < 3 || ex.pairs.length > 4) {
		out.push(`${at} needs three or four pairs`);
		return;
	}
	const truths = new Set<string>();
	const refs = new Set<string>();
	ex.pairs.forEach((pair, index) => {
		const problem = textProblem(`${at} truth ${index + 1}`, pair.truth, PATH_LIMITS.option);
		if (problem) {
			out.push(problem);
			return;
		}
		truths.add(folded(pair.truth, deps));
		const answer = resolveAnswer(`${at} pair ${index + 1} answer`, pair.answer, deps);
		if ("problem" in answer) {
			out.push(answer.problem);
			return;
		}
		refs.add(formatPassage(answer.passage));
		if (!deps.answerIsGrounded(pair.truth, answer.text)) out.push(`${at}: truth "${pair.truth}" is not in the words of ${pair.answer}`);
	});
	if (truths.size !== ex.pairs.length) out.push(`${at} has two truths that read the same`);
	if (refs.size !== ex.pairs.length) out.push(`${at} uses the same verse twice`);
	// Each truth must fit its own verse better than any other verse in the match, or it has two right answers.
	const texts = ex.pairs.map((pair) => {
		const answer = resolveAnswer("", pair.answer, deps);
		return "problem" in answer ? null : answer.text;
	});
	ex.pairs.forEach((pair, index) => {
		const own = texts[index];
		if (own === null || typeof pair.truth !== "string") return;
		const ownShare = deps.overlapWithVerse(pair.truth, own).share;
		texts.forEach((other, otherIndex) => {
			if (otherIndex === index || other === null || other === own) return;
			if (deps.overlapWithVerse(pair.truth, other).share >= ownShare) {
				out.push(`${at}: truth "${pair.truth}" fits ${ex.pairs[otherIndex].answer} as well as its own verse`);
			}
		});
	});
}

/** Every problem with one exercise; empty when it is safe to ask. */
export function exerciseProblems(ex: PathExercise, deps: ContentDeps): string[] {
	const out: string[] = [];
	const at = typeof ex?.id === "string" ? ex.id : "an exercise";
	if (typeof ex?.id !== "string" || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(ex.id)) out.push(`${at}: id must look like "romans-03.2"`);
	if (typeof ex?.concept !== "string" || !CONCEPT_PATTERN.test(ex.concept)) out.push(`${at}: concept must be a short lowercase label`);
	if (ex?.level !== 1 && ex?.level !== 2 && ex?.level !== 3) out.push(`${at}: level must be 1, 2 or 3`);
	if (out.length) return out;
	if (ex.type === "choice") checkChoice(ex, deps, out);
	else if (ex.type === "blank") checkBlank(ex, deps, out);
	else if (ex.type === "order") checkOrder(ex, deps, out);
	else if (ex.type === "match") checkMatch(ex, deps, out);
	else out.push(`${at}: unknown type`);
	return out;
}

export interface LessonRuleOptions {
	/** Written paths carry the full pool and every exercise type; a generated lesson may carry fewer. */
	written: boolean;
}

/** Every problem with one lesson and its exercises; empty when it is safe to teach. */
export function lessonProblems(lesson: PathLesson, deps: ContentDeps, options: LessonRuleOptions = { written: true }): string[] {
	const out: string[] = [];
	const at = typeof lesson?.id === "string" ? lesson.id : "a lesson";
	if (typeof lesson?.id !== "string" || !ID_PATTERN.test(lesson.id)) out.push(`${at}: id must be lowercase letters, digits and dashes`);
	for (const [label, value, max, min] of [
		["title", lesson.title, PATH_LIMITS.title, 1],
		["summary", lesson.summary, PATH_LIMITS.summary, 1],
		["teaching", lesson.teaching, PATH_LIMITS.teachingMax, PATH_LIMITS.teachingMin],
		["reflection prompt", lesson.reflection?.prompt, PATH_LIMITS.reflection, 1],
	] as const) {
		const problem = textProblem(`${at} ${label}`, value, max, min);
		if (problem) out.push(problem);
	}
	const reading = resolveAnswer(`${at} reading`, lesson.reading, deps, PATH_LIMITS.readingVerses);
	if ("problem" in reading) out.push(reading.problem);
	const key = resolveAnswer(`${at} key verse`, lesson.keyVerse, deps, 1);
	if ("problem" in key) out.push(key.problem);
	const reflection = resolveAnswer(`${at} reflection verse`, lesson.reflection?.answer, deps);
	if ("problem" in reflection) out.push(reflection.problem);

	const pool = Array.isArray(lesson.exercises) ? lesson.exercises : [];
	const ids = new Set<string>();
	for (const ex of pool) {
		if (ids.has(ex.id)) out.push(`${at}: exercise id ${ex.id} is used twice`);
		ids.add(ex.id);
		if (typeof ex.id === "string" && !ex.id.startsWith(`${lesson.id}.`)) out.push(`${ex.id}: must start with "${lesson.id}."`);
		out.push(...exerciseProblems(ex, deps));
	}
	if (options.written) {
		if (pool.length < PATH_LIMITS.poolMin || pool.length > PATH_LIMITS.poolMax) {
			out.push(`${at}: needs ${PATH_LIMITS.poolMin} to ${PATH_LIMITS.poolMax} exercises, has ${pool.length}`);
		}
		const count = (type: string) => pool.filter((ex) => ex.type === type).length;
		if (count("choice") < 2) out.push(`${at}: needs at least two multiple-choice questions`);
		for (const type of ["blank", "order", "match"]) if (count(type) < 1) out.push(`${at}: needs at least one ${type} exercise`);
		if (!pool.some((ex) => ex.level === 1)) out.push(`${at}: needs a level 1 exercise to lay the foundation`);
		if (!pool.some((ex) => ex.level === 3)) out.push(`${at}: needs a level 3 exercise for those who have it`);
	}
	return out;
}

/**
 * Every problem with what a course lesson adds (LC-17660): the tutor's
 * passage, what to look for in it, and the verses to memorize, one of which
 * holds the lesson's key verse.
 */
export function courseLessonProblems(lesson: PathLesson, deps: ContentDeps): string[] {
	const out: string[] = [];
	const at = typeof lesson?.id === "string" ? lesson.id : "a lesson";
	const parts: CourseLessonParts | undefined = lesson?.course;
	if (!parts || typeof parts !== "object") return [`${at}: a course lesson needs its tutor passage and memory verses`];
	const tutor = resolveAnswer(`${at} tutor passage`, parts.tutor, deps, COURSE_LIMITS.tutorMaxVerses);
	if ("problem" in tutor) out.push(tutor.problem);
	else if (passageLength(tutor.passage) < COURSE_LIMITS.tutorMinVerses) out.push(`${at}: the tutor passage needs at least ${COURSE_LIMITS.tutorMinVerses} verses to read closely`);
	const focus = textProblem(`${at} tutor focus`, parts.focus, COURSE_LIMITS.focus, COURSE_LIMITS.focusMin);
	if (focus) out.push(focus);
	const memory = Array.isArray(parts.memory) ? parts.memory : [];
	if (memory.length < COURSE_LIMITS.memoryMin || memory.length > COURSE_LIMITS.memoryMax) {
		out.push(`${at}: needs ${COURSE_LIMITS.memoryMin} to ${COURSE_LIMITS.memoryMax} memory verses, has ${memory.length}`);
	}
	const ranges: Passage[] = [];
	memory.forEach((ref, index) => {
		const resolved = resolveAnswer(`${at} memory verse ${index + 1}`, ref, deps, COURSE_LIMITS.memoryVerses);
		if ("problem" in resolved) {
			out.push(resolved.problem);
			return;
		}
		const overlaps = ranges.some(
			(other) => other.book === resolved.passage.book && other.chapter === resolved.passage.chapter && other.start <= resolved.passage.end && resolved.passage.start <= other.end
		);
		if (overlaps) out.push(`${at}: memory verse "${ref}" overlaps another one`);
		ranges.push(resolved.passage);
	});
	const key = parsePassage(lesson.keyVerse, deps.resolveBook);
	if (key && ranges.length && !ranges.some((range) => range.book === key.book && range.chapter === key.chapter && range.start <= key.start && key.end <= range.end)) {
		out.push(`${at}: the key verse ${lesson.keyVerse} must be one of the memory verses`);
	}
	return out;
}

/** Every problem with a written path; empty when it can ship. */
export function pathProblems(path: PathDef, deps: ContentDeps): string[] {
	const out: string[] = [];
	if (!ID_PATTERN.test(path.id)) out.push(`${path.id}: id must be a URL segment`);
	for (const [label, value, max] of [
		["title", path.title, PATH_LIMITS.title],
		["tagline", path.tagline, PATH_LIMITS.summary],
		["description", path.description, PATH_LIMITS.description],
	] as const) {
		const problem = textProblem(`${path.id} ${label}`, value, max);
		if (problem) out.push(problem);
	}
	if (!["Beginner friendly", "Growing", "Going deeper"].includes(path.audience)) out.push(`${path.id}: audience`);
	if (!path.topics.length || path.topics.some((topic) => !CONCEPT_PATTERN.test(topic))) out.push(`${path.id}: topics must be short lowercase labels`);
	if (path.units.length < 2 || path.units.length > 4) out.push(`${path.id}: needs two to four units`);
	const lessons = path.units.flatMap((unit) => unit.lessons);
	if (lessons.length < PATH_LIMITS.lessonsMin || lessons.length > PATH_LIMITS.lessonsMax) {
		out.push(`${path.id}: needs ${PATH_LIMITS.lessonsMin} to ${PATH_LIMITS.lessonsMax} lessons, has ${lessons.length}`);
	}
	const unitIds = new Set<string>();
	for (const unit of path.units) {
		if (!ID_PATTERN.test(unit.id) || unitIds.has(unit.id)) out.push(`${path.id}: unit id ${unit.id} must be unique`);
		unitIds.add(unit.id);
		for (const [label, value, max] of [["title", unit.title, PATH_LIMITS.title], ["summary", unit.summary, PATH_LIMITS.summary]] as const) {
			const problem = textProblem(`${unit.id} ${label}`, value, max);
			if (problem) out.push(problem);
		}
		if (unit.lessons.length < 2) out.push(`${unit.id}: needs at least two lessons`);
	}
	lessons.forEach((lesson, index) => {
		const expected = `${path.id}-${String(index + 1).padStart(2, "0")}`;
		if (lesson.id !== expected) out.push(`${lesson.id}: lessons are numbered in order, expected ${expected}`);
		out.push(...lessonProblems(lesson, deps));
		if (path.course) out.push(...courseLessonProblems(lesson, deps));
		else if (lesson.course) out.push(`${lesson.id}: only a course lesson has a tutor passage and memory verses`);
	});
	if (path.course) {
		const outcomes = Array.isArray(path.course.outcomes) ? path.course.outcomes : [];
		if (outcomes.length < COURSE_LIMITS.outcomesMin || outcomes.length > COURSE_LIMITS.outcomesMax) {
			out.push(`${path.id}: a course needs ${COURSE_LIMITS.outcomesMin} to ${COURSE_LIMITS.outcomesMax} outcomes`);
		}
		outcomes.forEach((outcome, index) => {
			const problem = textProblem(`${path.id} outcome ${index + 1}`, outcome, COURSE_LIMITS.outcome);
			if (problem) out.push(problem);
		});
	}
	if (path.readAlong) {
		const problem = textProblem(`${path.id} read-along label`, path.readAlong.label, PATH_LIMITS.title);
		if (problem) out.push(problem);
	}
	return out;
}

/* =========================================================================
 * Personal curriculum
 *
 * A path built around any topic a founder asks about, foundations first. The
 * model proposes an outline and, lesson by lesson when each is first opened,
 * the questions; everything it writes is checked with the same rules as the
 * written paths above, and anything that fails is dropped.
 * ====================================================================== */

export const TOPIC_MIN = 3;
export const TOPIC_MAX = 80;
export const CURRICULUM_LESSONS_MIN = 4;
export const CURRICULUM_LESSONS_MAX = 9;
/** Personal curricula a founder may keep at once. */
export const CURRICULA_MAX = 12;
const READING_MIN = 3;
const READING_MAX = 20;

/** The topic as asked, tidied, or null when it is empty, too long or only symbols. */
export function cleanTopic(raw: unknown): string | null {
	if (typeof raw !== "string") return null;
	const topic = raw.replace(/[\u0000-\u001f<>{}[\]\\`*_#]/g, " ").replace(/\s+/g, " ").trim();
	if (topic.length < TOPIC_MIN || topic.length > TOPIC_MAX || !/[A-Za-z]{2}/.test(topic)) return null;
	return topic;
}

/** Plain text from the model: single spaces, no markdown symbols, no dashes between words. */
export function plainText(raw: unknown, max: number): string | null {
	if (typeof raw !== "string") return null;
	const text = raw
		.replace(/[–—]/g, ", ")
		.replace(/\s-\s/g, ", ")
		.replace(/[*#`_]/g, "")
		.replace(/\s+/g, " ")
		.replace(/\s+([,.;:!?])/g, "$1")
		.replace(/,\s*,/g, ",")
		.trim();
	return text && text.length <= max ? text : null;
}

/** A concept label: lowercase letters, spaces and apostrophes, at most 40 characters. */
export function conceptLabel(raw: unknown, fallback: string): string {
	const label = typeof raw === "string" ? raw.toLowerCase().replace(/[^a-z' ]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40).trim() : "";
	if (/^[a-z][a-z' ]{1,39}$/.test(label)) return label;
	const backup = fallback.toLowerCase().replace(/[^a-z' ]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40).trim();
	return /^[a-z][a-z' ]{1,39}$/.test(backup) ? backup : "the topic";
}

/* -------------------------------------------------------------------------
 * The outline
 * ---------------------------------------------------------------------- */

export interface OutlineDraft {
	title: string;
	description: string;
	units: {
		title: string;
		summary: string;
		lessons: { title: string; summary: string; reading: string; keyVerse: string; concept: string }[];
	}[];
}

export interface CurriculumData {
	v: 1;
	topic: string;
	title: string;
	description: string;
	units: PathUnit[];
	/** Lessons whose questions have been written. */
	written: string[];
	model: string | null;
}

/**
 * The outline the model proposed, with every passage checked against the KJV
 * and every lesson it cannot stand behind dropped. Unit one is the
 * foundations; a curriculum with fewer than four good lessons is refused.
 */
export function checkOutline(draft: OutlineDraft, topic: string, deps: ContentDeps, model: string | null): CurriculumData | { error: string } {
	const title = plainText(draft.title, 70) ?? `${topic.charAt(0).toUpperCase()}${topic.slice(1)}`;
	const description = plainText(draft.description, 600) ?? `A personal path through what Scripture says about ${topic}, foundations first.`;
	const units: PathUnit[] = [];
	let count = 0;
	for (const rawUnit of Array.isArray(draft.units) ? draft.units.slice(0, 3) : []) {
		const lessons: PathLesson[] = [];
		for (const raw of Array.isArray(rawUnit?.lessons) ? rawUnit.lessons.slice(0, 4) : []) {
			if (count >= CURRICULUM_LESSONS_MAX) break;
			const lessonTitle = plainText(raw?.title, 70);
			const reading = parsePassage(typeof raw?.reading === "string" ? raw.reading.replace(/[–—]/g, "-").replace(/\s*-\s*/g, "-") : null, deps.resolveBook);
			if (!lessonTitle || !reading || passageLength(reading) < READING_MIN || passageLength(reading) > READING_MAX || !deps.verses(reading)) continue;
			const key = parsePassage(raw?.keyVerse, deps.resolveBook);
			// The verse to carry must be one the lesson reads.
			const inReading = key && key.book === reading.book && key.chapter === reading.chapter && key.start === key.end && key.start >= reading.start && key.start <= reading.end;
			const keyVerse: Passage = inReading ? key : { ...reading, end: reading.start };
			count += 1;
			const id = `lesson-${String(count).padStart(2, "0")}`;
			lessons.push({
				id,
				title: lessonTitle,
				summary: plainText(raw?.summary, 120) ?? formatPassage(reading),
				reading: formatPassage(reading),
				teaching: "",
				keyVerse: formatPassage(keyVerse),
				exercises: [],
				reflection: { prompt: "", answer: formatPassage(keyVerse) },
				concept: conceptLabel(raw?.concept, topic),
			});
		}
		if (lessons.length === 0) continue;
		units.push({
			id: `unit-${units.length + 1}`,
			title: plainText(rawUnit?.title, 70) ?? (units.length === 0 ? "Foundations" : `Part ${units.length + 1}`),
			summary: plainText(rawUnit?.summary, 120) ?? "",
			lessons,
		});
	}
	if (count < CURRICULUM_LESSONS_MIN) return { error: "too_few_lessons" };
	return { v: 1, topic, title, description, units, written: [], model };
}

/** The concept a curriculum lesson teaches. */
export function lessonConcept(lesson: PathLesson, topic: string): string {
	return conceptLabel(lesson.concept ?? lesson.exercises[0]?.concept, topic);
}

/* -------------------------------------------------------------------------
 * A lesson's questions
 * ---------------------------------------------------------------------- */

export interface LessonDraft {
	teaching: string;
	choice: { prompt: string; correct: string; wrong: string[]; verses: number[]; level: number; note: string | null }[];
	blank: { verse: number; word: string; wrong: string[]; level: number }[];
	order: { prompt: string; steps: { text: string; verse: number }[]; level: number } | null;
	match: { prompt: string; pairs: { verse: number; truth: string }[]; level: number } | null;
	reflection: { verse: number; prompt: string };
}

function level(raw: unknown): PathLevel {
	return raw === 1 || raw === 2 || raw === 3 ? raw : 2;
}

/** "Book c:v" or "Book c:v-w" for verse numbers inside the reading, or null. */
function refIn(reading: Passage, verses: unknown): string | null {
	const list = (Array.isArray(verses) ? verses : [verses]).filter((verse): verse is number => Number.isInteger(verse));
	const sorted = [...new Set(list)].sort((a, b) => a - b);
	if (sorted.length === 0 || sorted.length > 3) return null;
	if (sorted[0] < reading.start || sorted[sorted.length - 1] > reading.end) return null;
	if (sorted.some((verse, index) => index > 0 && verse !== sorted[index - 1] + 1)) return null;
	return formatPassage({ ...reading, start: sorted[0], end: sorted[sorted.length - 1] });
}

/**
 * The written lesson: teaching, the questions that survive the content rules,
 * and the reflection. Refused when the teaching is unusable or fewer than two
 * multiple-choice questions and four questions in all survive.
 */
export function checkLessonDraft(
	draft: LessonDraft,
	lesson: PathLesson,
	concept: string,
	deps: ContentDeps
): { lesson: PathLesson; dropped: string[] } | { error: string } {
	const reading = parsePassage(lesson.reading, deps.resolveBook);
	if (!reading) return { error: "bad_reading" };
	const teaching = plainText(draft.teaching, 700);
	if (!teaching || teaching.length < 80) return { error: "bad_teaching" };
	const exercises: PathExercise[] = [];
	const dropped: string[] = [];
	let n = 0;
	const keep = (ex: PathExercise) => {
		const problems = exerciseProblems(ex, deps);
		if (problems.length) dropped.push(...problems);
		else exercises.push(ex);
	};
	const next = () => `${lesson.id}.${++n}`;
	for (const raw of Array.isArray(draft.choice) ? draft.choice.slice(0, 5) : []) {
		const answer = refIn(reading, raw?.verses);
		const wrong = Array.isArray(raw?.wrong) ? raw.wrong.map((option) => plainText(option, 90) ?? "") : [];
		if (!answer) {
			dropped.push("choice verse outside the reading");
			continue;
		}
		const note = plainText(raw?.note, 240);
		keep({ id: next(), type: "choice", concept, level: level(raw?.level), prompt: plainText(raw?.prompt, 220) ?? "", correct: plainText(raw?.correct, 90) ?? "", wrong, answer, ...(note ? { note } : {}) });
	}
	for (const raw of Array.isArray(draft.blank) ? draft.blank.slice(0, 2) : []) {
		const answer = refIn(reading, raw?.verse);
		if (!answer) {
			dropped.push("blank verse outside the reading");
			continue;
		}
		const wrong = Array.isArray(raw?.wrong) ? raw.wrong.map((option) => (typeof option === "string" ? option.trim() : "")) : [];
		keep({ id: next(), type: "blank", concept, level: level(raw?.level), answer, word: typeof raw?.word === "string" ? raw.word.trim() : "", wrong });
	}
	if (draft.order && Array.isArray(draft.order.steps)) {
		const steps = draft.order.steps.map((step) => ({ text: plainText(step?.text, 90) ?? "", answer: refIn(reading, step?.verse) ?? "" }));
		keep({ id: next(), type: "order", concept, level: level(draft.order.level), prompt: plainText(draft.order.prompt, 220) ?? "", steps });
	}
	if (draft.match && Array.isArray(draft.match.pairs)) {
		const pairs = draft.match.pairs.map((pair) => ({ answer: refIn(reading, pair?.verse) ?? "", truth: plainText(pair?.truth, 90) ?? "" }));
		keep({ id: next(), type: "match", concept, level: level(draft.match.level), prompt: plainText(draft.match.prompt, 220) ?? "", pairs });
	}
	const choices = exercises.filter((ex) => ex.type === "choice").length;
	if (choices < 2 || exercises.length < 4) return { error: "too_few_questions" };
	const reflectionRef = refIn(reading, draft.reflection?.verse) ?? lesson.keyVerse;
	const reflectionPrompt = plainText(draft.reflection?.prompt, 220) ?? `What does ${lesson.keyVerse} ask of you today?`;
	return {
		lesson: { ...lesson, teaching, exercises, reflection: { prompt: reflectionPrompt, answer: reflectionRef } },
		dropped,
	};
}

/* -------------------------------------------------------------------------
 * Reading a stored curriculum
 * ---------------------------------------------------------------------- */

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The stored curriculum as a path, or null when the data is not one. */
export function readCurriculum(value: unknown, pathId: string): { path: PathDef; topic: string; written: string[]; model: string | null } | null {
	if (!isRecord(value) || value.v !== 1 || typeof value.topic !== "string" || typeof value.title !== "string" || !Array.isArray(value.units)) return null;
	const units = (value.units as unknown[]).filter((unit): unit is PathUnit => isRecord(unit) && typeof unit.id === "string" && typeof unit.title === "string" && Array.isArray(unit.lessons));
	if (units.length === 0) return null;
	const written = Array.isArray(value.written) ? value.written.filter((id): id is string => typeof id === "string") : [];
	return {
		topic: value.topic,
		written,
		model: typeof value.model === "string" ? value.model : null,
		path: {
			id: pathId,
			title: value.title,
			tagline: `A personal curriculum on ${value.topic}`,
			description: typeof value.description === "string" ? value.description : "",
			audience: "Growing",
			topics: [value.topic.toLowerCase().slice(0, 60)],
			readAlong: null,
			units: units.map((unit) => ({ ...unit, summary: typeof unit.summary === "string" ? unit.summary : "" })),
		},
	};
}

/** The curriculum with one lesson replaced by its written version. */
export function withWrittenLesson(data: CurriculumData, lesson: PathLesson): CurriculumData {
	return {
		...data,
		units: data.units.map((unit) => ({ ...unit, lessons: unit.lessons.map((entry) => (entry.id === lesson.id ? { ...lesson, concept: lessonConcept(entry, data.topic) } : entry)) })),
		written: data.written.includes(lesson.id) ? data.written : [...data.written, lesson.id],
	};
}

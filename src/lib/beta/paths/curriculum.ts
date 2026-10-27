import "server-only";

import { generateText, Output } from "ai";
import { z } from "zod";
import type { BetaItem } from "@prisma/client";
import { stripDashes } from "@/lib/ai/plain-dashes";
import { resolveModel } from "@/lib/ai/provider";
import { createBetaItem, deleteBetaItem, getBetaItem, listBetaItems, updateBetaItem } from "@/lib/beta/store";
import { betaRefKey } from "@/lib/beta/store-rules";
import { hasCurrentAiConsent } from "@/lib/preferences-contract";
import { prisma } from "@/lib/prisma";
import { formatVersesForModel, searchScripture } from "@/lib/scripture-search";
import { systemPrompt } from "@/utils/systemPrompt";
import {
	CURRICULA_MAX,
	CURRICULUM_LESSONS_MAX,
	checkLessonDraft,
	checkOutline,
	lessonConcept,
	readCurriculum,
	withWrittenLesson,
	type CurriculumData,
	type LessonDraft,
	type OutlineDraft,
} from "./content-rules";
import { lessonsOf } from "./progress-rules";
import { PATHS_MODULE, contentDeps, curriculumPathId, loadChapters, passageOf, type PathsError } from "./server";

/**
 * The personal curriculum (LC-17648, docs/beta/paths.md; LC-17631's big idea
 * C): a founder names any topic and gets a path through Scripture with its
 * foundations first. Two model calls, each only when the founder asks: the
 * outline when the curriculum is requested, and each lesson's questions the
 * first time that lesson is opened. Every passage, answer and blank is checked
 * against the bundled KJV (`content-rules.ts`); nothing is pre-generated.
 */

const OUTLINE_TIMEOUT_MS = 90_000;
const LESSON_TIMEOUT_MS = 90_000;
/** Candidate passages from Scripture search handed to the outline. */
const CANDIDATE_VERSES = 12;

const plain = (text: string) => stripDashes(text.replace(/\s+/g, " ").trim());

const outlineSchema = z.object({
	title: z.string().describe("The curriculum's title, at most 8 words"),
	description: z.string().describe("Two plain sentences on what it covers and why the foundations come first"),
	units: z
		.array(
			z.object({
				title: z.string().describe("Unit title, at most 6 words; the first unit is the foundations"),
				summary: z.string().describe("One plain sentence"),
				lessons: z
					.array(
						z.object({
							title: z.string().describe("At most 8 words"),
							summary: z.string().describe("One plain sentence on what the lesson teaches"),
							reading: z.string().describe('One KJV passage inside one chapter, 4 to 15 verses, written like "John 14:15-26"'),
							keyVerse: z.string().describe('The verse in that passage worth memorising, like "John 14:26"'),
							concept: z.string().describe('A short lowercase label for the truth taught, like "the comforter"'),
						})
					)
					.min(2)
					.max(4),
			})
		)
		.min(2)
		.max(3),
});

const lessonSchema = z.object({
	teaching: z.string().describe("Two to four sentences, at most 600 characters, plain modern English"),
	choice: z
		.array(
			z.object({
				prompt: z.string(),
				correct: z.string().describe("In the verse's own words, at most 12 words"),
				wrong: z.array(z.string()).length(3),
				verses: z.array(z.number().int()).min(1).max(3).describe("Consecutive verse numbers in the reading that state the answer"),
				level: z.number().int().min(1).max(3),
				note: z.string().nullable(),
			})
		)
		.min(3)
		.max(5),
	blank: z
		.array(
			z.object({
				verse: z.number().int(),
				word: z.string().describe("One to three meaningful words copied exactly from that verse, appearing once in it"),
				wrong: z.array(z.string()).length(3),
				level: z.number().int().min(1).max(3),
			})
		)
		.min(1)
		.max(2),
	order: z.object({
		prompt: z.string(),
		steps: z.array(z.object({ text: z.string().describe("In the words of its own verse"), verse: z.number().int() })).min(3).max(5),
		level: z.number().int().min(1).max(3),
	}),
	match: z.object({
		prompt: z.string(),
		pairs: z.array(z.object({ verse: z.number().int(), truth: z.string().describe("In that verse's own words") })).min(3).max(4),
		level: z.number().int().min(1).max(3),
	}),
	reflection: z.object({ verse: z.number().int(), prompt: z.string().describe("One gentle personal question, at most 25 words") }),
});

const OUTLINE_TASK = `CURRENT TASK: A believer has asked SureWord Beta to build a personal curriculum: a short course through Scripture on one topic, which they will take lesson by lesson.

Build it the way a careful pastor-teacher would: FOUNDATIONS FIRST. Unit one lays the foundations the topic depends on (for eschatology, for example: God's covenants, how the prophets spoke, reading prophecy in context; for the Holy Spirit: who God is, the Spirit's deity, the promise of the Comforter). Then the core of the topic itself, then going deeper.

RULES:
- Two or three units, ${CURRICULUM_LESSONS_MAX - 3} to ${CURRICULUM_LESSONS_MAX} lessons in all, two to four per unit, in the order they should be learned.
- Every lesson is built on ONE passage of the King James Bible inside ONE chapter, 4 to 15 verses, written exactly like "John 14:15-26" (the full book name, then chapter:first-last). Choose the passages that teach the lesson most directly. The candidate verses below come from Scripture search; use them when they fit, but any passage may be chosen.
- keyVerse: one verse inside that passage worth memorising.
- concept: a short lowercase label (one to three words) for the truth the lesson teaches. Lessons teaching the same truth share a label.
- Teach what Scripture says. Where Bible-believing Christians differ (end-times schemes, the timing of the rapture, sign gifts, baptism, election), build the lessons on the passages and name them by what the text says, never by a system or a camp.
- If Scripture does not address the topic directly, build the course on what Scripture says that bears most directly on it, and say so in the description.
- Plain text everywhere: no markdown, no quotation marks around titles, no dashes between words.`;

function lessonTask(curriculum: CurriculumData, title: string, summary: string, concept: string, reading: string): string {
	return `CURRENT TASK: Write one lesson of a personal curriculum, "${curriculum.title}" (topic: ${curriculum.topic}). The lesson is "${title}": ${summary} It teaches "${concept}". The reading is ${reading} in the King James Bible, given verse by verse below. Every question must be answered by a verse IN THIS READING, in that verse's own King James words, because the reader will be shown the verse as the answer.

WRITE:
- teaching: two to four sentences (at most 600 characters) in plain modern English on what the passage teaches about ${concept}, ending with one sentence on why it matters for understanding ${curriculum.topic} (this lesson is part of a course on that topic). Faithful to the text, interpretation kept modest. Never question or soften Scripture.
- Questions are plain modern English, one clear sentence each, and ask about what the verse says.
- choice: four multiple-choice questions spread across the reading. "correct" uses the verse's own key words (at most 12 words). "wrong" are three answers that are plausible to someone who skimmed, clearly NOT what the verse says, and never something the reading also says; all four choices the same form and roughly the same length. "verses" are the verse numbers that state the answer (one to three, consecutive). "level": 1 for what the verse plainly says, 2 for its meaning, 3 for deeper (connecting verses, drawing out the doctrine). "note": one sentence on why it matters, or null.
- blank: two fill-in-the-blank items. "verse" is a verse number; "word" is one to three meaningful words copied EXACTLY from that verse (same spelling and capitals) that appear only once in it; "wrong" are three other words of the same kind that do not fit.
- order: three to five steps of the passage's events or argument, listed in the RIGHT order, each "text" in the words of its own verse with "verse" its number; "prompt" says what order ("in the order they happened").
- match: three or four pairs, each a different verse number and a truth in that verse's own words that fits only that verse.
- reflection: one gentle personal question (at most 25 words) about one verse. Speak to "you"; do not assume the reader is saved or unsaved.
Never ask about verse numbers, never a trick or negative question, never "all of the above". Plain text, no markdown, no dashes between words.`;
}

export class CurriculumUnavailableError extends Error {}

async function requireConsent(userId: string): Promise<PathsError | null> {
	const user = await prisma.user.findUnique({ where: { id: userId }, select: { aiConsentVersion: true, aiConsentAt: true } });
	return hasCurrentAiConsent(user) ? null : { error: "AI is turned off for your account. You can turn it on in Settings, AI.", status: 403 };
}

function curriculumBody(data: CurriculumData): string {
	const lines = [`Personal curriculum on ${data.topic}.`, data.description];
	for (const unit of data.units) {
		lines.push("", unit.title);
		for (const lesson of unit.lessons) lines.push(`${lesson.title} (${lesson.reading}): ${lesson.summary}`);
	}
	return lines.join("\n");
}

function curriculumRefs(data: CurriculumData): string[] {
	return data.units.flatMap((unit) =>
		unit.lessons.flatMap((lesson) => {
			const passage = passageOf(lesson.reading);
			if (!passage) return [];
			return Array.from({ length: passage.end - passage.start + 1 }, (_, offset) => betaRefKey(passage.book, passage.chapter, passage.start + offset));
		})
	);
}

function curriculumTopics(data: CurriculumData): string[] {
	const concepts = data.units.flatMap((unit) => unit.lessons.map((lesson) => lessonConcept(lesson, data.topic)));
	return [...new Set([data.topic.toLowerCase().slice(0, 60), ...concepts])].slice(0, 50);
}

/** Build a curriculum for `topic`: one outline call, checked against the KJV, stored as the founder's. */
export async function createCurriculum(userId: string, topic: string): Promise<{ pathId: string } | PathsError> {
	const consent = await requireConsent(userId);
	if (consent) return consent;
	const existing = await listBetaItems(userId, { module: PATHS_MODULE, kind: "curriculum", take: CURRICULA_MAX + 1 });
	if (existing.length >= CURRICULA_MAX) return { error: `You can keep ${CURRICULA_MAX} curricula at a time. Delete one to build another.`, status: 409 };

	const candidates = await searchScripture(topic, CANDIDATE_VERSES).catch(() => ({ verses: [] }));
	const resolved = await resolveModel({ userId, modelId: null, effort: "low", structured: true });
	const { output } = await generateText({
		model: resolved.model,
		providerOptions: resolved.providerOptions,
		output: Output.object({ schema: outlineSchema }),
		instructions: `${systemPrompt}\n\n${OUTLINE_TASK}`,
		prompt: `Topic: ${topic}\n\nCandidate verses from Scripture search:\n${formatVersesForModel(candidates.verses)}`,
		abortSignal: AbortSignal.timeout(OUTLINE_TIMEOUT_MS),
	});
	if (!output) throw new CurriculumUnavailableError("The model returned no outline.");

	const draft = output as OutlineDraft;
	const refs = draft.units.flatMap((unit) => unit.lessons.flatMap((lesson) => [lesson.reading, lesson.keyVerse]));
	const chapters = await loadChapters(refs.map((ref) => ref.replace(/[–—]/g, "-").replace(/\s*-\s*/g, "-")).filter((ref) => passageOf(ref)));
	const checked = checkOutline(
		{
			title: plain(draft.title),
			description: plain(draft.description),
			units: draft.units.map((unit) => ({ ...unit, title: plain(unit.title), summary: plain(unit.summary), lessons: unit.lessons.map((lesson) => ({ ...lesson, title: plain(lesson.title), summary: plain(lesson.summary) })) })),
		},
		topic,
		contentDeps(chapters),
		resolved.definition.id
	);
	if ("error" in checked) throw new CurriculumUnavailableError(`The outline did not hold up: ${checked.error}`);

	const item = await createBetaItem(userId, {
		module: PATHS_MODULE,
		kind: "curriculum",
		title: checked.title,
		body: curriculumBody(checked),
		data: checked as unknown as Record<string, unknown>,
		refs: curriculumRefs(checked),
		topics: curriculumTopics(checked),
	});
	return { pathId: curriculumPathId(item.id) };
}

async function ownCurriculum(userId: string, pathId: string): Promise<{ item: BetaItem; data: CurriculumData } | null> {
	const match = /^c-([a-z0-9]{8,40})$/.exec(pathId);
	if (!match) return null;
	const item = await getBetaItem(userId, match[1]);
	if (!item || item.module !== PATHS_MODULE || item.kind !== "curriculum") return null;
	const read = readCurriculum(item.data, pathId);
	if (!read) return null;
	return { item, data: item.data as unknown as CurriculumData };
}

/**
 * Write one curriculum lesson's teaching and questions, the first time it is
 * opened. A lesson already written is left alone. Up to two model calls when
 * too few questions survive the KJV checks.
 */
export async function writeCurriculumLesson(userId: string, pathId: string, lessonId: string): Promise<{ written: boolean } | PathsError> {
	const own = await ownCurriculum(userId, pathId);
	if (!own) return { error: "Not found", status: 404 };
	const read = readCurriculum(own.item.data, pathId)!;
	const lesson = lessonsOf(read.path).find((entry) => entry.id === lessonId);
	if (!lesson) return { error: "Not found", status: 404 };
	if (read.written.includes(lessonId)) return { written: false };
	const consent = await requireConsent(userId);
	if (consent) return consent;

	const reading = passageOf(lesson.reading);
	if (!reading) return { error: "Not found", status: 404 };
	const chapters = await loadChapters([lesson.reading]);
	const deps = contentDeps(chapters);
	const verses = deps.verses(reading) ?? [];
	const concept = lessonConcept(lesson, own.data.topic);
	const resolved = await resolveModel({ userId, modelId: null, effort: "low", structured: true });
	let failure = "";
	for (let attempt = 0; attempt < 2; attempt += 1) {
		const { output } = await generateText({
			model: resolved.model,
			providerOptions: resolved.providerOptions,
			output: Output.object({ schema: lessonSchema }),
			instructions: `${systemPrompt}\n\n${lessonTask(own.data, lesson.title, lesson.summary, concept, lesson.reading)}`,
			prompt: [`${lesson.reading} (KJV), verse by verse:`, ...verses.map((text, offset) => `${reading.start + offset} ${text}`)].join("\n"),
			abortSignal: AbortSignal.timeout(LESSON_TIMEOUT_MS),
		});
		if (!output) {
			failure = "no output";
			continue;
		}
		const checked = checkLessonDraft(output as LessonDraft, lesson, concept, deps);
		if ("error" in checked) {
			failure = checked.error;
			continue;
		}
		if (checked.dropped.length) console.info(`paths curriculum ${pathId} ${lessonId}: dropped ${checked.dropped.length}: ${checked.dropped.slice(0, 6).join(" | ")}`);
		// Re-read before writing: another lesson may have been written meanwhile.
		const latest = await ownCurriculum(userId, pathId);
		if (!latest) return { error: "Not found", status: 404 };
		// Opened twice at once: the first one written stays, so a session started on it keeps its questions.
		if (latest.data.written.includes(lessonId)) return { written: false };
		const data = withWrittenLesson(latest.data, checked.lesson);
		await updateBetaItem(userId, latest.item.id, { data: data as unknown as Record<string, unknown>, body: curriculumBody(data), topics: curriculumTopics(data) });
		return { written: true };
	}
	throw new CurriculumUnavailableError(`The lesson did not hold up: ${failure}`);
}

export async function deleteCurriculum(userId: string, pathId: string): Promise<boolean> {
	const own = await ownCurriculum(userId, pathId);
	return own ? deleteBetaItem(userId, own.item.id) : false;
}

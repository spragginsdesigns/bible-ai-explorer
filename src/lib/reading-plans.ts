import "server-only";

import { generateText, Output } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { resolveModel } from "@/lib/ai/provider";
import { PERSONA } from "@/lib/daily-cross";
import { loadStudyContext } from "@/lib/study-context";
import {
	MAX_PLAN_DAYS,
	MIN_PLAN_DAYS,
	READING_PLAN_PRESETS,
	buildPresetPlan,
	describeReadings,
	sanitizeReadingPlanDays,
	type ReadingPlanDay,
	type ReadingPlanPresetSummary,
} from "@/lib/reading-plan-presets";
import {
	computePlanProgress,
	readingKey,
	type ReadingPlanDayProgress,
} from "@/lib/reading-plan-progress";

/**
 * Reading plans: a user follows one plan at a time, and the plan fills itself
 * in from what they actually read in the Bible reader.
 *
 * Storage and orchestration only - the plan arithmetic lives in
 * `reading-plan-presets.ts` and the progress rules in
 * `reading-plan-progress.ts`, both pure and both directly tested.
 *
 * This module and `study-context.ts` import each other: the study context has
 * to know today's plan reading (so the daily cross and the opening questions
 * see it), and the AI plan writer has to know the user's walk. That cycle is
 * only safe because nothing here touches an imported binding at module
 * evaluation time - `PERSONA` in particular is read inside a function, never
 * in a top-level template literal. Keep it that way.
 */

export type ReadingPlanStatus = "active" | "completed" | "archived";
export type ReadingPlanSource = "preset" | "ai";

/** One plan with everything a client needs to draw it. */
export interface PlanWithProgress {
	id: string;
	title: string;
	description: string;
	source: ReadingPlanSource;
	presetKey: string | null;
	/** ISO timestamp the plan started; day 1 begins here. */
	startDate: string;
	status: ReadingPlanStatus;
	dayCount: number;
	todayDay: number;
	currentDay: number;
	completedCount: number;
	percent: number;
	streak: number;
	days: ReadingPlanDayProgress[];
}

/** What `GET /api/reading-plans` answers. */
export interface ReadingPlansView {
	active: PlanWithProgress | null;
	presets: ReadingPlanPresetSummary[];
}

/** A request the user got wrong (unknown preset, day out of range): a 400, not a 500. */
export class ReadingPlanError extends Error {}

/** How a plan is started: one of ours, or one the model writes for them. */
export type StartPlanRequest = { presetKey: string } | { goal: string; days: number };

interface PlanRow {
	id: string;
	title: string;
	description: string;
	source: string;
	presetKey: string | null;
	startDate: Date;
	days: string;
	status: string;
}

const PLAN_SELECT = {
	id: true,
	title: true,
	description: true,
	source: true,
	presetKey: true,
	startDate: true,
	days: true,
	status: true,
} as const;

/** Stored JSON back into days, dropping anything that no longer validates. */
function parseStoredDays(json: string): ReadingPlanDay[] {
	try {
		return sanitizeReadingPlanDays(JSON.parse(json));
	} catch {
		// A malformed row renders as an empty plan rather than a 500; the user
		// can archive it and start another.
		return [];
	}
}

function asStatus(value: string): ReadingPlanStatus {
	return value === "completed" || value === "archived" ? value : "active";
}

function asSource(value: string): ReadingPlanSource {
	return value === "ai" ? "ai" : "preset";
}

/**
 * Attach progress to a stored plan: explicit completions, plus every day whose
 * chapters all appear in the user's reading history since the plan began.
 */
async function withProgress(userId: string, row: PlanRow): Promise<PlanWithProgress> {
	const days = parseStoredDays(row.days);

	const [completions, readingEvents] = await Promise.all([
		prisma.readingPlanCompletion.findMany({ where: { planId: row.id }, select: { day: true } }),
		prisma.readingEvent.findMany({
			where: { userId, readAt: { gte: row.startDate } },
			select: { book: true, chapter: true },
		}),
	]);

	const progress = computePlanProgress({
		days,
		startDate: row.startDate,
		now: new Date(),
		markedDays: completions.map((completion) => completion.day),
		readChapters: readingEvents.map((event) => readingKey(event.book, event.chapter)),
	});

	// Finishing the last day retires the plan without the user having to say so.
	let status = asStatus(row.status);
	if (status === "active" && progress.dayCount > 0 && progress.completedCount === progress.dayCount) {
		await prisma.readingPlan.update({ where: { id: row.id }, data: { status: "completed" } });
		status = "completed";
	}

	return {
		id: row.id,
		title: row.title,
		description: row.description,
		source: asSource(row.source),
		presetKey: row.presetKey,
		startDate: row.startDate.toISOString(),
		status,
		dayCount: progress.dayCount,
		todayDay: progress.todayDay,
		currentDay: progress.currentDay,
		completedCount: progress.completedCount,
		percent: progress.percent,
		streak: progress.streak,
		days: progress.days,
	};
}

/**
 * The plan the user is following, with progress. `null` when they have none -
 * a plan that just finished still comes back, so the client can say so before
 * offering the next one.
 */
export async function getActivePlan(userId: string): Promise<PlanWithProgress | null> {
	const row = await prisma.readingPlan.findFirst({
		where: { userId, status: { in: ["active", "completed"] } },
		orderBy: { createdAt: "desc" },
		select: PLAN_SELECT,
	});
	if (!row) return null;
	return withProgress(userId, row);
}

/** Everything the plan screen opens with. */
export async function getReadingPlansView(userId: string): Promise<ReadingPlansView> {
	const active = await getActivePlan(userId);
	return { active, presets: READING_PLAN_PRESETS };
}

/** One plan of the caller's, or a 400-shaped error. */
async function requireOwnPlan(userId: string, planId: string): Promise<PlanRow> {
	const row = await prisma.readingPlan.findFirst({
		where: { id: planId, userId },
		select: PLAN_SELECT,
	});
	if (!row) throw new ReadingPlanError("That reading plan was not found.");
	return row;
}

/**
 * Start a plan, archiving whatever the user was on. One plan at a time is a
 * product decision, not a schema one - it is enforced here, in the one place
 * plans are created.
 */
export async function startPlan(userId: string, request: StartPlanRequest): Promise<PlanWithProgress> {
	const built =
		"presetKey" in request
			? buildPreset(request.presetKey)
			: await generateReadingPlan(userId, { goal: request.goal, days: request.days });

	if (built.days.length === 0) {
		throw new ReadingPlanError("That plan came back empty. Try a different goal or a preset.");
	}

	await prisma.readingPlan.updateMany({
		where: { userId, status: { in: ["active", "completed"] } },
		data: { status: "archived" },
	});

	const row = await prisma.readingPlan.create({
		data: {
			userId,
			title: built.title,
			description: built.description,
			source: built.source,
			presetKey: built.presetKey,
			startDate: new Date(),
			days: JSON.stringify(built.days),
			status: "active",
		},
		select: PLAN_SELECT,
	});

	return withProgress(userId, row);
}

interface BuiltPlan {
	title: string;
	description: string;
	source: ReadingPlanSource;
	presetKey: string | null;
	days: ReadingPlanDay[];
}

function buildPreset(presetKey: string): BuiltPlan {
	const preset = buildPresetPlan(presetKey);
	if (!preset) throw new ReadingPlanError(`"${presetKey}" is not one of the reading plans.`);
	return {
		title: preset.title,
		description: preset.description,
		source: "preset",
		presetKey: preset.key,
		days: preset.days,
	};
}

/** Tick or untick one day by hand, for reading done outside the app. */
export async function setDayDone(
	userId: string,
	planId: string,
	day: number,
	done: boolean
): Promise<PlanWithProgress> {
	const row = await requireOwnPlan(userId, planId);
	const dayCount = parseStoredDays(row.days).length;
	if (!Number.isInteger(day) || day < 1 || day > dayCount) {
		throw new ReadingPlanError(`This plan has days 1 to ${dayCount}.`);
	}

	if (done) {
		await prisma.readingPlanCompletion.upsert({
			where: { planId_day: { planId, day } },
			update: {},
			create: { planId, day },
		});
	} else {
		await prisma.readingPlanCompletion.deleteMany({ where: { planId, day } });
	}

	// Un-ticking the last day of a finished plan puts the user back on it.
	if (!done && asStatus(row.status) === "completed") {
		await prisma.readingPlan.update({ where: { id: planId }, data: { status: "active" } });
	}

	return withProgress(userId, { ...row, status: done ? row.status : "active" });
}

export function markDay(userId: string, planId: string, day: number): Promise<PlanWithProgress> {
	return setDayDone(userId, planId, day, true);
}

export function unmarkDay(userId: string, planId: string, day: number): Promise<PlanWithProgress> {
	return setDayDone(userId, planId, day, false);
}

/**
 * Put a plan away. Archived plans and their completions stay in the database -
 * the user may start the same preset again, and their old progress is history,
 * not clutter.
 */
export async function archivePlan(userId: string, planId: string): Promise<void> {
	await requireOwnPlan(userId, planId);
	await prisma.readingPlan.update({ where: { id: planId }, data: { status: "archived" } });
}

/** Today's reading in one line, for prompts. `null` when nothing is running. */
export interface TodayPlanReading {
	planTitle: string;
	day: number;
	dayCount: number;
	readings: { book: string; chapter: number }[];
	/** "Matthew 1-3" */
	reference: string;
	focus: string;
	done: boolean;
}

export async function getTodayPlanReading(userId: string): Promise<TodayPlanReading | null> {
	const plan = await getActivePlan(userId);
	if (!plan || plan.status !== "active") return null;
	const day = plan.days.find((candidate) => candidate.day === plan.currentDay);
	if (!day) return null;
	return {
		planTitle: plan.title,
		day: day.day,
		dayCount: plan.dayCount,
		readings: day.readings,
		reference: describeReadings(day.readings),
		focus: day.focus,
		done: day.done,
	};
}

const aiPlanSchema = z.object({
	title: z.string().describe("A short, plain title for this plan, 3-7 words."),
	description: z
		.string()
		.describe("One sentence telling the user what this plan walks them through and why."),
	days: z
		.array(
			z.object({
				day: z.number().int().min(1),
				readings: z
					.array(
						z.object({
							book: z.string().describe("Canonical KJV book name, e.g. 'John' or '1 Corinthians'."),
							chapter: z.number().int().min(1),
						})
					)
					.min(1)
					.max(6),
				focus: z.string().describe("One sentence: what to look for while reading this day."),
			})
		)
		.min(1),
});

/**
 * Write a plan for a goal the user typed, grounded in their real walk.
 *
 * The model chooses the passages; it does not get to invent them. Every book
 * and chapter is checked against the KJV canon by `sanitizeReadingPlanDays`
 * before anything is stored, so a hallucinated Psalm 151 costs that line and
 * nothing else.
 */
export async function generateReadingPlan(
	userId: string,
	request: { goal: string; days: number }
): Promise<BuiltPlan> {
	const goal = request.goal.trim();
	if (!goal) throw new ReadingPlanError("Tell me what you want the plan to walk you through.");

	const dayCount = Math.min(Math.max(Math.round(request.days), MIN_PLAN_DAYS), MAX_PLAN_DAYS);
	const context = await loadStudyContext(userId);

	// PERSONA is read here, inside the function, and not at module scope - see
	// the cycle note at the top of this file.
	const instructions = `${PERSONA}

You are building a Bible reading plan for one person. A plan is a list of days; each day names the chapters to read and one line on what to watch for while reading them.

Rules, all non-negotiable:
- Every book must be a real book of the King James Bible, named canonically ("Psalms", "1 Corinthians", "Song of Solomon"), and every chapter must exist in that book. A chapter you are unsure of is one to leave out.
- Produce exactly ${dayCount} days, numbered 1 to ${dayCount} with no gaps.
- One to four chapters a day unless the goal plainly calls for more. Keep it a load an ordinary person finishes before work.
- Read passages in their own order rather than scattering a book across the plan, and keep whole arguments together - do not split the middle of Romans 8 across two days.
- The focus line is one plain sentence, second person, no headings and no markdown.
- Serve the goal they actually named. Their recent walk below is context for pitching it, not a second goal to satisfy; never claim a history the context does not show.`;

	const prompt = [
		`What they asked the plan to walk them through, in their own words:\n"${goal}"`,
		`Days: ${dayCount}`,
		`Bible chapters they have been reading lately:\n${context.readingBlock}`,
		`Recent things they asked about:\n${context.questionsBlock}`,
		`Recent notes:\n${context.notesBlock}`,
		`What you remember about them:\n${context.memoriesBlock}`,
	].join("\n\n");

	const { model, providerOptions } = await resolveModel({ userId, utility: true });
	const { output } = await generateText({
		model,
		providerOptions,
		output: Output.object({ schema: aiPlanSchema }),
		instructions,
		prompt,
	});
	if (!output) throw new ReadingPlanError("The plan could not be written. Try again in a moment.");

	const days = sanitizeReadingPlanDays(output.days);
	if (days.length === 0) {
		throw new ReadingPlanError(
			"That plan came back with no readable Scripture in it. Try describing the goal differently."
		);
	}

	return {
		title: output.title.trim() || goal.slice(0, 60),
		description: output.description.trim(),
		source: "ai",
		presetKey: null,
		days,
	};
}

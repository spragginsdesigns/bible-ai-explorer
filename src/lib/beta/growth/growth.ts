import "server-only";

import type { BetaItem } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createBetaItem, deleteBetaItem, getBetaItem, listBetaActivity, listBetaItems, updateBetaItem } from "@/lib/beta/store";
import { betaRefKey } from "@/lib/beta/store-rules";
import { bookByOrder, resolveReference } from "@/lib/bible/books";
import { learnTimezone } from "@/lib/learn";
import { localDayKey, resolveReadingTimezone } from "@/lib/reading-history";
import {
	GROWTH_MODULE,
	HABIT_TEMPLATES,
	HISTORY_WEEKS,
	addDays,
	applyPracticeAction,
	canCheckDay,
	checkHabitPatch,
	checkNewHabit,
	checkPracticeText,
	checkReflectionPrompt,
	checkReflectionText,
	daysWithGod,
	earliestWeekStart,
	followUpDay,
	habitSource,
	isFollowUpChoice,
	isFollowUpDue,
	isManualHabit,
	keptDays,
	parseHabitData,
	parsePracticeData,
	parseReflectionData,
	resolveWeekStart,
	setCheck,
	weekDays,
	weekLine,
	weekMarks,
	weekStartOf,
	type ActivityDays,
	type GrowthResult,
	type HabitData,
	type HabitInput,
	type HabitSource,
	type HabitType,
	type PracticeAction,
	type PracticeData,
	type PracticeStatus,
	type ReflectionData,
} from "@/lib/beta/growth/growth-rules";

/**
 * Habits & Reflection's server half (docs/beta/growth.md). Everything it
 * keeps is a `BetaItem` of module "growth" written through the shared store:
 * kind "habit", "reflection" and "practice". What it counts comes from what
 * SureWord already records, read here and never copied: reading from the
 * reading log's day counters, Scripture memory from Learn a verse reviews,
 * and study from the other beta modules' items.
 *
 * Reflections and practice items are private. Their words live only in the
 * item's `data` (marked `private: true`), never in `title` or `body`, which
 * are what the Knowledge Vault indexes, so nothing the founder writes here
 * reaches another module or an AI unless they press "Talk it over" and send
 * it themselves.
 */

const HABIT = "habit";
const REFLECTION = "reflection";
const PRACTICE = "practice";
const REFLECTION_TITLE = "Private reflection";
const PRACTICE_TITLE = "Put into practice";
const REFLECTIONS_TAKE = 500;
const PRACTICES_TAKE = 200;

export class GrowthInputError extends Error {}

function unwrap<T>(result: GrowthResult<T>): T {
	if (!result.ok) throw new GrowthInputError(result.error);
	return result.value;
}

/**
 * The founder's calendar: the timezone the browser sent when it is real, else
 * the one their phone last told SureWord, else SureWord's default.
 */
export async function growthTimezone(userId: string, requested: string | null): Promise<string> {
	if (requested) {
		const resolved = resolveReadingTimezone(requested);
		if (resolved === requested) return resolved;
	}
	return resolveReadingTimezone(await learnTimezone(userId));
}

/** "James 1:19" -> its canonical label and passage key, or null when empty. */
function resolvePassage(input: unknown): { label: string; refs: string[] } | null {
	if (input === undefined || input === null) return null;
	if (typeof input !== "string") throw new GrowthInputError("A passage is text, like James 1:19.");
	const text = input.trim();
	if (!text) return null;
	const reference = resolveReference(text);
	const book = reference ? bookByOrder(reference.order) : null;
	if (!reference || !book) throw new GrowthInputError(`"${text.slice(0, 40)}" is not a passage SureWord knows. Try one like James 1:19.`);
	const label = reference.verse === undefined ? `${book.name} ${reference.chapter}` : `${book.name} ${reference.chapter}:${reference.verse}`;
	return { label, refs: [betaRefKey(reference.order, reference.chapter, reference.verse)] };
}

// ----- What the founder did, by day -----

/** Days SureWord saw reading, memory work and study between two days on the founder's calendar. */
async function activityDays(userId: string, timezone: string, fromDay: string, toDay: string): Promise<Omit<ActivityDays, "reflection">> {
	// A day starts at most 14 hours before UTC midnight; a day of margin covers every zone.
	const since = new Date(Date.parse(`${fromDay}T00:00:00.000Z`) - 86_400_000);
	const [readingDays, receipts, cards, items] = await Promise.all([
		prisma.readingLogDay.findMany({
			where: { userId, localDate: { gte: fromDay, lte: toDay }, entries: { gt: 0 } },
			select: { localDate: true },
		}),
		// Every review a client syncs leaves a receipt; they outlive the card.
		prisma.learnReviewReceipt.findMany({
			where: { userId, createdAt: { gte: since } },
			select: { createdAt: true },
			take: 20_000,
		}),
		// Each card's latest review, for reviews that came without a receipt.
		prisma.verseMemory.findMany({
			where: { userId, lastReviewedAt: { gte: since } },
			select: { lastReviewedAt: true },
			take: 20_000,
		}),
		listBetaActivity(userId, { since, excludeModule: GROWTH_MODULE }),
	]);
	const inRange = (day: string) => day >= fromDay && day <= toDay;
	const daysOf = (instants: (Date | null)[]) =>
		new Set(instants.flatMap((instant) => (instant ? [localDayKey(instant, timezone)] : [])).filter(inRange));
	return {
		reading: new Set(readingDays.map((row) => row.localDate)),
		memory: daysOf([...receipts.map((row) => row.createdAt), ...cards.map((row) => row.lastReviewedAt)]),
		study: daysOf(items.flatMap((row) => [row.createdAt, row.updatedAt])),
	};
}

// ----- Shapes the client reads -----

export interface GrowthHabit {
	id: string;
	name: string;
	type: HabitType;
	target: number;
	reminder: string | null;
	source: HabitSource;
	manual: boolean;
	/** Monday first: kept on that day of the shown week. */
	week: boolean[];
	/** Monday first: marked by hand that day (a reflection can keep prayer without a mark). */
	marked: boolean[];
	count: number;
	keptToday: boolean;
	markedToday: boolean;
}

export interface GrowthReflection {
	id: string;
	text: string;
	prompt: string | null;
	day: string;
	passage: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface GrowthPractice {
	id: string;
	text: string;
	passage: string | null;
	day: string;
	followUpOn: string | null;
	status: PracticeStatus;
	notes: { day: string; note: string }[];
	reflectionId: string | null;
	due: boolean;
}

export interface GrowthOverview {
	today: string;
	timezone: string;
	weekStart: string;
	currentWeekStart: string;
	earliestWeekStart: string;
	week: { days: { day: string; kept: boolean }[]; keptCount: number; line: string };
	habits: GrowthHabit[];
	/** The weeks before this one, newest first. */
	history: { weekStart: string; keptCount: number; habits: { id: string; name: string; count: number }[] }[];
	reflections: GrowthReflection[];
	practices: GrowthPractice[];
}

function toReflection(item: BetaItem, data: ReflectionData): GrowthReflection {
	return {
		id: item.id,
		text: data.text,
		prompt: data.prompt,
		day: data.day,
		passage: data.passage,
		createdAt: item.createdAt.toISOString(),
		updatedAt: item.updatedAt.toISOString(),
	};
}

function toPractice(item: BetaItem, data: PracticeData, today: string): GrowthPractice {
	return {
		id: item.id,
		text: data.text,
		passage: data.passage,
		day: data.day,
		followUpOn: data.followUpOn,
		status: data.status,
		notes: data.notes,
		reflectionId: data.reflectionId,
		due: isFollowUpDue(data, today),
	};
}

async function loadHabits(userId: string): Promise<{ item: BetaItem; data: HabitData }[]> {
	const items = await listBetaItems(userId, { module: GROWTH_MODULE, kind: HABIT, take: 100 });
	return items
		.flatMap((item) => {
			const data = parseHabitData(item.data);
			return data ? [{ item, data }] : [];
		})
		.sort((a, b) => a.data.order - b.data.order || a.item.createdAt.getTime() - b.item.createdAt.getTime());
}

async function loadReflections(userId: string): Promise<GrowthReflection[]> {
	const items = await listBetaItems(userId, { module: GROWTH_MODULE, kind: REFLECTION, take: REFLECTIONS_TAKE });
	return items
		.flatMap((item) => {
			const data = parseReflectionData(item.data);
			return data ? [toReflection(item, data)] : [];
		})
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

const PRACTICE_ORDER = (practice: GrowthPractice) => (practice.due ? 0 : practice.status === "active" ? 1 : 2);

async function loadPractices(userId: string, today: string): Promise<GrowthPractice[]> {
	const items = await listBetaItems(userId, { module: GROWTH_MODULE, kind: PRACTICE, take: PRACTICES_TAKE });
	return items
		.flatMap((item) => {
			const data = parsePracticeData(item.data);
			return data ? [toPractice(item, data, today)] : [];
		})
		.sort((a, b) => PRACTICE_ORDER(a) - PRACTICE_ORDER(b) || b.day.localeCompare(a.day));
}

/** Everything the page shows, for the week containing `week` (this week by default). */
export async function growthOverview(userId: string, options: { timezone: string; week?: string | null; now?: Date }): Promise<GrowthOverview> {
	const today = localDayKey(options.now ?? new Date(), options.timezone);
	const currentWeekStart = weekStartOf(today);
	const earliest = earliestWeekStart(today);
	const weekStart = resolveWeekStart(options.week, today);

	const [habits, reflections, practices, activity] = await Promise.all([
		loadHabits(userId),
		loadReflections(userId),
		loadPractices(userId, today),
		activityDays(userId, options.timezone, earliest, today),
	]);
	const days: ActivityDays = {
		...activity,
		reflection: new Set(reflections.map((entry) => entry.day).filter((day) => day >= earliest && day <= today)),
	};

	const kept = habits.map(({ data }) => keptDays(data, days));
	const withGod = daysWithGod(kept, days);
	const countIn = (set: ReadonlySet<string>, start: string) => weekDays(start).filter((day) => day <= today && set.has(day)).length;

	const weekKept = weekMarks(withGod, weekStart, today);
	const keptCount = weekKept.filter(Boolean).length;

	return {
		today,
		timezone: options.timezone,
		weekStart,
		currentWeekStart,
		earliestWeekStart: earliest,
		week: {
			days: weekDays(weekStart).map((day, index) => ({ day, kept: weekKept[index] })),
			keptCount,
			line: weekLine(keptCount, weekStart === currentWeekStart),
		},
		habits: habits.map(({ item, data }, index) => {
			const marks = weekMarks(kept[index], weekStart, today);
			const checks = new Set(data.checks);
			return {
				id: item.id,
				name: item.title,
				type: data.type,
				target: data.target,
				reminder: data.reminder,
				source: habitSource(data.type),
				manual: isManualHabit(data.type),
				week: marks,
				marked: weekMarks(checks, weekStart, today),
				count: marks.filter(Boolean).length,
				keptToday: kept[index].has(today),
				markedToday: checks.has(today),
			};
		}),
		history: Array.from({ length: HISTORY_WEEKS }, (_, index) => {
			const start = addDays(currentWeekStart, -7 * (index + 1));
			return {
				weekStart: start,
				keptCount: countIn(withGod, start),
				habits: habits.map(({ item }, habitIndex) => ({ id: item.id, name: item.title, count: countIn(kept[habitIndex], start) })),
			};
		}),
		reflections,
		practices,
	};
}

// ----- Habits -----

export async function createHabit(userId: string, input: HabitInput): Promise<string> {
	const habits = await loadHabits(userId);
	const habit = unwrap(checkNewHabit(input, habits.map(({ data }) => data.type)));
	const data: HabitData = { type: habit.type, target: habit.target, reminder: habit.reminder, checks: [], order: Date.now() };
	const item = await createBetaItem(userId, { module: GROWTH_MODULE, kind: HABIT, title: habit.name, data: { ...data } });
	return item.id;
}

/** The starter set in one go, skipping any the founder already has. */
export async function createStarterHabits(userId: string, types: readonly HabitType[]): Promise<number> {
	let created = 0;
	for (const type of types) {
		const template = HABIT_TEMPLATES.find((entry) => entry.type === type);
		if (!template) continue;
		const habits = await loadHabits(userId);
		if (habits.some(({ data }) => data.type === type)) continue;
		await createHabit(userId, { type, name: template.name, target: template.target });
		created += 1;
	}
	return created;
}

async function ownHabit(userId: string, id: string): Promise<{ item: BetaItem; data: HabitData } | null> {
	const item = await getBetaItem(userId, id);
	if (!item || item.module !== GROWTH_MODULE || item.kind !== HABIT) return null;
	const data = parseHabitData(item.data);
	return data ? { item, data } : null;
}

/** False when the founder has no such habit. */
export async function updateHabit(userId: string, id: string, input: HabitInput): Promise<boolean> {
	const patch = unwrap(checkHabitPatch(input));
	const habit = await ownHabit(userId, id);
	if (!habit) return false;
	const data: HabitData = {
		...habit.data,
		...(patch.target !== undefined && { target: patch.target }),
		...(patch.reminder !== undefined && { reminder: patch.reminder }),
	};
	return Boolean(await updateBetaItem(userId, id, { ...(patch.name !== undefined && { title: patch.name }), data: { ...data } }));
}

export async function deleteHabit(userId: string, id: string): Promise<boolean> {
	if (!(await ownHabit(userId, id))) return false;
	return deleteBetaItem(userId, id);
}

/**
 * Ticks or clears one day of a habit kept by hand. Setting a day to the value
 * it already has is a no-op, so a retried tap cannot flip it back.
 */
export async function setHabitDay(userId: string, id: string, input: { day?: unknown; done?: unknown }, timezone: string, now = new Date()): Promise<boolean> {
	if (typeof input.done !== "boolean") throw new GrowthInputError("Say whether the day was kept.");
	const today = localDayKey(now, timezone);
	if (typeof input.day !== "string" || !canCheckDay(input.day, today)) {
		throw new GrowthInputError("Days can be marked from the last few weeks up to today.");
	}
	const habit = await ownHabit(userId, id);
	if (!habit) return false;
	if (!isManualHabit(habit.data.type)) throw new GrowthInputError("SureWord counts this habit from what you do, so there is nothing to mark.");
	const checks = setCheck(habit.data.checks, input.day, input.done);
	return Boolean(await updateBetaItem(userId, id, { data: { ...habit.data, checks } }));
}

// ----- Reflections -----

export async function createReflection(
	userId: string,
	input: { text?: unknown; prompt?: unknown; passage?: unknown },
	timezone: string,
	now = new Date(),
): Promise<GrowthReflection> {
	const text = unwrap(checkReflectionText(input.text));
	const prompt = unwrap(checkReflectionPrompt(input.prompt));
	const passage = resolvePassage(input.passage);
	const data: ReflectionData = { text, prompt, day: localDayKey(now, timezone), passage: passage?.label ?? null, private: true };
	const item = await createBetaItem(userId, { module: GROWTH_MODULE, kind: REFLECTION, title: REFLECTION_TITLE, data: { ...data }, refs: passage?.refs ?? [] });
	return toReflection(item, data);
}

async function ownReflection(userId: string, id: string): Promise<{ item: BetaItem; data: ReflectionData } | null> {
	const item = await getBetaItem(userId, id);
	if (!item || item.module !== GROWTH_MODULE || item.kind !== REFLECTION) return null;
	const data = parseReflectionData(item.data);
	return data ? { item, data } : null;
}

/** New words, prompt or passage for an entry; it keeps the day it was written. */
export async function updateReflection(
	userId: string,
	id: string,
	input: { text?: unknown; prompt?: unknown; passage?: unknown },
): Promise<GrowthReflection | null> {
	if (input.text === undefined && input.prompt === undefined && input.passage === undefined) throw new GrowthInputError("Nothing to change.");
	const text = input.text === undefined ? undefined : unwrap(checkReflectionText(input.text));
	const prompt = input.prompt === undefined ? undefined : unwrap(checkReflectionPrompt(input.prompt));
	const passage = input.passage === undefined ? undefined : resolvePassage(input.passage);
	const entry = await ownReflection(userId, id);
	if (!entry) return null;
	const data: ReflectionData = {
		...entry.data,
		...(text !== undefined && { text }),
		...(prompt !== undefined && { prompt }),
		...(passage !== undefined && { passage: passage?.label ?? null }),
	};
	const item = await updateBetaItem(userId, id, { data: { ...data }, ...(passage !== undefined && { refs: passage?.refs ?? [] }) });
	return item ? toReflection(item, data) : null;
}

export async function deleteReflection(userId: string, id: string): Promise<boolean> {
	if (!(await ownReflection(userId, id))) return false;
	return deleteBetaItem(userId, id);
}

// ----- Put into practice -----

export async function createPractice(
	userId: string,
	input: { text?: unknown; passage?: unknown; followUp?: unknown; reflectionId?: unknown },
	timezone: string,
	now = new Date(),
): Promise<GrowthPractice> {
	const text = unwrap(checkPracticeText(input.text));
	const passage = resolvePassage(input.passage);
	const followUp = input.followUp === undefined ? "1w" : input.followUp;
	if (!isFollowUpChoice(followUp)) throw new GrowthInputError("Choose when to follow up.");
	let reflectionId: string | null = null;
	if (input.reflectionId !== undefined && input.reflectionId !== null) {
		// Someone else's id behaves like one that does not exist.
		if (typeof input.reflectionId !== "string" || !(await ownReflection(userId, input.reflectionId))) {
			throw new GrowthInputError("That reflection was not found.");
		}
		reflectionId = input.reflectionId;
	}
	const today = localDayKey(now, timezone);
	const data: PracticeData = {
		text,
		passage: passage?.label ?? null,
		day: today,
		followUpOn: followUpDay(followUp, today),
		status: "active",
		notes: [],
		reflectionId,
		private: true,
	};
	const item = await createBetaItem(userId, { module: GROWTH_MODULE, kind: PRACTICE, title: PRACTICE_TITLE, data: { ...data }, refs: passage?.refs ?? [] });
	return toPractice(item, data, today);
}

async function ownPractice(userId: string, id: string): Promise<{ item: BetaItem; data: PracticeData } | null> {
	const item = await getBetaItem(userId, id);
	if (!item || item.module !== GROWTH_MODULE || item.kind !== PRACTICE) return null;
	const data = parsePracticeData(item.data);
	return data ? { item, data } : null;
}

export async function actOnPractice(
	userId: string,
	id: string,
	action: PracticeAction,
	timezone: string,
	now = new Date(),
): Promise<GrowthPractice | null> {
	const today = localDayKey(now, timezone);
	const practice = await ownPractice(userId, id);
	if (!practice) return null;
	const next = unwrap(applyPracticeAction(practice.data, action, today));
	const item = await updateBetaItem(userId, id, { data: { ...next } });
	return item ? toPractice(item, next, today) : null;
}

export async function deletePractice(userId: string, id: string): Promise<boolean> {
	if (!(await ownPractice(userId, id))) return false;
	return deleteBetaItem(userId, id);
}

/**
 * Pure rules for Habits & Reflection (`growth`, LC-17652, docs/beta/growth.md):
 * the habits a founder chooses for time with God, the week they are counted
 * in, the private reflection journal, and the insights they chose to put into
 * practice with the follow-ups they asked for.
 *
 * What this module never does is keep score: there is no streak, no total, no
 * percentage of a walk with God. A habit only says how many days this week it
 * was kept, against a target the founder set themselves, and a missed day is
 * just a day.
 *
 * No imports on purpose: `tests/beta-growth.test.mjs` loads this file with
 * Node's type stripping, which cannot resolve `@/` paths. The server half is
 * `growth.ts`.
 */

export const GROWTH_MODULE = "growth";

export type HabitType = "reading" | "prayer" | "memory" | "study" | "custom";
export const HABIT_TYPES: readonly HabitType[] = ["reading", "prayer", "memory", "study", "custom"];

/**
 * Where a habit's days come from. "tracked" habits are counted from what the
 * founder already does in SureWord and cannot be ticked by hand (never typed
 * twice); prayer is ticked by hand and also kept by writing a reflection that
 * day; custom habits are ticked by hand only.
 */
export type HabitSource = "reading-log" | "learn" | "beta-studies" | "by-hand-or-journal" | "by-hand";

export interface HabitTemplate {
	type: HabitType;
	name: string;
	/** Days a week, suggested when it is added. */
	target: number;
	source: HabitSource;
}

export const HABIT_TEMPLATES: readonly HabitTemplate[] = [
	{ type: "reading", name: "Bible reading", target: 5, source: "reading-log" },
	{ type: "prayer", name: "Prayer & reflection", target: 5, source: "by-hand-or-journal" },
	{ type: "memory", name: "Scripture memory", target: 3, source: "learn" },
	{ type: "study", name: "Study", target: 2, source: "beta-studies" },
];

/** The three a new founder is offered first, matching the concept board. */
export const STARTER_HABIT_TYPES: readonly HabitType[] = ["reading", "prayer", "memory"];

export const HABITS_MAX = 12;
export const HABIT_NAME_MAX = 60;
/** Manual check-ins kept per habit: about ten years of every day. */
export const HABIT_CHECKS_MAX = 3_700;
/** How many weeks before this one the history (and check-ins) reach back. */
export const HISTORY_WEEKS = 8;

export function habitSource(type: HabitType): HabitSource {
	if (type === "reading") return "reading-log";
	if (type === "memory") return "learn";
	if (type === "study") return "beta-studies";
	if (type === "prayer") return "by-hand-or-journal";
	return "by-hand";
}

/** True when the founder ticks the habit by hand. */
export function isManualHabit(type: HabitType): boolean {
	return type === "prayer" || type === "custom";
}

/** Only one habit of each kind SureWord can see; custom habits are unlimited. */
export function isSingletonHabit(type: HabitType): boolean {
	return type !== "custom";
}

export function isHabitType(value: unknown): value is HabitType {
	return typeof value === "string" && (HABIT_TYPES as readonly string[]).includes(value);
}

export type GrowthResult<T> = { ok: true; value: T } | { ok: false; error: string };

// ----- Calendar days ("YYYY-MM-DD") -----

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day written as YYYY-MM-DD. */
export function isDayKey(value: unknown): value is string {
	if (typeof value !== "string" || !DAY_PATTERN.test(value)) return false;
	const [year, month, day] = value.split("-").map(Number);
	const date = new Date(Date.UTC(year, month - 1, day));
	return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** The day `offset` days from `day`, done on the date itself so DST cannot skip one. */
export function addDays(day: string, offset: number): string {
	const [year, month, date] = day.split("-").map(Number);
	return new Date(Date.UTC(year, month - 1, date + offset)).toISOString().slice(0, 10);
}

/** 0 = Monday ... 6 = Sunday. */
export function weekdayIndex(day: string): number {
	const [year, month, date] = day.split("-").map(Number);
	return (new Date(Date.UTC(year, month - 1, date)).getUTCDay() + 6) % 7;
}

/** The Monday of the week `day` is in (the board's week runs M to S). */
export function weekStartOf(day: string): string {
	return addDays(day, -weekdayIndex(day));
}

export function weekDays(weekStart: string): string[] {
	return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

/** The oldest week the week view and the history reach. */
export function earliestWeekStart(today: string): string {
	return addDays(weekStartOf(today), -7 * HISTORY_WEEKS);
}

/**
 * The week to show for a requested day: its Monday, clamped between the
 * oldest week the history keeps and this week. Anything unreadable is this week.
 */
export function resolveWeekStart(requested: unknown, today: string): string {
	const current = weekStartOf(today);
	if (!isDayKey(requested)) return current;
	const start = weekStartOf(requested);
	if (start > current) return current;
	const earliest = earliestWeekStart(today);
	return start < earliest ? earliest : start;
}

/** A day can be ticked by hand from the oldest week in the history up to today, never ahead. */
export function canCheckDay(day: string, today: string): boolean {
	return isDayKey(day) && day <= today && day >= earliestWeekStart(today);
}

// ----- Habits -----

/** What a habit keeps in its `BetaItem.data`. */
export interface HabitData {
	type: HabitType;
	target: number;
	/** "HH:MM" on the founder's clock, or null for no reminder. */
	reminder: string | null;
	/** Days ticked by hand, sorted, unique. Always empty for tracked habits. */
	checks: string[];
	/** Creation order (epoch ms), so editing a habit never reorders the list. */
	order: number;
}

export interface HabitInput {
	type?: unknown;
	name?: unknown;
	target?: unknown;
	reminder?: unknown;
}

const REMINDER_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function checkHabitName(name: unknown): GrowthResult<string> {
	if (typeof name !== "string") return { ok: false, error: "Give the habit a name." };
	const value = name.trim().replace(/\s+/g, " ");
	if (!value) return { ok: false, error: "Give the habit a name." };
	if (value.length > HABIT_NAME_MAX) return { ok: false, error: `Keep the name under ${HABIT_NAME_MAX} characters.` };
	return { ok: true, value };
}

export function checkHabitTarget(target: unknown): GrowthResult<number> {
	if (typeof target !== "number" || !Number.isInteger(target) || target < 1 || target > 7) {
		return { ok: false, error: "A habit is for 1 to 7 days a week." };
	}
	return { ok: true, value: target };
}

export function checkHabitReminder(reminder: unknown): GrowthResult<string | null> {
	if (reminder === null || reminder === undefined || reminder === "") return { ok: true, value: null };
	if (typeof reminder !== "string" || !REMINDER_PATTERN.test(reminder)) return { ok: false, error: "Use a time like 07:30 for the reminder." };
	return { ok: true, value: reminder };
}

/** A new habit; `existing` is the founder's current habit types. */
export function checkNewHabit(
	input: HabitInput,
	existing: readonly HabitType[],
): GrowthResult<{ type: HabitType; name: string; target: number; reminder: string | null }> {
	if (!isHabitType(input.type)) return { ok: false, error: "Choose what kind of habit this is." };
	const type = input.type;
	if (existing.length >= HABITS_MAX) return { ok: false, error: `Keep it to ${HABITS_MAX} habits or fewer.` };
	if (isSingletonHabit(type) && existing.includes(type)) return { ok: false, error: "You already have that habit." };
	const template = HABIT_TEMPLATES.find((entry) => entry.type === type);
	const name = checkHabitName(input.name ?? template?.name);
	if (!name.ok) return name;
	const target = checkHabitTarget(input.target ?? template?.target ?? 3);
	if (!target.ok) return target;
	const reminder = checkHabitReminder(input.reminder);
	if (!reminder.ok) return reminder;
	return { ok: true, value: { type, name: name.value, target: target.value, reminder: reminder.value } };
}

/** An edit to name, target or reminder; only the fields present are returned. */
export function checkHabitPatch(input: HabitInput): GrowthResult<{ name?: string; target?: number; reminder?: string | null }> {
	const out: { name?: string; target?: number; reminder?: string | null } = {};
	if (input.name !== undefined) {
		const name = checkHabitName(input.name);
		if (!name.ok) return name;
		out.name = name.value;
	}
	if (input.target !== undefined) {
		const target = checkHabitTarget(input.target);
		if (!target.ok) return target;
		out.target = target.value;
	}
	if (input.reminder !== undefined) {
		const reminder = checkHabitReminder(input.reminder);
		if (!reminder.ok) return reminder;
		out.reminder = reminder.value;
	}
	if (input.type !== undefined) return { ok: false, error: "A habit's kind cannot change. Add a new one instead." };
	if (Object.keys(out).length === 0) return { ok: false, error: "Nothing to change." };
	return { ok: true, value: out };
}

/** A habit's stored data, or null when it is not one this module wrote. */
export function parseHabitData(data: unknown): HabitData | null {
	if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
	const value = data as Record<string, unknown>;
	if (!isHabitType(value.type)) return null;
	const target = checkHabitTarget(value.target);
	const reminder = checkHabitReminder(value.reminder);
	if (!target.ok || !reminder.ok) return null;
	const checks = Array.isArray(value.checks) ? [...new Set(value.checks.filter(isDayKey))].sort() : [];
	const order = typeof value.order === "number" && Number.isFinite(value.order) ? value.order : 0;
	return { type: value.type, target: target.value, reminder: reminder.value, checks, order };
}

/** The checks with `day` ticked or cleared: sorted, unique, the newest kept when full. */
export function setCheck(checks: readonly string[], day: string, done: boolean): string[] {
	const set = new Set(checks.filter(isDayKey));
	if (done) set.add(day);
	else set.delete(day);
	const sorted = [...set].sort();
	return sorted.length > HABIT_CHECKS_MAX ? sorted.slice(sorted.length - HABIT_CHECKS_MAX) : sorted;
}

// ----- The week -----

/** The days SureWord saw each kind of activity, on the founder's calendar. */
export interface ActivityDays {
	reading: ReadonlySet<string>;
	memory: ReadonlySet<string>;
	study: ReadonlySet<string>;
	/** Days a reflection was written in the journal. */
	reflection: ReadonlySet<string>;
}

/** The days a habit was kept: from activity for what SureWord can see, by hand for the rest. */
export function keptDays(habit: Pick<HabitData, "type" | "checks">, activity: ActivityDays): Set<string> {
	if (habit.type === "reading") return new Set(activity.reading);
	if (habit.type === "memory") return new Set(activity.memory);
	if (habit.type === "study") return new Set(activity.study);
	if (habit.type === "prayer") return new Set([...habit.checks, ...activity.reflection]);
	return new Set(habit.checks);
}

/** Days in the week the habit was kept, Monday first (future days are never kept). */
export function weekMarks(kept: ReadonlySet<string>, weekStart: string, today: string): boolean[] {
	return weekDays(weekStart).map((day) => day <= today && kept.has(day));
}

/**
 * How far a habit's ring is drawn: kept days over the target, never past full.
 * Keeping it more often than planned is simply a full ring.
 */
export function ringFraction(count: number, target: number): number {
	if (target <= 0) return 0;
	return Math.min(Math.max(count, 0) / target, 1);
}

/**
 * The board's day row: a day is "with God" when any habit was kept on it.
 * With no habits yet, it is any day SureWord saw reading, memory, study or a
 * reflection, so the row is true from the first visit.
 */
export function daysWithGod(habitKept: readonly ReadonlySet<string>[], activity: ActivityDays): Set<string> {
	const sources = habitKept.length ? habitKept : [activity.reading, activity.memory, activity.study, activity.reflection];
	const out = new Set<string>();
	for (const days of sources) for (const day of days) out.add(day);
	return out;
}

/**
 * A gentle line under the day row. It names what happened and never what did
 * not: no "missed", no "behind", no count of empty days.
 */
export function weekLine(keptCount: number, isCurrentWeek: boolean): string {
	if (keptCount === 0) return isCurrentWeek ? "A new week with God. Every day is a fresh start." : "A quiet week.";
	const days = keptCount === 1 ? "1 day" : `${keptCount} days`;
	return isCurrentWeek ? `${days} with God so far this week` : `${days} with God that week`;
}

/** Habits whose reminder time has come today and that are not kept yet. */
export function dueReminders<T extends { id: string; reminder: string | null; keptToday: boolean }>(
	habits: readonly T[],
	minutesNow: number,
): T[] {
	return habits.filter((habit) => {
		if (!habit.reminder || habit.keptToday) return false;
		const [hours, minutes] = habit.reminder.split(":").map(Number);
		return minutesNow >= hours * 60 + minutes;
	});
}

// ----- Reflections -----

export const REFLECTION_MAX = 10_000;

/** Optional prompts for the journal: questions, never a form to fill. */
export const REFLECTION_PROMPTS: readonly string[] = [
	"What did God show you in His Word today?",
	"What are you thankful for?",
	"What do you want to bring to Him in prayer?",
	"Is there anything to confess and turn from?",
	"Where did you see His hand this week?",
	"How will you live out what you read?",
];

export interface ReflectionData {
	text: string;
	prompt: string | null;
	/** The founder's calendar day it was written on. */
	day: string;
	/** A passage it is about, as written ("James 1:19"), or null. */
	passage: string | null;
	/** Marks the item private for every module that reads the shared store. */
	private: true;
}

export function checkReflectionText(text: unknown): GrowthResult<string> {
	if (typeof text !== "string" || !text.trim()) return { ok: false, error: "Write something first." };
	if (text.length > REFLECTION_MAX) return { ok: false, error: `Keep a reflection under ${REFLECTION_MAX.toLocaleString("en-US")} characters.` };
	return { ok: true, value: text.trim() };
}

export function checkReflectionPrompt(prompt: unknown): GrowthResult<string | null> {
	if (prompt === null || prompt === undefined || prompt === "") return { ok: true, value: null };
	if (typeof prompt !== "string" || !REFLECTION_PROMPTS.includes(prompt)) return { ok: false, error: "Choose one of the prompts, or none." };
	return { ok: true, value: prompt };
}

export function parseReflectionData(data: unknown): ReflectionData | null {
	if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
	const value = data as Record<string, unknown>;
	if (typeof value.text !== "string" || !isDayKey(value.day)) return null;
	const prompt = checkReflectionPrompt(value.prompt);
	return {
		text: value.text,
		prompt: prompt.ok ? prompt.value : null,
		day: value.day,
		passage: typeof value.passage === "string" && value.passage ? value.passage : null,
		private: true,
	};
}

/**
 * The chat prompt for "Talk it over with SureWord": only built when the
 * founder presses it, and only prefilled (they still send it). Long entries
 * are cut so the link stays a link.
 */
export const TALK_IT_OVER_MAX = 1_500;
export function talkItOverPrompt(kind: "reflection" | "practice", text: string, passage: string | null): string {
	const body = text.length > TALK_IT_OVER_MAX ? `${text.slice(0, TALK_IT_OVER_MAX).trimEnd()}…` : text;
	const about = passage ? ` (on ${passage})` : "";
	return kind === "reflection"
		? `I wrote this reflection in my journal${about}. Can we talk it over from Scripture?\n\n"${body}"`
		: `I'm trying to put this into practice${about}. Can you help me from Scripture?\n\n"${body}"`;
}

// ----- Put into practice -----

export const PRACTICE_MAX = 500;
export const FOLLOW_UP_NOTE_MAX = 2_000;
export const FOLLOW_UPS_MAX = 50;

export type FollowUpChoice = "none" | "3d" | "1w" | "2w" | "1m";
export const FOLLOW_UP_DAYS: Readonly<Record<Exclude<FollowUpChoice, "none">, number>> = { "3d": 3, "1w": 7, "2w": 14, "1m": 30 };
export const FOLLOW_UP_LABELS: Readonly<Record<FollowUpChoice, string>> = {
	none: "No follow-up",
	"3d": "In 3 days",
	"1w": "In a week",
	"2w": "In two weeks",
	"1m": "In a month",
};

export function isFollowUpChoice(value: unknown): value is FollowUpChoice {
	// Own keys only: "toString" or "__proto__" are in every object.
	return value === "none" || (typeof value === "string" && Object.hasOwn(FOLLOW_UP_DAYS, value));
}

/** The day a follow-up comes back, or null for none. */
export function followUpDay(choice: FollowUpChoice, today: string): string | null {
	return choice === "none" ? null : addDays(today, FOLLOW_UP_DAYS[choice]);
}

export type PracticeStatus = "active" | "lived";

export interface FollowUpNote {
	day: string;
	note: string;
}

export interface PracticeData {
	text: string;
	passage: string | null;
	/** The founder's day they chose it. */
	day: string;
	/** When the follow-up comes back, or null when they asked for none. */
	followUpOn: string | null;
	/** "lived" once they say it has become part of them. */
	status: PracticeStatus;
	/** What they wrote at each follow-up, oldest first. */
	notes: FollowUpNote[];
	/** The reflection it came out of, when it did. */
	reflectionId: string | null;
	private: true;
}

export function checkPracticeText(text: unknown): GrowthResult<string> {
	if (typeof text !== "string" || !text.trim()) return { ok: false, error: "Write what you want to put into practice." };
	const value = text.trim().replace(/\s+/g, " ");
	if (value.length > PRACTICE_MAX) return { ok: false, error: `Keep it under ${PRACTICE_MAX} characters.` };
	return { ok: true, value };
}

export function checkFollowUpNote(note: unknown): GrowthResult<string | null> {
	if (note === null || note === undefined) return { ok: true, value: null };
	if (typeof note !== "string") return { ok: false, error: "A note is text." };
	if (note.length > FOLLOW_UP_NOTE_MAX) return { ok: false, error: `Keep the note under ${FOLLOW_UP_NOTE_MAX.toLocaleString("en-US")} characters.` };
	return { ok: true, value: note.trim() || null };
}

export function parsePracticeData(data: unknown): PracticeData | null {
	if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
	const value = data as Record<string, unknown>;
	if (typeof value.text !== "string" || !isDayKey(value.day)) return null;
	const notes = Array.isArray(value.notes)
		? value.notes.filter(
				(note): note is FollowUpNote =>
					typeof note === "object" && note !== null && isDayKey((note as FollowUpNote).day) && typeof (note as FollowUpNote).note === "string",
			)
		: [];
	return {
		text: value.text,
		passage: typeof value.passage === "string" && value.passage ? value.passage : null,
		day: value.day,
		followUpOn: isDayKey(value.followUpOn) ? value.followUpOn : null,
		status: value.status === "lived" ? "lived" : "active",
		notes,
		reflectionId: typeof value.reflectionId === "string" && value.reflectionId ? value.reflectionId : null,
		private: true,
	};
}

/** A follow-up is shown when its day has come and the practice is still active. */
export function isFollowUpDue(practice: Pick<PracticeData, "status" | "followUpOn">, today: string): boolean {
	return practice.status === "active" && practice.followUpOn !== null && practice.followUpOn <= today;
}

export type PracticeAction =
	| { action: "follow-up"; note: string | null; next: FollowUpChoice }
	| { action: "later" }
	| { action: "lived"; note: string | null }
	| { action: "reopen"; next: FollowUpChoice };

/**
 * The practice after one of the founder's actions:
 * - follow-up: what they wrote (if anything) is kept, and the next follow-up set (or none);
 * - later: it comes back tomorrow;
 * - lived: it has become part of them, with an optional last note;
 * - reopen: back to practising, with a follow-up if they want one.
 */
export function applyPracticeAction(practice: PracticeData, action: PracticeAction, today: string): GrowthResult<PracticeData> {
	const withNote = (note: string | null): FollowUpNote[] => {
		const notes = note ? [...practice.notes, { day: today, note }] : practice.notes;
		return notes.length > FOLLOW_UPS_MAX ? notes.slice(notes.length - FOLLOW_UPS_MAX) : notes;
	};
	switch (action.action) {
		case "follow-up":
			if (practice.status !== "active") return { ok: false, error: "This one is already part of you." };
			return { ok: true, value: { ...practice, notes: withNote(action.note), followUpOn: followUpDay(action.next, today) } };
		case "later":
			if (practice.status !== "active") return { ok: false, error: "This one is already part of you." };
			return { ok: true, value: { ...practice, followUpOn: addDays(today, 1) } };
		case "lived":
			return { ok: true, value: { ...practice, notes: withNote(action.note), status: "lived", followUpOn: null } };
		case "reopen":
			return { ok: true, value: { ...practice, status: "active", followUpOn: followUpDay(action.next, today) } };
	}
}

/** Reads a PATCH body into an action, or the reason it cannot be one. */
export function checkPracticeAction(body: unknown): GrowthResult<PracticeAction> {
	if (typeof body !== "object" || body === null) return { ok: false, error: "Send an action." };
	const value = body as Record<string, unknown>;
	const note = checkFollowUpNote(value.note);
	if (!note.ok) return note;
	const next = value.next === undefined ? "none" : value.next;
	switch (value.action) {
		case "follow-up":
		case "reopen":
			if (!isFollowUpChoice(next)) return { ok: false, error: "Choose when to follow up." };
			return { ok: true, value: value.action === "follow-up" ? { action: "follow-up", note: note.value, next } : { action: "reopen", next } };
		case "later":
			return { ok: true, value: { action: "later" } };
		case "lived":
			return { ok: true, value: { action: "lived", note: note.value } };
		default:
			return { ok: false, error: "Unknown action." };
	}
}

// ----- The closing verse -----

/** Verses for the foot of the page, one per week, read from the bundled KJV. */
export const WEEK_VERSES: readonly { book: number; chapter: number; verse: number; reference: string }[] = [
	{ book: 19, chapter: 119, verse: 105, reference: "Psalm 119:105" },
	{ book: 19, chapter: 5, verse: 3, reference: "Psalm 5:3" },
	{ book: 48, chapter: 6, verse: 9, reference: "Galatians 6:9" },
	{ book: 50, chapter: 4, verse: 6, reference: "Philippians 4:6" },
	{ book: 19, chapter: 1, verse: 2, reference: "Psalm 1:2" },
	{ book: 23, chapter: 40, verse: 31, reference: "Isaiah 40:31" },
	{ book: 59, chapter: 1, verse: 22, reference: "James 1:22" },
	{ book: 40, chapter: 6, verse: 6, reference: "Matthew 6:6" },
];

/** The same verse all week, a different one the next. */
export function verseForWeek(weekStart: string): (typeof WEEK_VERSES)[number] {
	const [year, month, day] = weekStart.split("-").map(Number);
	const weeks = Math.floor(Date.UTC(year, month - 1, day) / (7 * 86_400_000));
	return WEEK_VERSES[((weeks % WEEK_VERSES.length) + WEEK_VERSES.length) % WEEK_VERSES.length];
}

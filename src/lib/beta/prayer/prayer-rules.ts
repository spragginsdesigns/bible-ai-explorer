/**
 * Prayer & Testimony's pure rules (LC-17723, docs/beta/prayer.md): what a
 * living prayer entry holds, what a founder may write into it, when a reminder
 * is due, and how the testimony timeline is laid out.
 *
 * No imports on purpose: tests load this file with Node's type stripping.
 *
 * The prayer request itself stays the founder's existing prayer list row
 * (`UserMemory`, category `prayer`). This module only adds what grows around
 * it: dated updates, linked passages, a reminder, and the outcome the founder
 * confirmed in their own words. Nothing here counts, scores or judges.
 */

export const PRAYER_MODULE = "prayer";
export const PRAYER_ENTRY_KIND = "entry";
/** Fixed and private: the words live only in `data` (docs/beta/README.md, Private items). */
export const PRAYER_ENTRY_TITLE = "Prayer request";

/** A request on the prayer list; mirrors MAX_MEMORY_CONTENT_LENGTH in src/lib/memory.ts (a test pins it). */
export const PRAYER_REQUEST_MAX = 500;
export const PRAYER_UPDATE_MAX = 1_000;
export const PRAYER_UPDATES_MAX = 200;
export const PRAYER_WORDS_MAX = 2_000;
export const PRAYER_REFLECTION_MAX = 2_000;
export const PRAYER_PASSAGES_MAX = 12;
/** How far ahead a reminder may be set, in days (about two years). */
export const PRAYER_REMINDER_MAX_DAYS = 731;

export const OUTCOME_KINDS = ["answered", "closed"] as const;
export type OutcomeKind = (typeof OUTCOME_KINDS)[number];

export interface PrayerUpdate {
	id: string;
	/** ISO instant it was written. */
	at: string;
	text: string;
}

export interface PrayerOutcome {
	/** answered: God answered it. closed: the founder laid it down. */
	kind: OutcomeKind;
	/** ISO instant the founder confirmed it. */
	at: string;
	/** What happened, in the founder's own words. Never generated. */
	words: string;
	reflection: string | null;
}

export interface PrayerEntryData {
	private: true;
	memoryId: string;
	/** A copy of the request's words, so the testimony outlives the 60-row prayer list. */
	request: string;
	/** ISO instant they began praying (the request's askedAt, else when it was saved). */
	askedAt: string;
	updates: PrayerUpdate[];
	/** Canonical labels ("Philippians 4:6"); their passage keys are the item's refs. */
	passages: string[];
	/** A day on the founder's calendar (YYYY-MM-DD) to revisit it, or null. */
	remindOn: string | null;
	outcome: PrayerOutcome | null;
}

export type PrayerResult<T> = { ok: true; value: T } | { ok: false; error: string };

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIso(value: unknown): value is string {
	return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

/** A stored entry's data, or null when it is not one of ours. Tolerant of missing optional fields. */
export function readPrayerEntry(raw: unknown): PrayerEntryData | null {
	if (!isRecord(raw) || typeof raw.memoryId !== "string" || !raw.memoryId) return null;
	const updates = Array.isArray(raw.updates)
		? raw.updates.flatMap((update): PrayerUpdate[] =>
				isRecord(update) && typeof update.id === "string" && isIso(update.at) && typeof update.text === "string" ? [{ id: update.id, at: update.at, text: update.text }] : [],
			)
		: [];
	const outcome = isRecord(raw.outcome) && OUTCOME_KINDS.includes(raw.outcome.kind as OutcomeKind) && isIso(raw.outcome.at) && typeof raw.outcome.words === "string"
		? { kind: raw.outcome.kind as OutcomeKind, at: raw.outcome.at, words: raw.outcome.words, reflection: typeof raw.outcome.reflection === "string" ? raw.outcome.reflection : null }
		: null;
	return {
		private: true,
		memoryId: raw.memoryId,
		request: typeof raw.request === "string" ? raw.request : "",
		askedAt: isIso(raw.askedAt) ? raw.askedAt : new Date(0).toISOString(),
		updates,
		passages: Array.isArray(raw.passages) ? raw.passages.filter((label): label is string => typeof label === "string") : [],
		remindOn: typeof raw.remindOn === "string" && DAY_KEY.test(raw.remindOn) ? raw.remindOn : null,
		outcome,
	};
}

function text(value: unknown, max: number, what: string, required: boolean): PrayerResult<string | null> {
	if (value === undefined || value === null) return required ? { ok: false, error: `Write ${what} first.` } : { ok: true, value: null };
	if (typeof value !== "string") return { ok: false, error: `${what[0].toUpperCase()}${what.slice(1)} is text.` };
	const trimmed = value.trim();
	if (!trimmed) return required ? { ok: false, error: `Write ${what} first.` } : { ok: true, value: null };
	if (trimmed.length > max) return { ok: false, error: `Keep ${what} to ${max.toLocaleString("en-US")} characters.` };
	return { ok: true, value: trimmed };
}

export function checkUpdateText(value: unknown): PrayerResult<string> {
	return text(value, PRAYER_UPDATE_MAX, "the update", true) as PrayerResult<string>;
}

/** Days between two calendar days (b - a). */
export function daysBetween(a: string, b: string): number {
	return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** A reminder day: today or later on the founder's calendar, within about two years, or null to clear it. */
export function checkRemindOn(value: unknown, today: string): PrayerResult<string | null> {
	if (value === null || value === "") return { ok: true, value: null };
	if (typeof value !== "string" || !DAY_KEY.test(value)) return { ok: false, error: "Choose a day for the reminder." };
	const parsed = new Date(`${value}T00:00:00Z`);
	if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return { ok: false, error: "Choose a real day for the reminder." };
	const ahead = daysBetween(today, value);
	if (ahead < 0) return { ok: false, error: "Choose today or a later day for the reminder." };
	if (ahead > PRAYER_REMINDER_MAX_DAYS) return { ok: false, error: "Choose a day within the next two years." };
	return { ok: true, value };
}

/**
 * An outcome is recorded only when the founder confirms it, in their own
 * words: `confirmed` must be exactly true and `words` must be written.
 */
export function checkOutcome(input: Record<string, unknown>): PrayerResult<{ kind: OutcomeKind; words: string; reflection: string | null }> {
	if (input.confirmed !== true) return { ok: false, error: "Confirm the outcome before it is recorded." };
	if (!OUTCOME_KINDS.includes(input.kind as OutcomeKind)) return { ok: false, error: "Choose answered or laid down." };
	const words = text(input.words, PRAYER_WORDS_MAX, "what happened", true);
	if (!words.ok) return words;
	const reflection = text(input.reflection, PRAYER_REFLECTION_MAX, "the reflection", false);
	if (!reflection.ok) return reflection;
	return { ok: true, value: { kind: input.kind as OutcomeKind, words: words.value as string, reflection: reflection.value } };
}

/** Due when its day has come and the prayer is still open. */
export function isReminderDue(remindOn: string | null, today: string, open: boolean): boolean {
	return open && remindOn !== null && remindOn <= today;
}

// ----- The testimony timeline -----

export type TimelineEventKind = "asked" | "update" | "outcome";

export interface TimelineEntryInput {
	memoryId: string;
	request: string;
	askedAt: string;
	updates: readonly PrayerUpdate[];
	passages: readonly string[];
	outcome: PrayerOutcome | null;
}

export interface TimelineEvent {
	kind: TimelineEventKind;
	/** ISO instant. */
	at: string;
	/** Day on the founder's calendar. */
	day: string;
	memoryId: string;
	/** What was prayed. */
	request: string;
	/** asked: the passages they stand on; otherwise empty. */
	passages: readonly string[];
	/** update: its words; outcome: what happened. */
	text: string | null;
	outcomeKind: OutcomeKind | null;
	reflection: string | null;
}

export interface TimelineMonth {
	/** YYYY-MM on the founder's calendar. */
	month: string;
	/** "October 2026". */
	label: string;
	events: TimelineEvent[];
}

/** An instant's day on the founder's calendar (YYYY-MM-DD). */
export function dayIn(instant: string, timeZone: string): string {
	const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(instant));
	const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
	return `${part("year")}-${part("month")}-${part("day")}`;
}

export function monthLabel(month: string): string {
	return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${month}-01T00:00:00Z`));
}

const KIND_ORDER: Record<TimelineEventKind, number> = { asked: 0, update: 1, outcome: 2 };

/**
 * What was prayed, what happened and the reflection, oldest first and grouped
 * by month. Only an outcome the founder confirmed appears; a request marked
 * answered somewhere else without their words shows no outcome here.
 */
export function buildTimeline(entries: readonly TimelineEntryInput[], timeZone: string): TimelineMonth[] {
	const events: TimelineEvent[] = [];
	for (const entry of entries) {
		const base = { memoryId: entry.memoryId, request: entry.request };
		events.push({ ...base, kind: "asked", at: entry.askedAt, day: dayIn(entry.askedAt, timeZone), passages: [...entry.passages], text: null, outcomeKind: null, reflection: null });
		for (const update of entry.updates) {
			events.push({ ...base, kind: "update", at: update.at, day: dayIn(update.at, timeZone), passages: [], text: update.text, outcomeKind: null, reflection: null });
		}
		if (entry.outcome) {
			events.push({ ...base, kind: "outcome", at: entry.outcome.at, day: dayIn(entry.outcome.at, timeZone), passages: [], text: entry.outcome.words, outcomeKind: entry.outcome.kind, reflection: entry.outcome.reflection });
		}
	}
	events.sort((a, b) => a.at.localeCompare(b.at) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.memoryId.localeCompare(b.memoryId));
	const months: TimelineMonth[] = [];
	for (const event of events) {
		const month = event.day.slice(0, 7);
		const last = months[months.length - 1];
		if (last && last.month === month) last.events.push(event);
		else months.push({ month, label: monthLabel(month), events: [event] });
	}
	return months;
}

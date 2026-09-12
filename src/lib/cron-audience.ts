/**
 * Pure activity rules for the verse-of-day cron, kept free of Prisma so the
 * decision about who is still worth preparing a day and a narration for is
 * unit testable on its own.
 *
 * "Active" means the person did something that writes a row: sent a chat
 * message, read a chapter (ReadingEvent), marked a verse (VerseHighlight), or
 * changed a note. A push token alone does not count - device farms and
 * abandoned installs keep tokens alive for accounts nobody opens.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The morning day (a Sol selection plus a Sol writing call) and its push go
 * only to people active this recently. Someone who comes back after longer
 * still gets a day the moment they open Pick Up Your Cross, because the today
 * route generates one on demand.
 */
export const PUSH_ACTIVITY_WINDOW_MS = 30 * DAY_MS;

/**
 * ElevenLabs narration is billed per character, so the cron narrates ahead of
 * time only for people active this week. Anyone outside it still hears their
 * devotional: opening the day schedules the narration on demand.
 */
export const AUDIO_ACTIVITY_WINDOW_MS = 7 * DAY_MS;

/** One source's latest activity for a user; a user may appear once per source. */
export interface UserActivityRow {
	userId: string;
	lastActiveAt: Date | null;
}

/** Newest activity per user across every source row. */
export function lastActivityByUser(rows: readonly UserActivityRow[]): Map<string, Date> {
	const latest = new Map<string, Date>();
	for (const row of rows) {
		const at = row.lastActiveAt;
		if (!(at instanceof Date) || Number.isNaN(at.getTime())) continue;
		const current = latest.get(row.userId);
		if (!current || at.getTime() > current.getTime()) latest.set(row.userId, at);
	}
	return latest;
}

/** True when the user's newest activity falls inside the window ending at `now`. */
export function isActiveWithin(
	lastActive: ReadonlyMap<string, Date>,
	userId: string,
	now: Date,
	windowMs: number,
): boolean {
	const at = lastActive.get(userId);
	return at !== undefined && now.getTime() - at.getTime() <= windowMs;
}

/** Split an audience into the users active inside the window and everyone else, keeping order. */
export function splitByActivity<T extends { userId: string }>(
	items: readonly T[],
	lastActive: ReadonlyMap<string, Date>,
	now: Date,
	windowMs: number,
): { active: T[]; inactive: T[] } {
	const active: T[] = [];
	const inactive: T[] = [];
	for (const item of items) {
		(isActiveWithin(lastActive, item.userId, now, windowMs) ? active : inactive).push(item);
	}
	return { active, inactive };
}

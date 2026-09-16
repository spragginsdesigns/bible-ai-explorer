import type { MemoryRecord, PrayerStatus } from "./api";

export const CATEGORY_ORDER = ["profile", "prayer", "study", "preference", "general"] as const;

export const CATEGORY_LABELS: Record<string, string> = {
	profile: "Profile",
	prayer: "Prayer requests",
	study: "Study",
	preference: "Preferences",
	general: "General",
};

export interface MemoryGroup {
	category: string;
	label: string;
	items: MemoryRecord[];
}

/**
 * Groups memories under their category in canonical order, skipping empty
 * groups. A category the server introduces before the app knows about it is
 * folded into "General" so it never vanishes from the list.
 */
export function groupMemoriesByCategory(memories: MemoryRecord[]): MemoryGroup[] {
	const buckets = new Map<string, MemoryRecord[]>();
	for (const memory of memories) {
		const category = CATEGORY_LABELS[memory.category] ? memory.category : "general";
		const bucket = buckets.get(category);
		if (bucket) bucket.push(memory);
		else buckets.set(category, [memory]);
	}
	return CATEGORY_ORDER.filter((category) => buckets.has(category)).map((category) => ({
		category,
		label: CATEGORY_LABELS[category],
		items: buckets.get(category) ?? [],
	}));
}

/** The quiet tag on a settled request. An open one shows its actions instead. */
export const PRAYER_RESOLVED_TAGS: Record<Exclude<PrayerStatus, "open">, string> = {
	answered: "Answered",
	closed: "Closed",
};

export interface PrayerAction {
	label: string;
	status: PrayerStatus;
	/** Spoken form, so "Close" does not read as a navigation control. */
	spoken: string;
}

const RESOLVE_ACTIONS: readonly PrayerAction[] = [
	{ label: "Answered", status: "answered", spoken: "Mark as answered" },
	{ label: "Close", status: "closed", spoken: "Close this prayer request" },
];

const REOPEN_ACTIONS: readonly PrayerAction[] = [
	{ label: "Reopen", status: "open", spoken: "Reopen this prayer request" },
];

/** The one-tap actions offered on a prayer row, by its current status. */
export function prayerActionsFor(status: PrayerStatus): readonly PrayerAction[] {
	return status === "open" ? RESOLVE_ACTIONS : REOPEN_ACTIONS;
}

/**
 * The status to treat a row as having. Only prayer rows carry one, and only the
 * three known values count: a status the server adds later must not silently
 * render "Reopen" against a state this build cannot name.
 */
export function prayerStatusOf(memory: MemoryRecord): PrayerStatus | null {
	if (memory.category !== "prayer") return null;
	return memory.status === "open" || memory.status === "answered" || memory.status === "closed"
		? memory.status
		: null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "asked 12 Sep", in the device's own day rather than UTC's, with the year only
 * when it is not this one. Built by hand rather than through toLocaleDateString
 * so the wording is the same on every locale and on the test runner.
 */
export function prayerAskedLabel(askedAt: string | null | undefined, now = new Date()): string | null {
	if (!askedAt) return null;
	const date = new Date(askedAt);
	if (Number.isNaN(date.getTime())) return null;
	const label = `asked ${date.getDate()} ${MONTHS[date.getMonth()]}`;
	return date.getFullYear() === now.getFullYear() ? label : `${label} ${date.getFullYear()}`;
}

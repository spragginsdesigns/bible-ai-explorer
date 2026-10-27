import type { GrowthOverview, GrowthPractice, GrowthReflection } from "@/lib/beta/growth/growth";
import type { FollowUpChoice, HabitType } from "@/lib/beta/growth/growth-rules";

/**
 * The page's calls to /api/beta/growth. Every call carries the browser's
 * timezone, because "today" and "this week" are the founder's calendar days,
 * not the server's.
 */

export type { GrowthOverview, GrowthPractice, GrowthReflection };

export function browserTimezone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	} catch {
		return "UTC";
	}
}

function withTimezone(path: string, params: Record<string, string> = {}): string {
	const search = new URLSearchParams({ tz: browserTimezone(), ...params });
	return `${path}?${search}`;
}

async function request<T>(method: string, path: string, body?: object, params?: Record<string, string>): Promise<T> {
	let response: Response;
	try {
		response = await fetch(withTimezone(path, params), {
			method,
			cache: "no-store",
			headers: body ? { "Content-Type": "application/json" } : undefined,
			body: body ? JSON.stringify(body) : undefined,
		});
	} catch {
		throw new Error("You appear to be offline. Please try again.");
	}
	const data: unknown = await response.json().catch(() => null);
	if (!response.ok) {
		const error = (data as { error?: unknown } | null)?.error;
		throw new Error(typeof error === "string" && response.status === 400 ? error : "Something went wrong. Please try again.");
	}
	return data as T;
}

export const growthApi = {
	overview: (week?: string) => request<GrowthOverview>("GET", "/api/beta/growth", undefined, week ? { week } : {}),
	addStarterHabits: () => request<{ created: number }>("POST", "/api/beta/growth/habits", { starter: true }),
	addHabit: (habit: { type: HabitType; name?: string; target?: number; reminder?: string | null }) =>
		request<{ id: string }>("POST", "/api/beta/growth/habits", habit),
	updateHabit: (id: string, patch: { name?: string; target?: number; reminder?: string | null }) =>
		request<{ ok: true }>("PATCH", `/api/beta/growth/habits/${encodeURIComponent(id)}`, patch),
	removeHabit: (id: string) => request<{ ok: true }>("DELETE", `/api/beta/growth/habits/${encodeURIComponent(id)}`),
	setHabitDay: (id: string, day: string, done: boolean) =>
		request<{ ok: true }>("PUT", `/api/beta/growth/habits/${encodeURIComponent(id)}/days`, { day, done }),
	addReflection: (entry: { text: string; prompt: string | null; passage: string | null }) =>
		request<GrowthReflection>("POST", "/api/beta/growth/reflections", entry),
	updateReflection: (id: string, patch: { text?: string; prompt?: string | null; passage?: string | null }) =>
		request<GrowthReflection>("PATCH", `/api/beta/growth/reflections/${encodeURIComponent(id)}`, patch),
	removeReflection: (id: string) => request<{ ok: true }>("DELETE", `/api/beta/growth/reflections/${encodeURIComponent(id)}`),
	addPractice: (practice: { text: string; passage: string | null; followUp: FollowUpChoice; reflectionId: string | null }) =>
		request<GrowthPractice>("POST", "/api/beta/growth/practices", practice),
	actOnPractice: (id: string, action: Record<string, unknown>) =>
		request<GrowthPractice>("PATCH", `/api/beta/growth/practices/${encodeURIComponent(id)}`, action),
	removePractice: (id: string) => request<{ ok: true }>("DELETE", `/api/beta/growth/practices/${encodeURIComponent(id)}`),
};

/** "Oct 26" from a calendar day, in the reader's locale. */
export function shortDay(day: string): string {
	return new Date(`${day}T12:00:00.000Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

/** "Monday, Oct 26". */
export function longDay(day: string): string {
	return new Date(`${day}T12:00:00.000Z`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
}

/** "Oct 26 – Nov 1". */
export function weekLabel(weekStart: string, weekEnd: string): string {
	return `${shortDay(weekStart)} – ${shortDay(weekEnd)}`;
}

/** "7:30 AM" from "07:30", in the reader's locale. */
export function reminderLabel(reminder: string): string {
	const [hours, minutes] = reminder.split(":").map(Number);
	return new Date(Date.UTC(2000, 0, 1, hours, minutes)).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
}

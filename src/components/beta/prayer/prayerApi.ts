import type { PrayerOverview, PrayerRequestView } from "@/lib/beta/prayer/prayer";
import type { OutcomeKind } from "@/lib/beta/prayer/prayer-rules";
import { browserTimezone } from "../growth/growthApi";

/**
 * The page's calls. Every /api/beta/prayer call carries the browser's
 * timezone, because "today" and a month on the timeline are the founder's
 * calendar. New requests go through the ordinary prayer list
 * (/api/memories), and sharing through the Groups prayer circle's own route.
 */

export type { PrayerOverview, PrayerRequestView };

export interface GroupChoice {
	id: string;
	name: string;
	archived: boolean;
}

async function request<T>(method: string, path: string, body?: object, timezone = true): Promise<T> {
	const url = timezone ? `${path}?${new URLSearchParams({ tz: browserTimezone() })}` : path;
	let response: Response;
	try {
		response = await fetch(url, {
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

const one = (id: string) => `/api/beta/prayer/${encodeURIComponent(id)}`;

export const prayerApi = {
	overview: () => request<PrayerOverview>("GET", "/api/beta/prayer"),
	addRequest: (content: string) => request<{ id: string }>("POST", "/api/memories", { content, category: "prayer" }, false),
	addUpdate: (id: string, text: string) => request<unknown>("POST", `${one(id)}/updates`, { text }),
	removeUpdate: (id: string, updateId: string) => request<unknown>("DELETE", `${one(id)}/updates/${encodeURIComponent(updateId)}`),
	setDetails: (id: string, details: { passages?: string[]; remindOn?: string | null }) => request<unknown>("PATCH", one(id), details),
	recordOutcome: (id: string, outcome: { kind: OutcomeKind; words: string; reflection: string | null }) =>
		request<unknown>("PUT", `${one(id)}/outcome`, { ...outcome, confirmed: true }),
	reopen: (id: string) => request<unknown>("DELETE", `${one(id)}/outcome`),
	forget: (id: string) => request<unknown>("DELETE", one(id)),
	groups: () => request<{ groups: GroupChoice[] }>("GET", "/api/beta/groups", undefined, false),
	shareToGroup: (groupId: string, memoryId: string) =>
		request<unknown>("POST", `/api/beta/groups/${encodeURIComponent(groupId)}/posts`, { kind: "prayer", memoryId }, false),
};

/** "Oct 3, 2026" on the founder's calendar. */
export function shortDate(iso: string): string {
	return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: browserTimezone() }).format(new Date(iso));
}

/** A calendar day key ("2026-11-02") as "Nov 2, 2026". */
export function dayLabel(day: string): string {
	return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
}

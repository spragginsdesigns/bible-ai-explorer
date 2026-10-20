import type { Href } from "expo-router";

/**
 * Release notes ("What's new"), as served by the shared API. The shapes mirror
 * `src/lib/whats-new-rules.ts`; the server is the only place they are built,
 * from the Play block of `mobile/CHANGELOG.md`.
 */
export type WhatsNewKind = "new" | "improved" | "fixed";

export type WhatsNewTarget =
	| "today"
	| "bible"
	| "chat"
	| "connections"
	| "study"
	| "sermons"
	| "cross"
	| "learn"
	| "plan"
	| "history"
	| "timeline";

export interface WhatsNewEntry {
	version: string;
	versionCode: number;
	/** YYYY-MM-DD. */
	date: string;
	sections: { kind: WhatsNewKind; items: string[] }[];
	title: string;
	headline: string | null;
	why: string | null;
	verse: { text: string; reference: string } | null;
	target: WhatsNewTarget | null;
}

export interface WhatsNewBeginning {
	title: string;
	dateRange: string;
	summary: string;
	items: string[];
}

/** `GET /api/whats-new`. */
export interface WhatsNewDocument {
	entries: WhatsNewEntry[];
	beginning: WhatsNewBeginning;
}

/** `GET /api/whats-new/catch-up`. */
export interface CatchUp {
	cards: { version: string; versionCode: number; title: string; summary: string; target: WhatsNewTarget | null }[];
	newReleaseCount: number;
	seenUpTo: number;
}

/** Where each named target lives in this app (web places several of them elsewhere). */
export const WHATS_NEW_ROUTES: Record<WhatsNewTarget, Href> = {
	today: "/today",
	bible: "/bible",
	chat: "/",
	connections: "/connections",
	study: "/study",
	sermons: "/study/sermons",
	cross: "/today/cross",
	learn: "/today/learn",
	plan: "/today/plan",
	history: "/today/history",
	timeline: "/study/timeline",
};

export const KIND_LABELS: Record<WhatsNewKind, string> = { new: "New", improved: "Improved", fixed: "Fixed" };

/** A release counts as "new" when any section is; otherwise its first section names it. */
export function primaryKind(entry: WhatsNewEntry): WhatsNewKind {
	if (entry.sections.some((section) => section.kind === "new")) return "new";
	return entry.sections[0]?.kind ?? "improved";
}

/** The same search and change-type filter the web journal offers: every word must appear. */
export function filterEntries(entries: WhatsNewEntry[], query: string, kind: WhatsNewKind | null): WhatsNewEntry[] {
	const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
	return entries.filter((entry) => {
		if (kind && !entry.sections.some((section) => section.kind === kind)) return false;
		if (words.length === 0) return true;
		const haystack = [entry.version, entry.title, entry.headline ?? "", ...entry.sections.flatMap((section) => section.items)]
			.join(" ")
			.toLowerCase();
		return words.every((word) => haystack.includes(word));
	});
}

const MONTHS = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];

/** "2026-10-19" -> "October 19, 2026". Parsed by hand so no time zone can move the day. */
export function formatReleaseDate(date: string): string {
	const [year, month, day] = date.split("-").map(Number);
	return `${MONTHS[month - 1] ?? ""} ${day}, ${year}`;
}

/** Consecutive releases grouped under "October 2026" headings, newest first. */
export function groupByMonth(entries: WhatsNewEntry[]): { month: string; entries: WhatsNewEntry[] }[] {
	const groups: { month: string; entries: WhatsNewEntry[] }[] = [];
	for (const entry of entries) {
		const [year, month] = entry.date.split("-").map(Number);
		const label = `${MONTHS[month - 1] ?? ""} ${year}`;
		const last = groups[groups.length - 1];
		if (last?.month === label) last.entries.push(entry);
		else groups.push({ month: label, entries: [entry] });
	}
	return groups;
}

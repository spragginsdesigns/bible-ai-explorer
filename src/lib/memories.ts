/**
 * Client helpers for the Memory feature (Settings → MEMORY). Mirrors the
 * Android client: same /api/memories endpoints, same behavior. All calls are
 * same-origin and carry the Clerk session cookie.
 */

/** Where a prayer request stands. Null on every other memory category. */
export type PrayerStatus = "open" | "answered" | "closed";

export interface MemoryRecord {
	id: string;
	content: string;
	category: string;
	/** Prayer requests only; null on every other category. */
	status: PrayerStatus | null;
	/** ISO instant the prayer request was asked; null on every other category. */
	askedAt: string | null;
	/** ISO instant the assistant may revisit the request; null once resolved. */
	followUpAfter: string | null;
	updatedAt: string;
}

/**
 * The wire shape. The prayer columns are optional here on purpose: the web
 * client may deploy ahead of the API that returns them, and a missing column
 * must read as "not a prayer request" rather than crash the list.
 */
interface RawMemoryRecord {
	id: string;
	content: string;
	category: string;
	status?: string | null;
	askedAt?: string | null;
	followUpAfter?: string | null;
	updatedAt: string;
}

const PRAYER_STATUSES: readonly PrayerStatus[] = ["open", "answered", "closed"];

function toPrayerStatus(value: string | null | undefined): PrayerStatus | null {
	for (const status of PRAYER_STATUSES) {
		if (value === status) return status;
	}
	return null;
}

function normalizeMemory(raw: RawMemoryRecord): MemoryRecord {
	return {
		id: raw.id,
		content: raw.content,
		category: raw.category,
		status: toPrayerStatus(raw.status),
		askedAt: raw.askedAt ?? null,
		followUpAfter: raw.followUpAfter ?? null,
		updatedAt: raw.updatedAt,
	};
}

export interface MemorySummary {
	overview: string;
	sections: { title: string; content: string }[];
}

export interface MemoriesResponse {
	enabled: boolean;
	memories: MemoryRecord[];
}

async function parseError(res: Response): Promise<never> {
	const data = (await res.json().catch(() => null)) as { error?: string } | null;
	throw new Error(data?.error ?? `Request failed (${res.status})`);
}

export async function fetchMemories(): Promise<MemoriesResponse> {
	const res = await fetch("/api/memories", { credentials: "same-origin" });
	if (!res.ok) return parseError(res);
	const data = (await res.json()) as { enabled: boolean; memories?: RawMemoryRecord[] };
	return { enabled: data.enabled, memories: (data.memories ?? []).map(normalizeMemory) };
}

export async function setMemoryEnabled(enabled: boolean): Promise<{ enabled: boolean }> {
	const res = await fetch("/api/memories", {
		method: "PATCH",
		credentials: "same-origin",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ enabled }),
	});
	if (!res.ok) return parseError(res);
	return (await res.json()) as { enabled: boolean };
}

export async function addMemory(content: string): Promise<MemoryRecord> {
	const res = await fetch("/api/memories", {
		method: "POST",
		credentials: "same-origin",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ content }),
	});
	if (!res.ok) return parseError(res);
	return normalizeMemory((await res.json()) as RawMemoryRecord);
}

/**
 * Resolves or re-opens a prayer request. One PATCH, no content change: the
 * route accepts `content` and/or `status`, and this only ever sends `status`.
 */
export async function updateMemoryStatus(id: string, status: PrayerStatus): Promise<void> {
	const res = await fetch(`/api/memories/${encodeURIComponent(id)}`, {
		method: "PATCH",
		credentials: "same-origin",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ status }),
	});
	if (!res.ok) return parseError(res);
}

export async function deleteMemory(id: string): Promise<void> {
	const res = await fetch(`/api/memories/${encodeURIComponent(id)}`, {
		method: "DELETE",
		credentials: "same-origin",
	});
	if (!res.ok) return parseError(res);
}

export async function clearMemories(): Promise<void> {
	const res = await fetch("/api/memories", {
		method: "DELETE",
		credentials: "same-origin",
	});
	if (!res.ok) return parseError(res);
}

export async function generateMemorySummary(): Promise<{
	summary: MemorySummary | null;
	generatedAt: string | null;
}> {
	const res = await fetch("/api/memories/summary", {
		method: "POST",
		credentials: "same-origin",
	});
	if (!res.ok) return parseError(res);
	return (await res.json()) as {
		summary: MemorySummary | null;
		generatedAt: string | null;
	};
}

/** Display labels for memory categories, in canonical display order. */
export const MEMORY_CATEGORY_LABELS: Record<string, string> = {
	profile: "Profile",
	prayer: "Prayer requests",
	study: "Study",
	preference: "Preferences",
	general: "General",
};

const CATEGORY_ORDER = Object.keys(MEMORY_CATEGORY_LABELS);

export interface MemoryGroup {
	category: string;
	label: string;
	memories: MemoryRecord[];
}

/**
 * Groups memories by category in canonical order, omitting empty groups.
 * Unknown categories fall under "General".
 */
export function groupMemoriesByCategory(memories: MemoryRecord[]): MemoryGroup[] {
	const buckets = new Map<string, MemoryRecord[]>();
	for (const memory of memories) {
		const category = memory.category in MEMORY_CATEGORY_LABELS ? memory.category : "general";
		const bucket = buckets.get(category);
		if (bucket) bucket.push(memory);
		else buckets.set(category, [memory]);
	}
	return CATEGORY_ORDER.filter((category) => buckets.has(category)).map((category) => ({
		category,
		label: MEMORY_CATEGORY_LABELS[category],
		memories: buckets.get(category) ?? [],
	}));
}

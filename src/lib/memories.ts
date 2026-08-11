/**
 * Client helpers for the Memory feature (Settings → MEMORY). Mirrors the
 * Android client: same /api/memories endpoints, same behavior. All calls are
 * same-origin and carry the Clerk session cookie.
 */

export interface MemoryRecord {
	id: string;
	content: string;
	category: string;
	updatedAt: string;
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
	return (await res.json()) as MemoriesResponse;
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
	return (await res.json()) as MemoryRecord;
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

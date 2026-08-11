import type { MemoryRecord } from "./api";

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

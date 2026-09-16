import "server-only";

import { HIGHLIGHT_COLORS } from "@/lib/highlights";
import { buildHighlightLegend, type HighlightLegendEntry } from "@/lib/highlight-legend-rules";
import { prisma } from "@/lib/prisma";
import type { HighlightLabels, HighlightMeanings } from "@/lib/preferences-contract";

/**
 * The user's highlight legend for the chat prompt: every preset colour they
 * have named, explained, or used, with how many verses sit under it. One
 * grouped count across translations; fails soft to the label-and-meaning-only
 * legend, because chat must never go down with a side panel of context.
 */
export async function loadHighlightLegend(
	userId: string,
	labels: HighlightLabels,
	meanings: HighlightMeanings,
): Promise<HighlightLegendEntry[]> {
	const counts = new Map<string, number>();
	try {
		const rows = await prisma.verseHighlight.groupBy({
			by: ["color"],
			where: { userId },
			_count: { _all: true },
		});
		for (const row of rows) {
			const hex = row.color.trim().toLowerCase();
			const preset = HIGHLIGHT_COLORS.find((color) => color.hex.toLowerCase() === hex);
			if (!preset) continue;
			counts.set(preset.name, (counts.get(preset.name) ?? 0) + row._count._all);
		}
	} catch (error) {
		console.error("[highlight-legend] Highlight count failed; continuing without counts:", error);
	}
	return buildHighlightLegend(
		HIGHLIGHT_COLORS.map((color) => color.name),
		labels,
		meanings,
		counts,
	);
}

import "server-only";
import type { HistoryLocator, HistorySurface } from "./contracts";
import { historyService, readHistoryList } from "./runtime.server";
import { reviewedHistoryRow } from "./read-boundary";

export const readReviewedHistoryRow = (owner: string, locator: HistoryLocator, source: Parameters<typeof reviewedHistoryRow>[3]) =>
	reviewedHistoryRow(historyService, owner, locator, source);

/** Assistant rows always cross the existing sanitizer, including live external fallbacks. */
export async function readReviewedHistoryList(owner: string, surface: HistorySurface, parentId: string) {
 const batch = await readHistoryList(owner, surface, parentId);
 if (!batch) return null;
 const rows = await Promise.all(batch.rows.map(source => reviewedHistoryRow(batch.service, owner, {surface, parentId, messageId: source.id}, source)));
 return {parent: batch.parent, rows};
}

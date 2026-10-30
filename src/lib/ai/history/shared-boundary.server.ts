import "server-only";
import { historyService } from "./runtime.server";
import { reviewedShareSource, sharedSnapshotMatches, type ShareSourceLocator } from "./shared-boundary";
export const checkedShareSource = (source: ShareSourceLocator) => reviewedShareSource(historyService, source);
export const approvedSharedSnapshot = async (snapshot: ShareSourceLocator & { answer: string; references: unknown; translation: string }) =>
	sharedSnapshotMatches(snapshot, await checkedShareSource(snapshot));

import "server-only";
import { normalizeAssistantMarkdown, stripFollowUpMarkers } from "@/utils/assistantMarkdown";
import { buildReceipts } from "@/lib/chat/receipts";
import { progressFromParts } from "@/lib/chat/progress";
import { HISTORY_RENDERER_DIGEST } from "./manifest";
import type { HistoryRenderer } from "./contracts";

/** Static production imports only. Source/renderer hashes are build-owned, not read from HTTP or disk at runtime. */
export const historyRenderer: HistoryRenderer = Object.freeze({
 digest: HISTORY_RENDERER_DIGEST,
 strip: (text: string) => stripFollowUpMarkers(text, {streaming: false}),
 normalize: (text: string) => normalizeAssistantMarkdown(text, {streaming: false}),
 receipts: buildReceipts,
 progress: progressFromParts,
});

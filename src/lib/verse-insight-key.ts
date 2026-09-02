import { createHash } from "node:crypto";

/**
 * Bump whenever `verseInsightSystemPrompt` changes wording or task. Cached
 * explanations are keyed on it, so the old ones simply stop matching and the
 * next tap regenerates under the new prompt. (Rows written under older
 * versions stay behind as history; nothing reads them.)
 */
export const VERSE_INSIGHT_PROMPT_VERSION = 1;

/**
 * Stable digest of the verse text with whitespace collapsed, so the same
 * verse rendered with a soft wrap or a trailing space still hits. Truncated:
 * 32 hex chars is plenty to separate one verse from another, and the column
 * stays readable in the console.
 *
 * Kept free of path aliases so the plain-node logic tests can import it.
 */
export function verseTextHash(text: string): string {
	return createHash("sha256")
		.update(text.replace(/\s+/g, " ").trim())
		.digest("hex")
		.slice(0, 32);
}

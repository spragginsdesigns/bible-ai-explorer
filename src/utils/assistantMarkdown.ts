/**
 * Normalization for assistant-authored markdown before it reaches a renderer.
 *
 * The web (react-markdown) and Android (markdown-it) clients keep identical
 * copies of this module — `mobile/src/lib/assistantMarkdown.ts` — so both
 * platforms repair the same model-output quirks the same way. The logic is
 * deliberately dependency-free and Hermes-safe (no regex lookbehind) so the
 * two copies can stay byte-for-byte in sync; keep the test vectors mirrored
 * too (`tests/assistant-markdown.test.mjs` and
 * `mobile/src/lib/assistantMarkdown.test.ts`).
 *
 * What it repairs:
 * - text parts glued together across tool calls with no paragraph break
 *   (joinAssistantTextParts)
 * - [FOLLOWUP] marker lines, including a half-typed marker while streaming
 *   (stripFollowUpMarkers)
 * - block constructs (lists, headings, quotes, fences) jammed against the
 *   preceding line, and non-ASCII bullet characters the parsers treat as
 *   plain text (repairMarkdownBlocks)
 * - inline constructs left open at the end of a partial stream
 *   (closeOpenInlineMarkdown)
 */

/**
 * The AI SDK splits an assistant turn into separate text parts around tool
 * calls. The next part usually opens a new block ("- …", "## …", "> …"), so
 * parts must be separated by a blank line or markdown constructs never parse.
 */
export function joinAssistantTextParts(parts: string[]): string {
	return parts.join("\n\n");
}

const FOLLOWUP_LINE_PATTERN = /\r?\n?\[FOLLOWUP\][^\r\n]*/g;
// A trailing, still-typed marker: "[", "[F", "[FO", … at end of buffer.
const PARTIAL_FOLLOWUP_PATTERN = /\r?\n?\[(?:F|FO|FOL|FOLL|FOLLO|FOLLOW|FOLLOWU|FOLLOWUP)?$/;

/**
 * Remove [FOLLOWUP] marker lines. Complete lines are always removed (same
 * per-line semantics as the server's stripFollowUps); while streaming, a
 * partial trailing marker is removed too so it never flashes as literal text.
 */
export function stripFollowUpMarkers(
	text: string,
	options: { streaming: boolean }
): string {
	let out = text.replace(FOLLOWUP_LINE_PATTERN, "");
	if (options.streaming) {
		out = out.replace(PARTIAL_FOLLOWUP_PATTERN, "");
	}
	return out.trimEnd();
}

// Bullet glyphs models emit that neither remark nor markdown-it treat as list
// markers. Dashes (– —) are excluded on purpose: the model uses them for verse
// attribution lines ("— Psalm 46:10, KJV") and converting those would turn
// citations into list items.
const EXOTIC_BULLET_PATTERN = /^([ \t]*)[•●▪◦○‣][ \t]+/gm;

// A line that opens a markdown block construct.
const BLOCK_START_PATTERN = /^[ \t]*(?:[-*+] |\d+\. |#{1,6}\s|> |```)/;
const FENCE_PATTERN = /^[ \t]*```/;

/**
 * Give block constructs room to breathe and normalize exotic bullets.
 * A list/heading/quote/fence line that directly follows a plain text line
 * gets a blank line inserted before it; lines already inside a code fence or
 * following another block line are left alone (tight lists stay tight).
 */
export function repairMarkdownBlocks(text: string): string {
	const lines = text.replace(EXOTIC_BULLET_PATTERN, "$1- ").split("\n");
	const out: string[] = [];
	let inFence = false;
	for (const line of lines) {
		const wasInFence = inFence;
		if (FENCE_PATTERN.test(line)) inFence = !inFence;
		if (!wasInFence && BLOCK_START_PATTERN.test(line) && out.length > 0) {
			const previous = out[out.length - 1];
			if (previous.trim() !== "" && !BLOCK_START_PATTERN.test(previous)) {
				out.push("");
			}
		}
		out.push(line);
	}
	return out.join("\n");
}

/**
 * Close inline constructs that are still open at the end of a partial stream
 * so mid-stream renders don't show literal "**" or "`". Only call this while
 * streaming — a finished message's unbalanced markers are the model's own
 * text and should render as written.
 */
export function closeOpenInlineMarkdown(text: string): string {
	let out = text;
	const fenceCount = (out.match(/```/g) ?? []).length;
	if (fenceCount % 2 === 1) out += "\n```";
	// Count remaining single backticks after fences are accounted for.
	const tickCount = (out.replace(/```/g, "").match(/`/g) ?? []).length;
	if (tickCount % 2 === 1) out += "`";
	if (((out.match(/\*\*/g) ?? []).length) % 2 === 1) out += "**";
	if (((out.match(/~~/g) ?? []).length) % 2 === 1) out += "~~";
	return out;
}

/**
 * Full pipeline applied right before rendering an assistant message.
 */
export function normalizeAssistantMarkdown(
	text: string,
	options: { streaming: boolean }
): string {
	let out = stripFollowUpMarkers(text, options);
	out = repairMarkdownBlocks(out);
	if (options.streaming) out = closeOpenInlineMarkdown(out);
	return out;
}

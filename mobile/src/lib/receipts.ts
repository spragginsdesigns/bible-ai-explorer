/**
 * Receipts: one line for everything the assistant saves. The contract lives in
 * docs/FEATURES.md ("Receipts: one line for everything the assistant saves").
 *
 * Ported from src/lib/chat/receipts.ts (mobile is its own npm tree, so it
 * cannot import the web copy) and mirrored by
 * macos/Shared/Chat/ChatViewMessage.swift. Both TS copies assert against the
 * same fixture (__fixtures__/chat-receipts.json, identical to the web
 * tests/fixtures copy), so a change here changes all three.
 */

export type ChatReceiptKind =
	| "note" | "memory" | "highlight" | "plan" | "cross" | "preference" | "church";

export type ChatReceiptTarget =
	| { screen: "note"; noteId: string }
	| { screen: "memories"; memoryId?: string }
	| { screen: "chapter"; book: number; chapter: number; verse?: number; translation?: "KJV" | "NKJV" }
	| { screen: "plan" }
	| { screen: "cross" }
	| { screen: "settings"; section?: "memory" | "church" | "preferences" };

export interface ChatReceipt {
	/** Stable within the message: `${toolCallId}` or `${toolCallId}:${index}`. */
	id: string;
	kind: ChatReceiptKind;
	/** The whole user-facing fragment, already worded: "Saved to Romans study". */
	label: string;
	target: ChatReceiptTarget;
	/** Present only when the client can undo from the fragment. */
	undo?: { type: "forgetMemory"; memoryId: string };
}

/** A highlight in the reader's default colour needs no "as Yellow" suffix. */
const DEFAULT_HIGHLIGHT_COLOR_NAME = "Yellow";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function nonEmptyString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value : null;
}

function positiveInteger(value: unknown): number | null {
	return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : null;
}

function memoryReceipt(id: string, memoryId: string): ChatReceipt {
	return {
		id,
		kind: "memory",
		label: "Remembered",
		target: { screen: "memories", memoryId },
		undo: { type: "forgetMemory", memoryId },
	};
}

/** The receipt for one settled, successful tool call, or null for reads and failures. */
function toolReceipt(
	toolName: string,
	id: string,
	input: Record<string, unknown>,
	output: Record<string, unknown>
): ChatReceipt | null {
	switch (toolName) {
		case "addToNote":
		case "updateNote": {
			const noteId = nonEmptyString(output.noteId);
			const noteTitle = nonEmptyString(output.noteTitle);
			if (!noteId || !noteTitle) return null;
			const label =
				toolName === "updateNote"
					? `Updated ${noteTitle}`
					: output.created === true && output.matchedExisting !== true
						? `Saved to ${noteTitle}`
						: `Added to ${noteTitle}`;
			return { id, kind: "note", label, target: { screen: "note", noteId } };
		}
		case "organizeNote": {
			const noteId = nonEmptyString(output.noteId);
			const title = nonEmptyString(output.title);
			if (!noteId || !title) return null;
			return { id, kind: "note", label: `Filed ${title}`, target: { screen: "note", noteId } };
		}
		case "saveMemory": {
			const memoryId = isRecord(output.memory) ? nonEmptyString(output.memory.id) : null;
			return output.success === true && memoryId ? memoryReceipt(id, memoryId) : null;
		}
		case "updateMemory": {
			const memoryId = isRecord(output.memory) ? nonEmptyString(output.memory.id) : null;
			if (output.success !== true || !memoryId) return null;
			return { id, kind: "memory", label: "Memory updated", target: { screen: "memories", memoryId } };
		}
		case "deleteMemories": {
			// deleteMemories refuses unless every id is owned, so a zero count
			// means nothing changed and there is nothing to receipt.
			const deleted = positiveInteger(output.deleted);
			if (output.success !== true || deleted === null) return null;
			return {
				id,
				kind: "memory",
				label: `Forgot ${deleted} ${deleted === 1 ? "memory" : "memories"}`,
				target: { screen: "memories" },
			};
		}
		case "setDailyCross": {
			const reference = nonEmptyString(output.reference);
			if (!reference) return null;
			return { id, kind: "cross", label: `Today's cross: ${reference}`, target: { screen: "cross" } };
		}
		case "startReadingPlan": {
			const title = nonEmptyString(output.title);
			if (output.hasPlan !== true || !title) return null;
			return { id, kind: "plan", label: `Started ${title}`, target: { screen: "plan" } };
		}
		case "markReadingPlanDay": {
			// The plan output does not say which day was ticked, so the number
			// comes from the call. An untick (done: false) has no label in the
			// contract, and "Marked day n" would state the opposite of what
			// happened, so it leaves no receipt until the contract names one.
			const day = positiveInteger(input.day);
			if (output.hasPlan !== true || day === null || input.done === false) return null;
			return { id, kind: "plan", label: `Marked day ${day}`, target: { screen: "plan" } };
		}
		case "highlightVerse": {
			const reference = nonEmptyString(output.reference);
			const book = positiveInteger(output.bookNumber);
			const chapter = positiveInteger(output.chapter);
			const verse = positiveInteger(output.verse);
			if (output.success !== true || !reference || book === null || chapter === null || verse === null) {
				return null;
			}
			const colorName = nonEmptyString(output.colorName);
			const label =
				colorName && colorName !== DEFAULT_HIGHLIGHT_COLOR_NAME
					? `Marked ${reference} as ${colorName}`
					: `Marked ${reference}`;
			const translation =
				output.translation === "KJV" || output.translation === "NKJV" ? output.translation : undefined;
			return {
				id,
				kind: "highlight",
				label,
				target: { screen: "chapter", book, chapter, verse, ...(translation ? { translation } : {}) },
			};
		}
		default:
			return null;
	}
}

/**
 * Receipts for one assistant message, in part order, derived only from
 * persisted parts so a restored conversation replays the same line. Only
 * `output-available` tool parts count: a tool that threw arrives as
 * `output-error`, and one that declined arrives with `success: false`; both
 * leave no receipt because the assistant says what failed in prose.
 */
export function buildReceipts(parts: readonly unknown[]): ChatReceipt[] {
	const receipts: ChatReceipt[] = [];
	parts.forEach((part, index) => {
		if (!isRecord(part) || typeof part.type !== "string") return;

		if (part.type === "data-memoryExtracted") {
			const memoryId = isRecord(part.data) ? nonEmptyString(part.data.memoryId) : null;
			// Data parts carry no toolCallId; the memory id is unique within a message.
			if (memoryId) receipts.push(memoryReceipt(`memoryExtracted:${memoryId}`, memoryId));
			return;
		}

		if (!part.type.startsWith("tool-") || part.state !== "output-available") return;
		if (!isRecord(part.output) || part.output.success === false) return;
		const id = nonEmptyString(part.toolCallId) ?? `part-${index}`;
		const input = isRecord(part.input) ? part.input : {};
		const receipt = toolReceipt(part.type.slice("tool-".length), id, input, part.output);
		if (receipt) receipts.push(receipt);
	});
	return receipts;
}

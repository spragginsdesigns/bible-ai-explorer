import type { TextStreamPart, ToolSet } from "ai";

/**
 * Em and en dashes never reach a reader.
 *
 * Models reach for the em dash constantly ("Christ<em dash>not on 1 Enoch",
 * "the Bible<em dash>especially the Gospels<em dash>and"), and no prompt
 * wording stops them reliably, so the rule is enforced here, on the text
 * itself, before it is streamed to a client or persisted. Three shapes are
 * handled:
 *
 * - A dash inside prose becomes a comma, with the spacing repaired on both
 *   sides: "word<dash>word", "word <dash> word" and "word<dash> word" all
 *   become "word, word".
 * - A dash that opens a line (after any blockquote markers) is dropped, with
 *   the space after it. That is the verse attribution convention the system
 *   prompt used to ask for ("> <em dash> Psalm 46:10, KJV"), which is now
 *   just "> Psalm 46:10, KJV".
 * - A dash directly after a digit becomes a hyphen, so a verse range like
 *   "3:16<en dash>17" stays a range.
 *
 * The stripper is incremental because the answer arrives as deltas: a chunk
 * can end on the space before a dash, or on the dash itself, and the result
 * must not depend on where the provider cut it. Feeding the same text one
 * character at a time and all at once produces identical output.
 */

// Built from code points, never written as characters or as \u escapes: the
// editing tooling on the development machine flattens both to a hyphen, and a
// stripper that matched "-" would rewrite every hyphen in every answer.
const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);

/** Characters that already close a clause, so no comma space is needed after one. */
const CLAUSE_PUNCTUATION = new Set([",", ".", ";", ":", "!", "?", ")", "\n", "\r"]);

type AfterDash = "none" | "comma" | "drop";

export interface DashStripper {
	/** Transform the next chunk. Output may lag the input by trailing spaces. */
	push(chunk: string): string;
	/** Release anything still held. Call once at the end of a text block. */
	flush(): string;
}

export function createDashStripper(): DashStripper {
	// True from the start of a line until its first character that is not a
	// blockquote marker or whitespace: the region where a dash is an
	// attribution opener rather than prose.
	let lineStart = true;
	// Whitespace not yet emitted, held back because a dash may follow and
	// want to swallow it.
	let held = "";
	let afterDash: AfterDash = "none";
	// The last character actually emitted, for the digit-range rule.
	let last = "";

	const isSpace = (c: string) => c === " " || c === "\t";
	const isDigit = (c: string) => c >= "0" && c <= "9";

	function push(chunk: string): string {
		let out = "";
		const emit = (text: string) => {
			if (!text) return;
			out += text;
			last = text[text.length - 1] ?? last;
		};
		for (const c of chunk) {
			if (afterDash === "comma") {
				afterDash = "none";
				if (isSpace(c)) {
					emit(" ");
					continue;
				}
				if (!CLAUSE_PUNCTUATION.has(c)) emit(" ");
			} else if (afterDash === "drop") {
				if (isSpace(c)) continue;
				afterDash = "none";
			}

			if (c === EM_DASH || c === EN_DASH) {
				if (lineStart) {
					// Attribution opener: keep the indentation, lose the dash and
					// the space after it.
					emit(held);
					held = "";
					afterDash = "drop";
				} else if (held === "" && isDigit(last)) {
					emit("-");
				} else {
					held = "";
					emit(",");
					afterDash = "comma";
				}
				continue;
			}

			if (isSpace(c)) {
				held += c;
				continue;
			}
			emit(held);
			held = "";
			if (c === "\n") {
				emit(c);
				lineStart = true;
				continue;
			}
			emit(c);
			if (c !== ">" && c !== "\r") lineStart = false;
		}
		return out;
	}

	function flush(): string {
		const rest = held;
		held = "";
		afterDash = "none";
		return rest;
	}

	return { push, flush };
}

/** The whole-string form, for text that is not streamed. */
export function stripDashes(text: string): string {
	const stripper = createDashStripper();
	return stripper.push(text) + stripper.flush();
}

/**
 * The `streamText` transform. One stripper per text block (a tool loop
 * produces several, each with its own id), flushed on that block's end so a
 * held trailing space is never lost.
 */
export function plainDashes<TOOLS extends ToolSet>(): (options: {
	tools: TOOLS;
}) => TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>> {
	return () => {
		const strippers = new Map<string, DashStripper>();
		const lastDelta = new Map<string, Extract<TextStreamPart<TOOLS>, { type: "text-delta" }>>();
		return new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
			transform(part, controller) {
				if (part.type === "text-delta") {
					let stripper = strippers.get(part.id);
					if (!stripper) {
						stripper = createDashStripper();
						strippers.set(part.id, stripper);
					}
					lastDelta.set(part.id, part);
					const text = stripper.push(part.text);
					if (text) controller.enqueue({ ...part, text });
					return;
				}
				if (part.type === "text-end") {
					const rest = strippers.get(part.id)?.flush() ?? "";
					const template = lastDelta.get(part.id);
					if (rest && template) controller.enqueue({ ...template, text: rest });
					strippers.delete(part.id);
					lastDelta.delete(part.id);
				}
				controller.enqueue(part);
			},
		});
	};
}

/**
 * Normalization for assistant-authored markdown before it reaches a renderer.
 *
 * This is the Android copy of the web module `src/utils/assistantMarkdown.ts`.
 * The two are kept byte-for-byte in sync BELOW THIS HEADER COMMENT so both
 * platforms repair the same model-output quirks the same way. The logic is
 * deliberately dependency-free and Hermes-safe (no regex lookbehind). This
 * header differs by design and `tests/assistant-markdown.test.mjs` asserts the
 * rest matches exactly. Keep the test vectors mirrored too
 * (`mobile/src/lib/assistantMarkdown.test.ts` here).
 */

/**
 * What this module repairs:
 * - text parts glued together across tool calls with no paragraph break
 *   (joinAssistantTextParts)
 * - [FOLLOWUP] marker lines, including a half-typed marker while streaming
 *   (stripFollowUpMarkers)
 * - inline HTML the model emitted that neither renderer will interpret
 *   (normalizeInlineHtml)
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
 * Empty parts are dropped: providers routinely emit a zero-length text item
 * before the real answer, and joining it would fabricate a leading blank line.
 */
export function joinAssistantTextParts(parts: string[]): string {
	return parts.filter((part) => part.trim() !== "").join("\n\n");
}

// ---------------------------------------------------------------------------
// Shared line primitives
// ---------------------------------------------------------------------------

const ALPHANUMERIC_PATTERN = /[0-9A-Za-z]/;

/** Columns the leading whitespace occupies, tabs expanded to 4-column stops. */
function indentWidth(line: string): number {
	let width = 0;
	for (let i = 0; i < line.length; i += 1) {
		const character = line[i];
		if (character === " ") width += 1;
		else if (character === "\t") width += 4 - (width % 4);
		else break;
	}
	return width;
}

/** Index of the first non-whitespace character on the line. */
function contentStart(line: string): number {
	let index = 0;
	while (index < line.length && (line[index] === " " || line[index] === "\t")) {
		index += 1;
	}
	return index;
}

// A fence delimiter once its container prefix is off: 3+ backticks or tildes.
const FENCE_RUN_PATTERN = /^(`{3,}|~{3,})(.*)$/;
// CommonMark allows a fence 3 columns in RELATIVE to its container, so the
// absolute indent grows with every list level and a flat 3-column cap misreads
// a fence nested one level deep as prose. Rather than parse containers, allow
// up to 12 columns - three levels of nesting, past anything a model emits.
const MAX_FENCE_INDENT = 12;

type ContainerPrefix = {
	/** Number of ">" blockquote markers the line opens with. */
	depth: number;
	/** Columns of indent after the last marker, tabs expanded. */
	indent: number;
	/** Index just past the prefix. */
	end: number;
};

/**
 * Split off a line's blockquote markers and the whitespace around them. Indent
 * is measured from the LAST ">" because blockquote content is indented relative
 * to its marker rather than to column zero.
 */
function containerPrefix(line: string): ContainerPrefix {
	let end = 0;
	let depth = 0;
	let indent = 0;
	while (end < line.length) {
		const character = line[end];
		if (character === " ") indent += 1;
		else if (character === "\t") indent += 4 - (indent % 4);
		else if (character === ">") {
			depth += 1;
			indent = 0;
		} else break;
		end += 1;
	}
	return { depth, indent, end };
}

type FenceCandidate = {
	depth: number;
	character: string;
	length: number;
	info: string;
};

/**
 * The fence this line would open or close, if any. A fence inside a blockquote
 * ("> ```") or nested in a list item ("    ```") is a fence: not recognising
 * those is what let every later stage rewrite real code-block contents.
 */
function fenceCandidate(line: string): FenceCandidate | null {
	const prefix = containerPrefix(line);
	if (prefix.indent > MAX_FENCE_INDENT) return null;
	const match = FENCE_RUN_PATTERN.exec(line.slice(prefix.end));
	if (match === null) return null;
	return {
		depth: prefix.depth,
		character: match[1][0],
		length: match[1].length,
		info: match[2],
	};
}

type FenceScan = {
	/** Line is fence content or the closing delimiter - never rewritten. */
	inside: boolean[];
	/** Line is an opening or closing fence delimiter. */
	delimiter: boolean[];
	/** Marker character of a fence still open at the end of the input, or "". */
	openCharacter: string;
	/** Run length of that still-open fence. */
	openLength: number;
	/** Blockquote depth the still-open fence was opened at. */
	openDepth: number;
};

/**
 * Track fences by marker character AND run length, so a ``` line inside a
 * ```` fence is content rather than a close, and a ~~~ fence is recognised at
 * all. The previous ```-counting version rewrote code-block content.
 *
 * Blockquote depth is tracked too. A fence opened at "> ```" closes only on a
 * delimiter at the same depth - and, because the blockquote itself ends at a
 * blank line or at a line carrying fewer ">" markers, on the end of the quote.
 * Without that second rule one unclosed quoted fence would mark the whole rest
 * of the document as code and freeze every later repair.
 */
function scanFences(lines: string[]): FenceScan {
	const inside: boolean[] = [];
	const delimiter: boolean[] = [];
	let openCharacter = "";
	let openLength = 0;
	let openDepth = 0;
	for (const line of lines) {
		if (
			openCharacter !== "" &&
			openDepth > 0 &&
			(line.trim() === "" || containerPrefix(line).depth < openDepth)
		) {
			openCharacter = "";
			openLength = 0;
			openDepth = 0;
		}
		const wasOpen = openCharacter !== "";
		const candidate = fenceCandidate(line);
		let isDelimiter = false;
		if (candidate !== null) {
			if (!wasOpen) {
				openCharacter = candidate.character;
				openLength = candidate.length;
				openDepth = candidate.depth;
				isDelimiter = true;
			} else if (
				candidate.depth === openDepth &&
				candidate.character === openCharacter &&
				candidate.length >= openLength &&
				candidate.info.trim() === ""
			) {
				openCharacter = "";
				openLength = 0;
				openDepth = 0;
				isDelimiter = true;
			}
		}
		inside.push(wasOpen);
		delimiter.push(isDelimiter);
	}
	return { inside, delimiter, openCharacter, openLength, openDepth };
}

type MarkerKind = "list" | "heading" | "quote" | "fence" | null;

const LIST_MARKER_PATTERN = /^(?:[-*+]|\d{1,9}\.)[ \t]/;
const HEADING_MARKER_PATTERN = /^#{1,6}(?:[ \t]|$)/;
const FENCE_MARKER_PATTERN = /^(?:`{3,}|~{3,})/;
const LIST_MARKER_WIDTH_PATTERN = /^([-*+]|\d{1,9}\.)([ \t]+)/;

/**
 * Which block construct, if any, this line opens. The blockquote arm accepts a
 * bare ">" with no trailing space on purpose: ">", ">>" and ">text" are all
 * blockquote lines, and treating them as prose is what split one quote into
 * two cards.
 */
function markerKind(line: string): MarkerKind {
	const rest = line.slice(contentStart(line));
	if (rest.length === 0) return null;
	if (rest[0] === ">") return "quote";
	if (LIST_MARKER_PATTERN.test(rest)) return "list";
	if (HEADING_MARKER_PATTERN.test(rest)) return "heading";
	if (FENCE_MARKER_PATTERN.test(rest)) return "fence";
	return null;
}

/** Column at which a list item's own content begins. */
function listContentColumn(line: string): number {
	const base = indentWidth(line);
	const rest = line.slice(contentStart(line));
	const match = LIST_MARKER_WIDTH_PATTERN.exec(rest);
	if (match === null) return base;
	let column = base + match[1].length;
	for (const character of match[2]) {
		column += character === "\t" ? 4 - (column % 4) : 1;
	}
	return column;
}

/**
 * Lines that belong to an INDENTED code block: a run opened by a blank line
 * whose lines sit four or more columns past the enclosing container, ended by
 * the first line that does not. Nothing else in this module detects indented
 * code, so without this every stage happily deleted lines out of one -
 * dedentOverIndentedMarkerRun's own doc comment already treats a
 * blank-line-preceded indented run as code that must not be touched, and this
 * makes the rest of the pipeline agree with it.
 *
 * The threshold is relative to the innermost open list item's content column,
 * so a bullet indented four spaces under an open list is still a nested list
 * item and still gets repaired; only four columns BEYOND the container is code.
 * Fenced lines are never indented code - scanFences already owns them.
 */
function scanIndentedCode(lines: string[], fences: FenceScan): boolean[] {
	const code: boolean[] = [];
	let listColumn = 0;
	let inCode = false;
	// The start of the document is a block boundary, exactly like a blank line.
	let afterBlank = true;
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (fences.inside[index] || fences.delimiter[index]) {
			code.push(false);
			inCode = false;
			afterBlank = false;
			continue;
		}
		if (line.trim() === "") {
			// A blank line does not end an indented code block; it is part of one
			// as long as an indented line follows.
			code.push(false);
			afterBlank = true;
			continue;
		}
		const width = indentWidth(line);
		if ((inCode || afterBlank) && width >= listColumn + 4) {
			inCode = true;
			afterBlank = false;
			code.push(true);
			continue;
		}
		inCode = false;
		afterBlank = false;
		code.push(false);
		const kind = markerKind(line);
		if (kind === "list") {
			const column = listContentColumn(line);
			listColumn = listColumn > 0 ? Math.min(listColumn, column) : column;
		} else if (width < listColumn) {
			listColumn = 0;
		}
	}
	return code;
}

// ---------------------------------------------------------------------------
// [FOLLOWUP] markers
// ---------------------------------------------------------------------------

// Anchored to the start of a line: the server only ever emits markers there,
// and an unanchored match ate mid-sentence prose that merely mentioned one.
const FOLLOWUP_LINE_PATTERN = /^[ \t]*\[FOLLOWUP\]/;
// A trailing, still-typed marker: "[", "[F", "[FO", … at the end of the buffer,
// and only when it starts its own line - otherwise a markdown link being typed
// ("see [") flickers away mid-stream.
const PARTIAL_FOLLOWUP_PATTERN =
	/(?:^|\r?\n)[ \t]*\[(?:F|FO|FOL|FOLL|FOLLO|FOLLOW|FOLLOWU|FOLLOWUP)?$/;

/**
 * Remove [FOLLOWUP] marker lines. Complete lines are always removed (same
 * per-line semantics as the server's stripFollowUps); while streaming, a
 * partial trailing marker is removed too so it never flashes as literal text.
 * Markers inside a code block, fenced or indented, are left alone - there they
 * are sample text.
 */
export function stripFollowUpMarkers(
	text: string,
	options: { streaming: boolean }
): string {
	const lines = text.split("\n");
	const fences = scanFences(lines);
	const code = scanIndentedCode(lines, fences);
	const kept: string[] = [];
	let index = 0;
	while (index < lines.length) {
		const line = lines[index];
		if (!fences.inside[index] && !code[index] && FOLLOWUP_LINE_PATTERN.test(line)) {
			// Removing the marker line must not leave a doubled blank line behind.
			const followsBlank =
				kept.length === 0 || kept[kept.length - 1].trim() === "";
			index += 1;
			while (
				followsBlank &&
				index < lines.length &&
				!fences.inside[index] &&
				!code[index] &&
				lines[index].trim() === ""
			) {
				index += 1;
			}
			continue;
		}
		kept.push(line);
		index += 1;
	}
	let out = kept.join("\n");
	if (options.streaming) {
		out = out.replace(PARTIAL_FOLLOWUP_PATTERN, "");
	}
	return out.trimEnd();
}

// ---------------------------------------------------------------------------
// Inline HTML
// ---------------------------------------------------------------------------

// Neither renderer interprets raw HTML: react-markdown escapes it (rehype-raw
// would be an XSS hole for model output) and markdown-it with html:true routes
// html_block/html_inline to renderRules.unknown, which draws nothing at all.
// So the tags are removed here and their text content kept.
const HTML_SCRIPT_BLOCK_PATTERN = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi;
const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g;
// Deliberately NOT global: this pattern is only ever handed to String.split,
// which splits on every occurrence regardless of the flag, and a lingering
// lastIndex on a shared /g regex is a classic source of skipped matches.
const HTML_BREAK_PATTERN = /<br[ \t]*\/?>/i;
const HTML_TAG_NAMES =
	"a|abbr|article|aside|b|blockquote|body|button|center|cite|code|dd|del|div|dl|dt|em|figcaption|figure|font|form|h[1-6]|head|header|hr|html|i|iframe|img|input|ins|kbd|li|main|mark|nav|nobr|object|ol|p|pre|q|s|samp|script|section|small|span|strong|style|sub|sup|svg|table|tbody|td|th|thead|tr|u|ul|var|wbr";
// One attribute: a name, "=", and a quoted or bare value. Requiring the "="
// is what tells a real tag from prose that happens to sit in angle brackets.
const HTML_ATTRIBUTE_SOURCE =
	"[ \\t\\r\\n]+[A-Za-z_:][A-Za-z0-9_.:-]*[ \\t]*=[ \\t]*(?:\"[^\"]*\"|'[^']*'|[^ \\t>]*)";
// A tag is stripped only when the character after its name closes the tag or
// opens an attribute. "<b and c>" is prose about the letter b, not markup, and
// "<https://example.com>" is an autolink - neither may be swallowed.
const HTML_TAG_PATTERN = new RegExp(
	"<\\/?(?:" +
		HTML_TAG_NAMES +
		")\\b(?:[ \\t]*\\/?>|(?:" +
		HTML_ATTRIBUTE_SOURCE +
		")+[ \\t\\r\\n]*\\/?>)",
	"gi"
);
// A blockquote prefix, so a hard break inside a quote can repeat it.
const QUOTE_PREFIX_PATTERN = /^[ \t]*(?:>[ \t]?)+/;

function stripHtmlFromSegment(segment: string): string {
	return segment
		.replace(HTML_SCRIPT_BLOCK_PATTERN, "")
		.replace(HTML_COMMENT_PATTERN, "")
		.replace(HTML_TAG_PATTERN, "");
}

/**
 * Split a line into alternating plain (even index) and code-span (odd index)
 * segments. Code spans pair by backtick RUN LENGTH, so "``a`b``" is one span;
 * a single-backtick splitter tore it in half and exposed its contents.
 */
function splitInlineCode(line: string): string[] {
	const segments: string[] = [];
	let plain = "";
	let index = 0;
	while (index < line.length) {
		if (line[index] !== "`") {
			plain += line[index];
			index += 1;
			continue;
		}
		let openEnd = index;
		while (openEnd < line.length && line[openEnd] === "`") openEnd += 1;
		const runLength = openEnd - index;
		let cursor = openEnd;
		let closeEnd = -1;
		while (cursor < line.length) {
			if (line[cursor] !== "`") {
				cursor += 1;
				continue;
			}
			let end = cursor;
			while (end < line.length && line[end] === "`") end += 1;
			if (end - cursor === runLength) {
				closeEnd = end;
				break;
			}
			cursor = end;
		}
		if (closeEnd === -1) {
			plain += line.slice(index, openEnd);
			index = openEnd;
			continue;
		}
		segments.push(plain);
		plain = "";
		segments.push(line.slice(index, closeEnd));
		index = closeEnd;
	}
	segments.push(plain);
	return segments;
}

/**
 * The prefix a continuation line must repeat to stay inside the same container
 * as `line`: its indent, its blockquote markers, and - inside a list item -
 * blanks as wide as the marker so the text lands on the item's content column.
 */
function continuationPrefix(line: string): string {
	const quote = QUOTE_PREFIX_PATTERN.exec(line);
	const prefix = quote === null ? "" : quote[0];
	const rest = line.slice(prefix.length);
	const start = contentStart(rest);
	const indent = rest.slice(0, start);
	const marker = LIST_MARKER_WIDTH_PATTERN.exec(rest.slice(start));
	if (marker === null) return prefix + indent;
	return prefix + indent + " ".repeat(marker[1].length + marker[2].length);
}

/**
 * Turn model-emitted `<br>` into a markdown hard break and drop the remaining
 * HTML tags. Fenced code and inline code spans are untouched.
 *
 * A `<br>` with nothing but whitespace after it is DELETED rather than turned
 * into "  \n": that trailing newline opened a blank line, and a blank line
 * closes whatever container the line sat in - which is how a quoted verse whose
 * lines each end in <br> reached the renderer as three separate quote cards.
 * A mid-line `<br>` becomes a hard break followed by the line's own container
 * prefix, so the continuation stays in the same blockquote or list item. No
 * whitespace-only line is ever produced.
 *
 * A `<br>` inside a GFM TABLE ROW becomes a single space instead. A table cell
 * is the one place markdown has no line break of its own, so models emit `<br>`
 * there routinely - and a row is a single line by definition, so any hard break
 * splits it into a phantom row with the wrong column count.
 */
export function normalizeInlineHtml(text: string): string {
	if (text.indexOf("<") === -1) return text;
	const lines = text.split("\n");
	const fences = scanFences(lines);
	const code = scanIndentedCode(lines, fences);
	const out: string[] = [];
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (fences.inside[index] || fences.delimiter[index] || code[index]) {
			out.push(line);
			continue;
		}
		const trimmed = line.trim();
		const isTableRow = trimmed.length > 0 && trimmed[0] === "|";
		const pieces: string[] = [""];
		const segments = splitInlineCode(line);
		for (let segment = 0; segment < segments.length; segment += 1) {
			if (segment % 2 === 1) {
				pieces[pieces.length - 1] += segments[segment];
				continue;
			}
			const parts = segments[segment].split(HTML_BREAK_PATTERN);
			for (let part = 0; part < parts.length; part += 1) {
				if (part > 0) {
					if (isTableRow) {
						// One space, not two: a run of breaks, or a break already flanked
						// by a space, must not grow the cell's whitespace on every pass -
						// the pipeline has to stay a fixed point.
						const at = pieces.length - 1;
						const before = pieces[at].slice(-1);
						const after = parts[part].slice(0, 1);
						const spaced =
							before === " " ||
							before === "\t" ||
							after === " " ||
							after === "\t";
						if (!spaced) pieces[at] += " ";
					} else pieces.push("");
				}
				pieces[pieces.length - 1] += stripHtmlFromSegment(parts[part]);
			}
		}
		// The first piece carries the line's own prefix and is always kept; a
		// later piece with no text of its own would render as a blank line and
		// close the container, so consecutive and trailing breaks are dropped.
		const kept = [pieces[0]];
		for (let piece = 1; piece < pieces.length; piece += 1) {
			if (pieces[piece].trim() !== "") kept.push(pieces[piece]);
		}
		if (kept.length < pieces.length) {
			kept[kept.length - 1] = kept[kept.length - 1].replace(/[ \t]+$/, "");
		}
		if (kept.length === 1) {
			out.push(kept[0]);
			continue;
		}
		// Only the first piece already carries the line's prefix; the rest have to
		// repeat it. A leading piece that is nothing but that prefix is dropped so
		// a line opening with <br> never starts with a whitespace-only line.
		const prefix = continuationPrefix(line);
		const rendered: string[] = [];
		for (let piece = 0; piece < kept.length; piece += 1) {
			const text = piece === 0 ? kept[piece] : prefix + kept[piece];
			if (rendered.length === 0 && text.trim() === "") continue;
			rendered.push(text);
		}
		out.push(rendered.join("  \n"));
	}
	return out.join("\n");
}

// ---------------------------------------------------------------------------
// Block repair
// ---------------------------------------------------------------------------

// Bullet glyphs models emit that neither remark nor markdown-it treat as list
// markers. En and em dashes are excluded on purpose: the model uses them to
// open verse attribution lines ("<em dash> Psalm 46:10, KJV") and converting
// those would turn every citation into a list item. The trailing whitespace is
// optional because the system prompt itself few-shots the no-space form
// ("<bullet>Therefore"), and the leading group carries any blockquote prefix
// through so a bulleted list inside a quote is converted in place.
//
// The bullet glyphs on the next line are load-bearing and must survive
// verbatim; everywhere else this file stays ASCII, because the editing tooling
// on this machine silently rewrites U+2014 to a hyphen.
const EXOTIC_BULLET_PATTERN = /^([ \t]*(?:>[ \t]*)*)[•●▪◦○‣][ \t]*/;
// A tab indents four columns - exactly the indented-code trigger - so a
// tab-indented marker is re-indented to two spaces instead.
const TAB_INDENTED_MARKER_PATTERN =
	/^\t+(?=(?:[-*+]|\d{1,9}\.)[ \t]|#{1,6}[ \t]|>)/;

function normalizeMarkerIndent(line: string): string {
	const match = TAB_INDENTED_MARKER_PATTERN.exec(line);
	if (match === null) return line;
	return "  ".repeat(match[0].length) + line.slice(match[0].length);
}

/**
 * A run of 4+-indented lines that are ALL markers, sitting directly under a
 * paragraph, is a list the model over-indented - dedent it to column 0 so it
 * parses. A run containing any non-marker line is a genuine code sample and is
 * left alone, as is anything preceded by a blank line (already a code block),
 * anything nested inside an open list, and anything inside a fence.
 *
 * The caller has already established that the line before `start` is non-blank
 * prose indented at most three columns. That last part is what keeps a marker
 * line found PART WAY DOWN an indented code block from being dedented out of
 * it: in "Example output:\n\n    print(x)\n    > 42" the "> 42" line is a
 * marker preceded by a non-blank line, and dedenting it split the code block.
 *
 * Returns the index the scan reached so the caller can skip the rest of the run
 * and the whole walk stays linear rather than quadratic in the run length.
 */
function dedentOverIndentedMarkerRun(
	lines: string[],
	fences: FenceScan,
	code: boolean[],
	start: number
): number {
	if (fences.inside[start] || fences.delimiter[start] || code[start]) return start + 1;
	if (indentWidth(lines[start]) < 4) return start + 1;
	if (markerKind(lines[start]) === null) return start + 1;
	let end = start;
	let everyLineIsAMarker = true;
	while (end < lines.length) {
		if (fences.inside[end] || fences.delimiter[end] || code[end]) break;
		const line = lines[end];
		if (line.trim() === "") break;
		if (indentWidth(line) < 4) break;
		if (markerKind(line) === null) {
			everyLineIsAMarker = false;
			break;
		}
		end += 1;
	}
	if (!everyLineIsAMarker) return end + 1;
	let minimum = Number.MAX_SAFE_INTEGER;
	for (let index = start; index < end; index += 1) {
		minimum = Math.min(minimum, indentWidth(lines[index]));
	}
	for (let index = start; index < end; index += 1) {
		const width = indentWidth(lines[index]) - minimum;
		lines[index] = " ".repeat(width) + lines[index].slice(contentStart(lines[index]));
	}
	return end;
}

/**
 * Give block constructs room to breathe and normalize exotic bullets.
 *
 * A list/heading/quote/fence line that directly follows plain prose gets a
 * blank line inserted before it. Everything else is left exactly as written -
 * in particular the walk carries real container state (is a blockquote open?
 * is a list open, and at what content column?) so a lazy continuation, a bare
 * ">" spacer, a nested ">>", or a wrapped list item never gets a blank line
 * jammed into the middle of the block it belongs to. Testing only the single
 * previous line is what split one blockquote into two cards.
 */
export function repairMarkdownBlocks(text: string): string {
	// Mixed line endings defeat every line rule below, and the separators this
	// function injects would be bare "\n" amid "\r\n".
	const lines = text.replace(/\r\n?/g, "\n").split("\n");
	const fences = scanFences(lines);
	const code = scanIndentedCode(lines, fences);

	for (let index = 0; index < lines.length; index += 1) {
		if (fences.inside[index] || fences.delimiter[index] || code[index]) continue;
		lines[index] = normalizeMarkerIndent(lines[index]).replace(
			EXOTIC_BULLET_PATTERN,
			"$1- "
		);
	}

	const out: string[] = [];
	let quoteOpen = false;
	let listOpen = false;
	let listColumn = 0;
	let sawBlank = false;
	// Every line up to here has already been offered to the dedent scan, so a
	// long run is walked once instead of once per line in it.
	let dedentScannedThrough = 0;

	for (let index = 0; index < lines.length; index += 1) {
		if (fences.inside[index] || code[index]) {
			out.push(lines[index]);
			continue;
		}
		const previous = out.length > 0 ? out[out.length - 1] : null;

		if (lines[index].trim() === "") {
			// A blank line always closes a blockquote; a list may survive it.
			quoteOpen = false;
			sawBlank = true;
			out.push(lines[index]);
			continue;
		}

		if (sawBlank) {
			if (
				listOpen &&
				markerKind(lines[index]) !== "list" &&
				indentWidth(lines[index]) < listColumn
			) {
				listOpen = false;
				listColumn = 0;
			}
			sawBlank = false;
		}

		if (
			!listOpen &&
			index >= dedentScannedThrough &&
			previous !== null &&
			previous.trim() !== "" &&
			// An indented previous line means this one is inside a code block
			// rather than under a paragraph, and dedenting would break the block.
			indentWidth(previous) <= 3
		) {
			dedentScannedThrough = dedentOverIndentedMarkerRun(lines, fences, code, index);
		}

		const width = indentWidth(lines[index]);
		// Four columns of indent opens an indented code block, not a list, so a
		// marker that deep must never gain a blank line in front of it.
		const kind = width <= 3 ? markerKind(lines[index]) : null;

		if (kind !== null && previous !== null && previous.trim() !== "") {
			const previousKind =
				indentWidth(previous) <= 3 ? markerKind(previous) : null;
			const continuesQuote = quoteOpen && kind === "quote";
			const continuesList =
				listOpen && (kind === "list" || width >= listColumn);
			if (previousKind === null && !continuesQuote && !continuesList) {
				out.push("");
			}
		}

		if (kind === "quote") {
			quoteOpen = true;
		}
		if (kind === "list") {
			const column = listContentColumn(lines[index]);
			listColumn = listOpen ? Math.min(listColumn, column) : column;
			listOpen = true;
		} else if (kind !== null && width < listColumn) {
			listOpen = false;
			listColumn = 0;
		}

		out.push(lines[index]);
	}

	return out.join("\n");
}

// ---------------------------------------------------------------------------
// Stream-head inline repair
// ---------------------------------------------------------------------------

type MarkerRun = { index: number; length: number };

function markerRuns(text: string, character: string): MarkerRun[] {
	const runs: MarkerRun[] = [];
	let index = 0;
	while (index < text.length) {
		if (text[index] !== character) {
			index += 1;
			continue;
		}
		let end = index;
		while (end < text.length && text[end] === character) end += 1;
		runs.push({ index, length: end - index });
		index = end;
	}
	return runs;
}

/**
 * Count emphasis runs that could actually open or close a span. A run of three
 * or more is a thematic break ("***") or combined emphasis, and a run flanked
 * by alphanumerics on both sides is arithmetic ("2**3") - neither is markup,
 * and counting them is what appended a stray "**" to balanced text.
 */
function countEmphasisRuns(text: string, character: string): number {
	let count = 0;
	for (const run of markerRuns(text, character)) {
		if (run.length !== 2) continue;
		const before = run.index > 0 ? text[run.index - 1] : "";
		const after =
			run.index + run.length < text.length ? text[run.index + run.length] : "";
		if (ALPHANUMERIC_PATTERN.test(before) && ALPHANUMERIC_PATTERN.test(after)) {
			continue;
		}
		count += 1;
	}
	return count;
}

/**
 * Length of a code-span run left open, or 0 when backticks pair up. Code spans
 * pair by run LENGTH, so "``a`b``" is balanced even though the total backtick
 * count is odd.
 */
function pendingBacktickRun(text: string): number {
	let pending = 0;
	for (const run of markerRuns(text, "`")) {
		if (pending === 0) pending = run.length;
		else if (run.length === pending) pending = 0;
	}
	return pending;
}

function scannableText(lines: string[], fences: FenceScan, code: boolean[]): string {
	const kept: string[] = [];
	for (let index = 0; index < lines.length; index += 1) {
		if (fences.inside[index] || fences.delimiter[index] || code[index]) continue;
		kept.push(lines[index]);
	}
	return kept.join("\n");
}

const TRAILING_RUN_PATTERN = /(\*+|~+|`+)[ \t]*$/;

/**
 * Close inline constructs that are still open at the end of a partial stream
 * so mid-stream renders don't show literal "**" or "`". Only call this while
 * streaming - a finished message's unbalanced markers are the model's own
 * text and should render as written.
 *
 * A marker sitting at the very END of the buffer is trimmed rather than
 * closed: the model has only started typing it, and appending to a buffer that
 * already ends in "**" yields "****", four literal asterisks - strictly worse
 * than the two it was meant to hide. A HALF-typed closer counts as the same
 * thing, so "the **Transfiguration*" is trimmed back rather than completed
 * into "***".
 *
 * Closers are appended to the last line of real prose, never to the end of the
 * buffer: with a fence still open the buffer ends inside code, and a "**" tacked
 * on after the synthesized closing fence renders as two literal asterisks below
 * the code block.
 */
export function closeOpenInlineMarkdown(text: string): string {
	const lines = text.split("\n");
	let fences = scanFences(lines);
	let code = scanIndentedCode(lines, fences);
	const last = lines.length - 1;
	const tailIsCode =
		lines.length > 0 &&
		(fences.inside[last] || fences.delimiter[last] || code[last]);

	if (!tailIsCode && lines.length > 0) {
		const trailing = TRAILING_RUN_PATTERN.exec(lines[last]);
		if (trailing !== null) {
			const body = scannableText(lines, fences, code);
			const run = trailing[1];
			const character = run[0];
			const unmatched =
				character === "`"
					? pendingBacktickRun(body) >= run.length
					: run.length <= 2 && countEmphasisRuns(body, character) % 2 === 1;
			if (unmatched) {
				lines[last] = lines[last].slice(0, trailing.index).replace(/[ \t]+$/, "");
				fences = scanFences(lines);
				code = scanIndentedCode(lines, fences);
			}
		}
	}

	const body = scannableText(lines, fences, code);
	let closers = "";
	const pending = pendingBacktickRun(body);
	if (pending > 0) closers += "`".repeat(pending);
	if (countEmphasisRuns(body, "*") % 2 === 1) closers += "**";
	if (countEmphasisRuns(body, "~") % 2 === 1) closers += "~~";

	if (closers !== "") {
		// The last line that is prose rather than code, and that has something to
		// close. A non-empty body guarantees one exists.
		let target = -1;
		for (let index = lines.length - 1; index >= 0; index -= 1) {
			if (fences.inside[index] || fences.delimiter[index] || code[index]) continue;
			if (lines[index].trim() === "") continue;
			target = index;
			break;
		}
		if (target >= 0) lines[target] += closers;
	}

	if (fences.openCharacter !== "") {
		// A fence opened inside a blockquote has to be closed inside it too, or
		// the synthesized delimiter lands outside the quote and closes nothing.
		lines.push(
			"> ".repeat(fences.openDepth) +
				fences.openCharacter.repeat(fences.openLength)
		);
	}

	return lines.join("\n");
}

/**
 * Full pipeline applied right before rendering an assistant message.
 */
export function normalizeAssistantMarkdown(
	text: string,
	options: { streaming: boolean }
): string {
	// Every stage below is line-based, and only repairMarkdownBlocks used to
	// normalize endings - so a lone CR (which JS's own /m anchors DO treat as a
	// line break) made the two earlier stages see the whole document as one
	// line: [FOLLOWUP] markers leaked into the body while the server still
	// extracted them as chips, and a <br>-terminated verse split into three
	// blockquotes. Doing it once here fixes both; repairMarkdownBlocks keeps its
	// own call because it is exported and called directly by the test vectors.
	let out = stripFollowUpMarkers(text.replace(/\r\n?/g, "\n"), options);
	out = normalizeInlineHtml(out);
	out = repairMarkdownBlocks(out);
	if (options.streaming) out = closeOpenInlineMarkdown(out);
	// Later stages can reintroduce the trailing whitespace stripFollowUpMarkers
	// already removed - an exotic bullet becoming "- " with nothing after it, a
	// trimmed stream-head marker leaving a blank last line. Trimming again is
	// what makes the pipeline a fixed point, which the stream-cut sweep asserts
	// at 200 positions per corpus entry.
	return out.trimEnd();
}

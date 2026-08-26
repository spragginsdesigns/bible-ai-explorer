// Generator for tests/fixtures/assistant-markdown-corpus.json - the single
// vector table shared by tests/assistant-markdown.test.mjs (web) and
// mobile/src/lib/assistantMarkdown.test.ts (Android).
//
// TO REGENERATE, from the repo root:
//
//   node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
//     tests/fixtures/gen-assistant-markdown-corpus.mjs
//
// It rewrites the JSON in place and then self-checks every vector against the
// REAL src/utils/assistantMarkdown.ts, printing SELF-CHECK CLEAN or the exact
// mismatches (which is why it needs --experimental-strip-types to import the
// .ts module). A non-clean run means the fixture and the module disagree: fix
// one of them and run it again.
//
// WHY A GENERATOR AND NOT A HAND-EDITED JSON FILE: the editing tooling on this
// machine silently rewrites U+2014 (em dash) and U+2013 (en dash) to ASCII
// hyphens, and a vector mangled that way passes for the wrong reason. This file
// is therefore ASCII-ONLY: every non-ASCII character is written as a \u escape
// and only ever reaches the fixture through node. Keep it that way - never
// paste a real em dash, bullet glyph or Greek letter in here.
//
// It is self-contained: no scratch dumps, no absolute paths. The production
// messages below were pulled once from the Neon production database (see
// _SOURCE/_PULLED) and are embedded verbatim.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const EM = "\u2014";
const ELLIPSIS = "\u2026";
const BULLET = "\u2022";
const WHITE_BULLET = "\u25E6";

// Resolved from this file, so the generator runs from any working directory.
const FIXTURE = fileURLToPath(new URL("./assistant-markdown-corpus.json", import.meta.url));
const MODULE_URL = new URL("../../src/utils/assistantMarkdown.ts", import.meta.url).href;

const screenshot =
	"## 2 Peter 1:19 in the NKJV\n\n" +
	'> "And so we have the prophetic word confirmed, which you do well to heed as a light that shines in a dark place, until the day dawns and the morning star rises in your hearts;"\n' +
	">\n" +
	"> " + EM + " **2 Peter 1:19, NKJV**\n\n" +
	"Peter has just described the **Transfiguration**.";

/** @type {{name:string, fn:string, input?:string, parts?:string[], streaming?:boolean, expected:string, why:string}[]} */
const vectors = [
	// ---- A1: container state, not one previous line ------------------------
	{
		name: "A1 screenshot message is untouched",
		fn: "repairMarkdownBlocks",
		input: screenshot,
		expected: screenshot,
		why: "the bare '>' spacer used to split one blockquote card into two",
	},
	{
		name: "A1 bare > spacer before an attribution",
		fn: "repairMarkdownBlocks",
		input: "> quote\n>\n> " + EM + " Ref",
		expected: "> quote\n>\n> " + EM + " Ref",
		why: "'>' with no trailing space is still a blockquote line",
	},
	{
		name: "A1 thematic break inside a blockquote",
		fn: "repairMarkdownBlocks",
		input: "> above\n>\n> ---\n>\n> below",
		expected: "> above\n>\n> ---\n>\n> below",
		why: "two bare '>' spacers used to produce three separate quotes",
	},
	{
		name: "A1 lazy continuation keeps one blockquote",
		fn: "repairMarkdownBlocks",
		input: "> Be still, and know\nthat I am God: I will be exalted\n> among the heathen.",
		expected: "> Be still, and know\nthat I am God: I will be exalted\n> among the heathen.",
		why: "the one-character pattern widening alone does NOT fix this case",
	},
	{
		name: "A1 nested blockquote",
		fn: "repairMarkdownBlocks",
		input: "> Outer\n>> Inner\n> Outer again",
		expected: "> Outer\n>> Inner\n> Outer again",
		why: "'>>' has no space after the first marker",
	},
	{
		name: "A1 quote without a space after > still gets its lead-in break",
		fn: "repairMarkdownBlocks",
		input: "He says:\n> Be still\n>and know\n> that I am God.",
		expected: "He says:\n\n> Be still\n>and know\n> that I am God.",
		why: "the repair must still fire against prose, but only once",
	},
	{
		name: "A1 >text with no space after prose",
		fn: "repairMarkdownBlocks",
		input:
			"Jesus' reference can be found in John 3:14:\n" +
			'>"And as Moses lifted up the serpent in the wilderness, even so must the Son of man be lifted up."',
		expected:
			"Jesus' reference can be found in John 3:14:\n\n" +
			'>"And as Moses lifted up the serpent in the wilderness, even so must the Son of man be lifted up."',
		why: "failure-to-repair direction of the same one-character gap",
	},
	{
		name: "A1 tight ordered list with a wrapped item stays tight",
		fn: "repairMarkdownBlocks",
		input: "1. First point\n   with a wrapped continuation\n2. Second point\n3. Third point",
		expected: "1. First point\n   with a wrapped continuation\n2. Second point\n3. Third point",
		why: "inserting here turns a tight list loose and doubles the item spacing",
	},
	{
		name: "A1 nested bullet after an item continuation",
		fn: "repairMarkdownBlocks",
		input: "- Point one:\n  Some explanation here\n  - sub point a\n  - sub point b",
		expected: "- Point one:\n  Some explanation here\n  - sub point a\n  - sub point b",
		why: "an open list container swallows its own continuation lines",
	},
	{
		name: "A1 prose after a blockquote is left alone",
		fn: "repairMarkdownBlocks",
		input: '> "For God so loved the world' + ELLIPSIS + '"\nThat promise is the ground of assurance.',
		expected: '> "For God so loved the world' + ELLIPSIS + '"\nThat promise is the ground of assurance.',
		why: "nothing to repair; the line is not a block start",
	},

	// ---- A1 negative controls: the repair must keep earning its keep -------
	{
		name: "A1 negative control: list jammed against prose",
		fn: "repairMarkdownBlocks",
		input: "Contextually, its force is:\n- Cease your striving.",
		expected: "Contextually, its force is:\n\n- Cease your striving.",
		why: "39 of 292 production rows need exactly this repair",
	},
	{
		name: "A1 negative control: heading jammed against prose",
		fn: "repairMarkdownBlocks",
		input: "Some intro.\n## A heading",
		expected: "Some intro.\n\n## A heading",
		why: "same repair, heading arm",
	},
	{
		name: "A1 negative control: blockquote jammed against prose",
		fn: "repairMarkdownBlocks",
		input: "He says:\n> Be still, and know that I am God.",
		expected: "He says:\n\n> Be still, and know that I am God.",
		why: "same repair, quote arm",
	},
	{
		name: "A1 negative control: tight list is not loosened",
		fn: "repairMarkdownBlocks",
		input: "- one\n- two\n- three",
		expected: "- one\n- two\n- three",
		why: "consecutive markers never separate",
	},

	// ---- A2: never promote an indented list into a code block --------------
	{
		name: "A2 four-space list is dedented, not code-boxed",
		fn: "repairMarkdownBlocks",
		input: "Key points:\n    - First\n    - Second",
		expected: "Key points:\n\n- First\n- Second",
		why: "a blank line plus 4-space indent is the indented-code trigger",
	},
	{
		name: "A2 tab-indented list is re-indented to two spaces",
		fn: "repairMarkdownBlocks",
		input: "Intro:\n\t- tabbed item\n\t- another",
		expected: "Intro:\n\n  - tabbed item\n  - another",
		why: "a tab is four columns, which is also the code trigger",
	},
	{
		name: "A2 negative control: a real indented code sample stays code",
		fn: "repairMarkdownBlocks",
		input: "Example output:\n\n    print(x)\n    > 42\n    done",
		expected: "Example output:\n\n    print(x)\n    > 42\n    done",
		why: "the run contains non-marker lines, so it is code, not a mangled list",
	},
	{
		name: "A2 negative control: nested content under an open list is not dedented",
		fn: "repairMarkdownBlocks",
		input: "- outer item\n  continuation text\n    - nested at four",
		expected: "- outer item\n  continuation text\n    - nested at four",
		why: "a list container is open, so the indent is meaningful",
	},

	// ---- A3: [FOLLOWUP] stripping is line-anchored and fence-aware ---------
	{
		name: "A3 mid-line [FOLLOWUP] in prose is left intact",
		fn: "stripFollowUpMarkers",
		streaming: false,
		input:
			"The server marks suggestions with [FOLLOWUP] at the start of a line, then the question follows.\n\nThat is the convention.",
		expected:
			"The server marks suggestions with [FOLLOWUP] at the start of a line, then the question follows.\n\nThat is the convention.",
		why: "the unanchored pattern ate the rest of the sentence",
	},
	{
		name: "A3 [FOLLOWUP] inside a code fence is left intact",
		fn: "stripFollowUpMarkers",
		streaming: false,
		input: '```\nconst MARK = "[FOLLOWUP] question";\n```',
		expected: '```\nconst MARK = "[FOLLOWUP] question";\n```',
		why: "stripping there left an unterminated string literal",
	},
	{
		name: "A3 a bracket opening a link mid-sentence survives streaming",
		fn: "stripFollowUpMarkers",
		streaming: true,
		input: "See the passage in [",
		expected: "See the passage in [",
		why: "the partial-marker pattern must be line-anchored too",
	},
	{
		name: "A3 a footnote bracket survives streaming",
		fn: "stripFollowUpMarkers",
		streaming: true,
		input: "Disputed.[^",
		expected: "Disputed.[^",
		why: "not a marker prefix at all",
	},
	{
		name: "A3 real marker lines are still removed",
		fn: "stripFollowUpMarkers",
		streaming: false,
		input: "Answer.\n[FOLLOWUP] What else?\n[FOLLOWUP] More?",
		expected: "Answer.",
		why: "the shipped behaviour must not regress",
	},
	{
		name: "A3 a mid-answer marker line does not eat the next line",
		fn: "stripFollowUpMarkers",
		streaming: false,
		input: "Before.\n[FOLLOWUP] stray\nAfter.",
		expected: "Before.\nAfter.",
		why: "the shipped behaviour must not regress",
	},
	{
		name: "A3 removing a marker does not leave a doubled blank line",
		fn: "stripFollowUpMarkers",
		streaming: false,
		input: "Answer.\n\n[FOLLOWUP] x\n\nMore.",
		expected: "Answer.\n\nMore.",
		why: "collapse the blank run the removal creates",
	},
	{
		name: "A3 a half-typed marker is removed only while streaming",
		fn: "stripFollowUpMarkers",
		streaming: true,
		input: "Answer.\n[FOLLO",
		expected: "Answer.",
		why: "the shipped behaviour must not regress",
	},
	{
		name: "A3 a half-typed marker is kept on a settled message",
		fn: "stripFollowUpMarkers",
		streaming: false,
		input: "Answer.\n[FOLLO",
		expected: "Answer.\n[FOLLO",
		why: "a finished message is the model's own text",
	},
	{
		name: "A3 a lone bracket on its own line is removed while streaming",
		fn: "stripFollowUpMarkers",
		streaming: true,
		input: "Answer.\n[",
		expected: "Answer.",
		why: "the shipped behaviour must not regress",
	},
	{
		name: "D4 a bare marker line leaves its question in the body, never both",
		fn: "stripFollowUpMarkers",
		streaming: false,
		input: "Answer here.\n\n[FOLLOWUP]\nWhat is the day star?",
		expected: "Answer here.\n\nWhat is the day star?",
		why: "extraction is line-scoped too, so this is not extracted as a chip either",
	},

	// ---- A4: stream-head inline repair -------------------------------------
	{
		name: "A4 a thematic break is not an unclosed bold",
		fn: "closeOpenInlineMarkdown",
		input: "Some text\n***\nMore text",
		expected: "Some text\n***\nMore text",
		why: "runs of three or more asterisks are never an emphasis delimiter pair",
	},
	{
		name: "A4 a Python exponent is not an unclosed bold",
		fn: "closeOpenInlineMarkdown",
		input: "The value is 2**3 in Python.",
		expected: "The value is 2**3 in Python.",
		why: "a run flanked by alphanumerics on both sides is arithmetic",
	},
	{
		name: "A4 a marker at the very end is trimmed, not doubled",
		fn: "closeOpenInlineMarkdown",
		input: "Here is **",
		expected: "Here is",
		why: "appending here produced '****', four literal asterisks",
	},
	{
		name: "A4 code spans pair by run length",
		fn: "closeOpenInlineMarkdown",
		input: "Use ``a`b`` for that.",
		expected: "Use ``a`b`` for that.",
		why: "counting total backticks called this balanced text unbalanced",
	},
	{
		name: "A4 a tilde fence is closed with tildes",
		fn: "closeOpenInlineMarkdown",
		input: "~~~\ncode here",
		expected: "~~~\ncode here\n~~~",
		why: "the old code only knew about ``` and appended '~~'",
	},
	{
		name: "A4 a genuinely open bold is still closed",
		fn: "closeOpenInlineMarkdown",
		input: "It is a command to **stop striving",
		expected: "It is a command to **stop striving**",
		why: "the shipped behaviour must not regress",
	},
	{
		name: "A4 a backtick fence is still closed",
		fn: "closeOpenInlineMarkdown",
		input: "```\ncode still coming",
		expected: "```\ncode still coming\n```",
		why: "the shipped behaviour must not regress",
	},
	{
		name: "A4 an open code span is still closed",
		fn: "closeOpenInlineMarkdown",
		input: "He said `selah",
		expected: "He said `selah`",
		why: "the shipped behaviour must not regress",
	},
	{
		name: "A4 balanced text is untouched",
		fn: "closeOpenInlineMarkdown",
		input: "Already **closed** and `done`.",
		expected: "Already **closed** and `done`.",
		why: "the shipped behaviour must not regress",
	},

	// ---- A5: fence tracking and exotic bullets ------------------------------
	{
		name: "A5 a bullet glyph inside a fence is code, not a list",
		fn: "repairMarkdownBlocks",
		input: "```\n" + BULLET + " literal bullet in code\n```",
		expected: "```\n" + BULLET + " literal bullet in code\n```",
		why: "the substitution used to run as a whole-string pre-pass",
	},
	{
		name: "A5 a tilde fence protects its contents",
		fn: "repairMarkdownBlocks",
		input: "~~~\nplain text\n> not a quote\n~~~",
		expected: "~~~\nplain text\n> not a quote\n~~~",
		why: "fence tracking used to be ```-only",
	},
	{
		name: "A5 a longer fence contains a shorter one",
		fn: "repairMarkdownBlocks",
		input: "````\n```\nnested\n```\n````",
		expected: "````\n```\nnested\n```\n````",
		why: "a closing fence must match the opening character AND run length",
	},
	{
		name: "A5 a bullet glyph with no space becomes a list marker",
		fn: "repairMarkdownBlocks",
		input: BULLET + "Therefore, every human being born from Adam is born under the curse because of sin",
		expected: "- Therefore, every human being born from Adam is born under the curse because of sin",
		why: "the system prompt itself few-shots this shape at every model",
	},
	{
		name: "A5 a bullet glyph inside a blockquote becomes a list marker",
		fn: "repairMarkdownBlocks",
		input: "> " + BULLET + " first point\n> " + BULLET + " second point",
		expected: "> - first point\n> - second point",
		why: "the pattern must survive a blockquote prefix",
	},
	{
		name: "A5 a plain bullet glyph becomes a list marker",
		fn: "repairMarkdownBlocks",
		input: BULLET + " first point",
		expected: "- first point",
		why: "the shipped behaviour must not regress",
	},
	{
		name: "A5 an indented white bullet keeps its indent",
		fn: "repairMarkdownBlocks",
		input: "  " + WHITE_BULLET + " nested point",
		expected: "  - nested point",
		why: "the shipped behaviour must not regress",
	},
	{
		name: "A5 negative control: an em dash attribution is never a list item",
		fn: "repairMarkdownBlocks",
		input: EM + " Psalm 46:10, KJV",
		expected: EM + " Psalm 46:10, KJV",
		why: "converting these would turn every verse citation into a bullet",
	},
	{
		name: "A5 negative control: fenced markdown is byte-identical",
		fn: "repairMarkdownBlocks",
		input: "```\n- not a list\n## not a heading\n```",
		expected: "```\n- not a list\n## not a heading\n```",
		why: "the shipped behaviour must not regress",
	},

	// ---- A6: inline HTML ---------------------------------------------------
	{
		name: "A6 <br> becomes a markdown hard break",
		fn: "normalizeInlineHtml",
		input: "Line one<br>Line two<br/>Line three",
		expected: "Line one  \nLine two  \nLine three",
		why: "both renderers show the tag verbatim otherwise",
	},
	{
		name: "A6 inline tags are dropped and their text kept",
		fn: "normalizeInlineHtml",
		input: "Some <br> text and <sup>1</sup> and <div>block</div>",
		expected: "Some   \n text and 1 and block",
		why: "neither renderer interprets raw HTML",
	},
	{
		name: "A6 script and event-handler markup never passes through",
		fn: "normalizeInlineHtml",
		input: '<script>alert("x")</script> and <img src=x onerror=alert(1)> here',
		expected: " and  here",
		why: "rehype-raw would be an XSS hole for model output; this is the safe path",
	},
	{
		name: "A6 negative control: HTML inside a fence is untouched",
		fn: "normalizeInlineHtml",
		input: "```\n<br> stays\n```",
		expected: "```\n<br> stays\n```",
		why: "fenced content is a code sample",
	},
	{
		name: "A6 negative control: HTML inside a code span is untouched",
		fn: "normalizeInlineHtml",
		input: "Use `<div>` for blocks.",
		expected: "Use `<div>` for blocks.",
		why: "inline code is a code sample too",
	},
	{
		name: "A6 negative control: an autolink is not an HTML tag",
		fn: "normalizeInlineHtml",
		input: "<https://example.com>",
		expected: "<https://example.com>",
		why: "only known tag names are stripped",
	},

	// ---- A7: line endings and tabs -----------------------------------------
	{
		name: "A7 CRLF input yields uniform LF endings and one blockquote",
		fn: "repairMarkdownBlocks",
		input: "Intro line\r\n> quote\r\n>\r\n> " + EM + " Ps 23:1\r\n",
		expected: "Intro line\n\n> quote\n>\n> " + EM + " Ps 23:1\n",
		why: "the injected separator used to be a bare LF amid CRLF endings",
	},
	{
		name: "A7 tab-indented markers are normalized",
		fn: "repairMarkdownBlocks",
		input: "Points:\n\t- one\n\t- two",
		expected: "Points:\n\n  - one\n  - two",
		why: "tabs were never normalized at all",
	},

	// ---- A6 review round 2: <br> must not break out of its container --------
	{
		name: "A6 a trailing <br> never splits a blockquote",
		fn: "normalizeInlineHtml",
		input:
			"Here is the promise:\n" +
			"> For God so loved the world,<br>\n" +
			"> that he gave his only begotten Son.<br>\n" +
			"> - John 3:16",
		expected:
			"Here is the promise:\n" +
			"> For God so loved the world,\n" +
			"> that he gave his only begotten Son.\n" +
			"> - John 3:16",
		why: "the '  \\n' substitution opened a blank line, and a blank line ends a quote",
	},
	{
		name: "A6 a mid-line <br> inside a quote repeats the quote prefix",
		fn: "normalizeInlineHtml",
		input: "> For God<br>so loved the world,<br>that he gave his Son.",
		expected: "> For God  \n> so loved the world,  \n> that he gave his Son.",
		why: "a bare continuation line would be lazy at best and prose at worst",
	},
	{
		name: "A6 a mid-line <br> inside a list item keeps the content column",
		fn: "normalizeInlineHtml",
		input: "- first line<br>second line",
		expected: "- first line  \n  second line",
		why: "an unindented continuation closes the item",
	},
	{
		name: "A6 consecutive <br> never produce a blank line",
		fn: "normalizeInlineHtml",
		input: "> a<br><br>b",
		expected: "> a  \n> b",
		why: "the empty piece between them would be a whitespace-only line",
	},
	{
		name: "A6 a leading <br> does not open with a whitespace-only line",
		fn: "normalizeInlineHtml",
		input: "<br>text",
		expected: "text",
		why: "'  \\ntext' starts the paragraph with a stray hard break",
	},
	{
		name: "A6 negative control: a double-backtick code span is protected",
		fn: "normalizeInlineHtml",
		input: "Use ``a<div>b<br>c`` verbatim.",
		expected: "Use ``a<div>b<br>c`` verbatim.",
		why: "code spans pair by run length, and the splitter only knew single backticks",
	},
	{
		name: "A6 negative control: prose in angle brackets is not a tag",
		fn: "normalizeInlineHtml",
		input: "The set <b and c> is prose, and <i or j> too.",
		expected: "The set <b and c> is prose, and <i or j> too.",
		why: "a tag name must be followed by '>', '/' or a real attribute",
	},
	{
		name: "A6 a tag carrying attributes is still stripped",
		fn: "normalizeInlineHtml",
		input: '<span class="verse" data-id=3>text</span>',
		expected: "text",
		why: "attribute-bearing tags are the common case and must not survive",
	},
	{
		name: "A6 pipeline keeps a <br>-terminated verse as one blockquote",
		fn: "normalizeAssistantMarkdown",
		streaming: false,
		input:
			"Here is the promise:\n" +
			"> For God so loved the world,<br>\n" +
			"> that he gave his only begotten Son.<br>\n" +
			"> " + EM + " John 3:16",
		expected:
			"Here is the promise:\n\n" +
			"> For God so loved the world,\n" +
			"> that he gave his only begotten Son.\n" +
			"> " + EM + " John 3:16",
		why: "end-to-end proof: markdown-it emits one blockquote_open for this",
	},

	// ---- A2 review round 2: indented code is never dedented -----------------
	{
		name: "A2 negative control: a marker part way down indented code is left alone",
		fn: "repairMarkdownBlocks",
		input: "Example output:\n\n    print(x)\n    > 42\n",
		expected: "Example output:\n\n    print(x)\n    > 42\n",
		why: "the run began mid-code-block, so its previous line was non-blank prose only by accident",
	},
	{
		name: "A2 negative control: a marker-only run inside indented code stays code",
		fn: "repairMarkdownBlocks",
		input: "Example output:\n\n    print(x)\n    - a\n    - b\n",
		expected: "Example output:\n\n    print(x)\n    - a\n    - b\n",
		why: "same shape, with the whole run made of markers",
	},

	// ---- A4 review round 2: closer placement and half-typed closers ---------
	{
		name: "A4 an inline closer lands before the synthesized fence, never after it",
		fn: "closeOpenInlineMarkdown",
		input: "Consider **this carefully.\n\n```js\nconst x = 1;",
		expected: "Consider **this carefully.**\n\n```js\nconst x = 1;\n```",
		why: "appending at the end of the buffer put '**' below the closing fence",
	},
	{
		name: "A4 a half-typed closer is trimmed rather than turned into ***",
		fn: "closeOpenInlineMarkdown",
		input: "Peter has just described the **Transfiguration*",
		expected: "Peter has just described the **Transfiguration**",
		why: "a trailing run shorter than the opener is an incomplete closer, not markup",
	},
	{
		name: "A4 a half-typed tilde closer is trimmed too",
		fn: "closeOpenInlineMarkdown",
		input: "That reading is ~~struck~",
		expected: "That reading is ~~struck~~",
		why: "same rule on the strikethrough arm",
	},

	// ---- full pipeline ------------------------------------------------------
	{
		name: "pipeline strips, repairs and closes while streaming",
		fn: "normalizeAssistantMarkdown",
		streaming: true,
		input: "Intro:\n" + BULLET + " **Cease your striving.\n[FOLLOWUP] Next?",
		expected: "Intro:\n\n- **Cease your striving.**",
		why: "the shipped behaviour must not regress",
	},
	{
		name: "pipeline leaves a settled message's open markers as written",
		fn: "normalizeAssistantMarkdown",
		streaming: false,
		input: "It is a command to **stop striving",
		expected: "It is a command to **stop striving",
		why: "the shipped behaviour must not regress",
	},
	{
		name: "pipeline keeps the screenshot message as one blockquote",
		fn: "normalizeAssistantMarkdown",
		streaming: false,
		input: screenshot,
		expected: screenshot,
		why: "end-to-end proof of the reported bug",
	},

	// ---- B1: a <br> in a GFM table row is a space, never a hard break -------
	// A table row is one line by definition, so a hard break splits it and the
	// renderer invents a phantom row with the wrong column count. A table cell is
	// also the ONE place markdown has no line break of its own, so models emit
	// <br> there routinely.
	{
		name: "B1 a <br> inside a table row becomes a space",
		fn: "normalizeInlineHtml",
		input: "| Verse | Note |\n| --- | --- |\n| Jn 1:1 | In the beginning<br>was the Word |\n| Jn 1:2 | Same |",
		expected: "| Verse | Note |\n| --- | --- |\n| Jn 1:1 | In the beginning was the Word |\n| Jn 1:2 | Same |",
		why: "markdown-it counted tr_open 3 -> 4 and td_open 4 -> 6 on the hard-break form",
	},
	{
		name: "B1 the same table survives the whole pipeline",
		fn: "normalizeAssistantMarkdown",
		streaming: false,
		input: "| Verse | Note |\n| --- | --- |\n| Jn 1:1 | In the beginning<br>was the Word |\n| Jn 1:2 | Same |",
		expected: "| Verse | Note |\n| --- | --- |\n| Jn 1:1 | In the beginning was the Word |\n| Jn 1:2 | Same |",
		why: "end-to-end proof; remark tableRow stays 3",
	},
	{
		name: "B1 consecutive <br> in a cell collapse to a single space",
		fn: "normalizeInlineHtml",
		input: "| a | b<br><br>c |",
		expected: "| a | b c |",
		why: "growing the cell's whitespace on every pass would break the pipeline's fixed point",
	},
	{
		name: "B1 a <br> already followed by a space adds no second space",
		fn: "normalizeInlineHtml",
		input: "| a | b<br> c |",
		expected: "| a | b c |",
		why: "same fixed-point rule from the other side",
	},
	{
		name: "B1 negative control: a <br> outside a table is still a hard break",
		fn: "normalizeInlineHtml",
		input: "Not a table<br>at all",
		expected: "Not a table  \nat all",
		why: "the table arm must not swallow the ordinary case",
	},

	// ---- B2: fences inside blockquotes and nested lists ---------------------
	// A fence's indent is capped at 3 columns RELATIVE to its container, so the
	// absolute indent grows with every list level, and a fence inside a quote
	// carries "> " markers. Missing either shape let every later stage rewrite
	// real code-block contents.
	{
		name: "B2 a fence inside a blockquote protects its HTML",
		fn: "normalizeAssistantMarkdown",
		streaming: false,
		input: "> ```\n> <br>\n> ```",
		expected: "> ```\n> <br>\n> ```",
		why: "the code value went from \"<br>\" to \"\" - the line was deleted",
	},
	{
		name: "B2 a fence inside a blockquote protects a bullet glyph",
		fn: "repairMarkdownBlocks",
		input: "> ```\n> " + BULLET + " item\n> ```",
		expected: "> ```\n> " + BULLET + " item\n> ```",
		why: "the exotic-bullet pass rewrote code content to \"- item\"",
	},
	{
		name: "B2 an open quoted fence is closed inside the quote",
		fn: "normalizeAssistantMarkdown",
		streaming: true,
		input: "> ```\n> code",
		expected: "> ```\n> code\n> ```",
		why: "untracked, the run read as an unclosed code SPAN and three backticks were appended to the code body",
	},
	{
		name: "B2 a fence four columns in under a nested list protects its HTML",
		fn: "normalizeAssistantMarkdown",
		streaming: false,
		input: "- a\n  - b:\n    ```\n    <br>\n    ```",
		expected: "- a\n  - b:\n    ```\n    <br>\n    ```",
		why: "3 columns is the cap relative to the container, not to column zero",
	},
	{
		name: "B2 a fence four columns in protects a [FOLLOWUP] sample",
		fn: "normalizeAssistantMarkdown",
		streaming: false,
		input: "- a\n  - b:\n    ```\n    [FOLLOWUP] x\n    ```",
		expected: "- a\n  - b:\n    ```\n    [FOLLOWUP] x\n    ```",
		why: "the marker line was stripped out of the code block entirely",
	},
	{
		name: "B2 a two-space fence under a list still protects its contents",
		fn: "normalizeAssistantMarkdown",
		streaming: false,
		input: "- item:\n  ```\n  <br>\n  ```",
		expected: "- item:\n  ```\n  <br>\n  ```",
		why: "the shallow forms already worked and must keep working",
	},
	{
		name: "B2 a three-space fence under an ordered list still protects its contents",
		fn: "normalizeAssistantMarkdown",
		streaming: false,
		input: "1. item:\n   ```\n   <br>\n   ```",
		expected: "1. item:\n   ```\n   <br>\n   ```",
		why: "same, on the ordered arm",
	},
	{
		name: "B2 a doubly quoted fence is tracked at its own depth",
		fn: "repairMarkdownBlocks",
		input: ">> ```\n>> " + BULLET + " x\n>> ```",
		expected: ">> ```\n>> " + BULLET + " x\n>> ```",
		why: "depth is counted, not just detected",
	},
	{
		name: "B2 negative control: a quoted fence does not swallow the prose after the quote",
		fn: "normalizeAssistantMarkdown",
		streaming: false,
		input: "> ```\n> code\n\nPlain prose:\n- a",
		expected: "> ```\n> code\n\nPlain prose:\n\n- a",
		why: "a blockquote ends at a blank line and takes its fence with it; otherwise one unclosed quoted fence freezes the whole rest of the document",
	},

	// ---- B3: line endings normalized once, at the top of the pipeline -------
	// JS's own /m anchors treat a lone CR as a line break, so the server kept
	// extracting markers the client no longer stripped: the same question showed
	// up as a chip AND as literal body text.
	{
		name: "B3 lone-CR marker lines are stripped like LF ones",
		fn: "normalizeAssistantMarkdown",
		streaming: false,
		input: "Answer.\r[FOLLOWUP] What else?\r[FOLLOWUP] More?",
		expected: "Answer.",
		why: "only repairMarkdownBlocks normalized endings, and it runs after the stripper",
	},
	{
		name: "B3 CRLF marker lines are still stripped",
		fn: "normalizeAssistantMarkdown",
		streaming: false,
		input: "Answer.\r\n[FOLLOWUP] What else?",
		expected: "Answer.",
		why: "CRLF happened to survive the newline split; the lone CR did not",
	},
	{
		name: "B3 a lone-CR blockquote with trailing <br> stays one quote",
		fn: "normalizeAssistantMarkdown",
		streaming: false,
		input:
			"Here is the promise:\r" +
			"> For God so loved the world,<br>\r" +
			"> that he gave his only begotten Son.<br>\r" +
			"> - John 3:16",
		expected:
			"Here is the promise:\n\n" +
			"> For God so loved the world,\n" +
			"> that he gave his only begotten Son.\n" +
			"> - John 3:16",
		why: "the original A1 regression, reintroduced through the CR path: 1 blockquote became 3",
	},
	{
		name: "B3 no carriage return survives the pipeline",
		fn: "normalizeAssistantMarkdown",
		streaming: false,
		input: "a\rb\r\nc",
		expected: "a\nb\nc",
		why: "one normalization at the top, so every stage sees the same lines",
	},

	// ---- B4: indented code blocks are protected everywhere ------------------
	// dedentOverIndentedMarkerRun already treated a blank-line-preceded indented
	// run as code that must not be touched; the other stages did not, and deleted
	// lines out of one.
	{
		name: "B4 a tab-indented code block is a no-op",
		fn: "normalizeAssistantMarkdown",
		streaming: false,
		input: "Out:\n\n\t> 42",
		expected: "Out:\n\n\t> 42",
		why: "normalizeMarkerIndent turned the code block into a blockquote (code_block 1 -> 0)",
	},
	{
		name: "B4 a tab-indented code block that looks like a list is a no-op",
		fn: "normalizeAssistantMarkdown",
		streaming: false,
		input: "Out:\n\n\t- a\n\tb",
		expected: "Out:\n\n\t- a\n\tb",
		why: "same bug on the list arm",
	},
	{
		name: "B4 negative control: the four-space form was already a no-op",
		fn: "normalizeAssistantMarkdown",
		streaming: false,
		input: "Out:\n\n    > 42",
		expected: "Out:\n\n    > 42",
		why: "the two indent forms must agree",
	},
	{
		name: "B4 HTML inside an indented code block is kept",
		fn: "normalizeAssistantMarkdown",
		streaming: false,
		input: "x:\n\n    <br>\n    <b>y</b>",
		expected: "x:\n\n    <br>\n    <b>y</b>",
		why: "the code block lost its first line and gained a stray blank one",
	},
	{
		name: "B4 a [FOLLOWUP] sample inside an indented code block is kept",
		fn: "normalizeAssistantMarkdown",
		streaming: false,
		input: "x:\n\n    [FOLLOWUP] sample\n    more",
		expected: "x:\n\n    [FOLLOWUP] sample\n    more",
		why: "the marker line was deleted out of the code sample",
	},
	{
		name: "B4 a bullet glyph inside an indented code block is kept",
		fn: "normalizeAssistantMarkdown",
		streaming: false,
		input: "x:\n\n    " + BULLET + " literal\n    more",
		expected: "x:\n\n    " + BULLET + " literal\n    more",
		why: "the exotic-bullet pass rewrote code content",
	},
	{
		name: "B4 negative control: a bullet nested under an open list is still repaired",
		fn: "repairMarkdownBlocks",
		input: "- a\n\n    " + BULLET + " sub",
		expected: "- a\n\n    - sub",
		why: "the code threshold is four columns past the container, not four absolute, or every nested bullet would freeze",
	},
];

const partVectors = [
	{
		name: "tool-call-split parts are separated by a blank line",
		parts: ["...in that setting He says:", "- **Cease your striving.**"],
		expected: "...in that setting He says:\n\n- **Cease your striving.**",
	},
	{ name: "a single part is returned as-is", parts: ["only one part"], expected: "only one part" },
	{ name: "no parts yield an empty string", parts: [], expected: "" },
	{
		name: "an empty leading part does not fabricate a blank line",
		parts: ["", "Here are the passages."],
		expected: "Here are the passages.",
		why: "providers routinely emit a zero-length text item before the real answer",
	},
];

// Real assistant messages, pulled once from production and embedded here so
// this generator has no external inputs. Every non-ASCII character is a \u
// escape - see the header. Do not hand-edit: re-pull if the corpus needs to
// grow, and paste the escaped form back in.
const _SOURCE = "Neon project versemind / db neondb (production, verified 42 users / 196 conversations / 615 messages)";
const _PULLED = "2026-08-26";
const messages = [
	{
		"id": "msg-W0WwTLH06jO95Pm9j8g3QGlT",
		"quirks": [
			"bare_gt_spacer",
			"dash_attribution_inside_quote",
			"two_space_hard_break",
			"greek_unicode",
			"smart_quotes"
		],
		"partial": false,
		"content": "## 2 Peter 1:19 in the NKJV\n\n> \u201cAnd so we have the prophetic word confirmed, which you do well to heed as a light that shines in a dark place, until the day dawns and the morning star rises in your hearts;\u201d\n>\n> - **2 Peter 1:19, NKJV**\n\nPeter has just described the **Transfiguration**. He personally saw Christ\u2019s glory and heard the Father declare that Jesus is His beloved Son (2 Peter 1:16-18; Matthew 17:1-5). He then explains how that eyewitness event relates to the written prophetic Word.\n\n## The KJV wording\n\nThe KJV renders the main phrases as:\n\n- \u201ca more sure word of prophecy\u201d\n- \u201ctake heed\u201d\n- \u201ca light that shineth in a dark place\u201d\n- \u201cuntil the day dawn\u201d\n- \u201cthe day star arise in your hearts\u201d\n\nThe main difference is in the opening:\n\n- **KJV:** \u201ca more sure word of prophecy\u201d\n- **NKJV:** \u201cthe prophetic word confirmed\u201d\n\nThese are not based on different Greek texts. They are two ways of expressing the same Greek construction.\n\n## What the original Greek says\n\nThe opening Greek is:\n\n**\u03ba\u03b1\u1f76 \u1f14\u03c7\u03bf\u03bc\u03b5\u03bd \u03b2\u03b5\u03b2\u03b1\u03b9\u03cc\u03c4\u03b5\u03c1\u03bf\u03bd \u03c4\u1f78\u03bd \u03c0\u03c1\u03bf\u03c6\u03b7\u03c4\u03b9\u03ba\u1f78\u03bd \u03bb\u03cc\u03b3\u03bf\u03bd**  \n*Kai echomen bebaioteron ton proph\u0113tikon logon*\n\nA close, wooden rendering would be:\n\n**\u201cAnd we have the prophetic word more firm-or more fully confirmed.\u201d**\n\nImportant words include:\n\n- **bebaioteron** - \u201cmore firm,\u201d \u201cmore certain,\u201d \u201cmore established.\u201d It comes from *bebaios*, meaning stable, steadfast, or sure.\n- **proph\u0113tikon logon** - \u201cthe prophetic word,\u201d referring especially to the Scriptures that foretold Christ, His glory, and His coming.\n- **prosechontes** - \u201cpaying attention,\u201d \u201cgiving heed,\u201d or \u201cholding one\u2019s mind toward something.\u201d\n- **lychn\u014d** - a lamp or light.\n- **auchm\u0113r\u014d top\u014d** - an obscure, gloomy, dirty, or dark place.\n- **ph\u014dsphoros** - literally \u201clight-bearer,\u201d referring to the morning star that announces the dawn.\n\nTherefore, a close explanatory rendering is:\n\n*\u201cWe possess the prophetic word as something firmly confirmed, and you are right to keep paying close attention to it, like a lamp shining in a gloomy place, until daylight comes and the morning star rises in your hearts.\u201d*\n\n## Is Scripture \u201cmore sure\u201d than Peter\u2019s eyewitness experience?\n\nThe KJV can sound as though Peter is saying that Scripture is **more reliable than hearing God\u2019s voice at the Transfiguration**. That is a possible emphasis: written Scripture is an objective, enduring testimony available to the whole Church, whereas Peter\u2019s experience belonged personally to Peter, James, and John.\n\nThe NKJV emphasizes another side of the same Greek: the Transfiguration **confirmed** what the prophets had already written concerning the Messiah\u2019s glory and coming.\n\nThe two ideas fit together:\n\n1. The prophets foretold Christ\u2019s glory.\n2. Peter saw that glory at the Transfiguration.\n3. His eyewitness testimony and the prophetic Scriptures agree.\n4. Therefore, believers should confidently heed the written Word.\n\nPeter is not suggesting that prophecy was previously doubtful. The following verses explain that Scripture is certain because its ultimate source is the Holy Spirit:\n\n> \u201cknowing this first, that no prophecy of Scripture is of any private interpretation, for prophecy never came by the will of man, but holy men of God spoke as they were moved by the Holy Spirit.\u201d\n>\n> - **2 Peter 1:20-21, NKJV**\n\n## \u201cA light that shines in a dark place\u201d\n\nThe \u201cdark place\u201d is this present world under sin, deception, suffering, and spiritual blindness. Scripture functions like a lamp, showing us what is true and where we should walk:\n\n> \u201cYour word is a lamp to my feet And a light to my path.\u201d\n>\n> - **Psalm 119:105, NKJV**\n\nThis means we should not build our faith mainly upon feelings, impressions, traditions, or even extraordinary experiences. Experiences must be judged by the written Word. Scripture gives reliable light while the surrounding world remains spiritually dark.\n\n## \u201cUntil the day dawns\u201d\n\n\u201cThe day\u201d most naturally points to the full revelation of Christ at His return. Peter\u2019s subject in verse 16 is \u201cthe power and coming of our Lord Jesus Christ.\u201d\n\nScripture is like a lamp during the night. Christ\u2019s return will be like sunrise: everything that is presently believed by faith will be openly revealed. Peter is not saying Scripture will become false or unimportant. Rather, the lamp\u2019s promise will reach its fulfillment when Christ appears.\n\n## \u201cThe morning star rises in your hearts\u201d\n\nThe \u201cmorning star,\u201d called the \u201cday star\u201d in the KJV, points to Jesus Christ. Jesus identifies Himself this way:\n\n> \u201cI, Jesus, have sent My angel to testify to you these things in the churches. I am the Root and the Offspring of David, the Bright and Morning Star.\u201d\n>\n> - **Revelation 22:16, NKJV**\n\nThe morning star appears before sunrise and announces that daylight is coming. Christ is therefore both:\n\n- the One promised by the prophetic Scriptures, and\n- the One whose return will bring the full light of God\u2019s kingdom.\n\n\u201cIn your hearts\u201d includes the inward certainty, understanding, and hope produced as believers receive the truth about Christ. It ultimately looks toward the day when Christ\u2019s glory is fully revealed and everything presently hoped for becomes openly known.\n\n## The verse in plain language\n\nPeter is saying:\n\n**\u201cWe possess God\u2019s firmly established prophetic Word, confirmed by the revelation of Jesus Christ. Keep paying close attention to Scripture, because it provides dependable light in this spiritually dark world. Continue walking by that light as you wait for Jesus-the Morning Star-to return and bring the full light of day.\u201d**\n\nThe practical lesson is especially important: **do not allow experiences, feelings, or popular opinions to become more authoritative than Scripture.** God\u2019s written Word reliably points us to Christ and guides us until He returns."
	},
	{
		"id": "msg-Oy3zRbYrYJ7Wmpq87ZOWgvPn",
		"quirks": [
			"bare_gt_spacer",
			"bold_reference_header_inside_quote"
		],
		"partial": false,
		"content": "When you feel weak, remember that God's strength is made perfect in your weakness. In times of struggle, you can rely on the power of Christ to rest upon you. The Bible assures us that when we are weak, He is strong. Here are a few verses to reinforce this truth:\n\n> **2 Corinthians 12:9**\n>\n> And he said unto me, My grace is sufficient for thee: for my strength is made perfect in weakness. Most gladly therefore will I rather glory in my infirmities, that the power of Christ may rest upon me.\n\nIn times of weakness, when you feel inadequate or vulnerable, trust in God's grace and His promise to strengthen you. By acknowledging your weakness and relying on His power and grace, you allow Christ's power to manifest in your life, sustaining you through challenging times.\n\nIs there a specific area in your life where you are currently feeling weak and in need of Christ's power to rest upon you?"
	},
	{
		"id": "msg-mU1wI5THVw3yMyAcBRaG6qZu",
		"quirks": [
			"bare_gt_spacer",
			"dash_attribution_inside_quote",
			"two_space_hard_break",
			"hebrew_unicode",
			"ordered_list",
			"consecutive_blockquotes"
		],
		"partial": false,
		"content": "## \u201cBe still\u201d means surrender your striving\n\nPsalm 46 describes extreme disorder: the earth moving, waters roaring, nations raging, and kingdoms being shaken. Yet God remains present, sovereign, and able to end wars. In that setting He says:\n\n> \u201cBe still, and know that I am God: I will be exalted among the heathen, I will be exalted in the earth.\u201d\n>\n> - **Psalm 46:10, KJV**\n\nThis is more than an invitation to sit quietly or feel peaceful. It is a command to **stop striving as though everything depends upon human strength and recognize that God remains God**. The basis for stillness is not that the trouble is small, but that God is greater:\n\n> \u201cGod is our refuge and strength, a very present help in trouble.\u201d\n>\n> - **Psalm 46:1, KJV**\n\n> \u201cThe LORD of hosts is with us; the God of Jacob is our refuge. Selah.\u201d\n>\n> - **Psalm 46:11, KJV**\n\n## The Hebrew behind \u201cbe still\u201d\n\nThe Hebrew expression is:\n\n**\u05d4\u05b7\u05e8\u05b0\u05e4\u05bc\u05d5\u05bc - *harp\u00fb***  \nRoot: **\u05e8\u05b8\u05e4\u05b8\u05d4 - *r\u00e2ph\u00e2h***  \nStrong\u2019s: **H7503**\n\nThe root means **to slacken, cease, let go, leave alone, become weak, or be still**. The form in Psalm 46:10 is a plural command. Contextually, its force is:\n\n- **Cease your striving.**\n- **Let go of your attempt to control everything.**\n- **Stop resisting and acknowledge God\u2019s sovereign rule.**\n\nThe next words are **\u05d5\u05bc\u05d3\u05b0\u05e2\u05d5\u05bc - *\u00fbde\u2018\u00fb***, from **\u05d9\u05b8\u05d3\u05b7\u05e2 (*y\u00e2da\u2018*)**, meaning \u201cand know.\u201d Therefore, biblical stillness is not an emptying of the mind. It is ceasing from self-reliance so that the heart deliberately recognizes the truth: **\u201cI am God.\u201d**\n\nIn the Hebrew Masoretic numbering, this wording appears as Psalm 46:11 because the psalm\u2019s heading is counted as a verse; it corresponds to Psalm 46:10 in the KJV.\n\n## What trusting God looks like\n\nTrusting God means resting the weight of your confidence upon His character rather than your own understanding:\n\n> \u201cTrust in the LORD with all thine heart; and lean not unto thine own understanding.\u201d\n>\n> - **Proverbs 3:5, KJV**\n\nIt also means waiting without allowing fear or frustration to rule you:\n\n> \u201cRest in the LORD, and wait patiently for him: fret not thyself because of him who prospereth in his way, because of the man who bringeth wicked devices to pass.\u201d\n>\n> - **Psalm 37:7, KJV**\n\n> \u201cIt is good that a man should both hope and quietly wait for the salvation of the LORD.\u201d\n>\n> - **Lamentations 3:26, KJV**\n\nBeing still is therefore **not passivity or neglecting responsibility**. It means refusing to panic, manipulate, or act from unbelief. You bring the matter to God, remember who He is, obey whatever He has clearly commanded, and entrust the outcome to Him.\n\nA practical way to live Psalm 46:10 is:\n\n1. **Stop** the anxious, frantic striving.\n2. **Remember** that God is present and sovereign.\n3. **Obey** the next thing Scripture clearly requires.\n4. **Entrust** what you cannot control to Him.\n5. **Wait** without fretting, knowing that God will ultimately be exalted."
	},
	{
		"id": "msg-dMtDnPghyPJZ9MjnCvPwOZpQ",
		"quirks": [
			"bare_gt_spacer",
			"em_dash_attribution_no_space",
			"ellipsis_char"
		],
		"partial": false,
		"content": "Jesus was born in **Bethlehem of Judea**, the city of David.\n\n> \u201cJoseph also went up from Galilee, out of the city of Nazareth, into Judea, to the city of David, which is called Bethlehem\u2026\u201d\n>\n> -Luke 2:4 NKJV\n\nThere Mary gave birth to Jesus and laid Him in a manger (Luke 2:6-7). This fulfilled the prophecy that the Messiah would come from Bethlehem (Micah 5:2)."
	},
	{
		"id": "msg-ggyKGkJXY2rqi7zkLjpWLgIC",
		"quirks": [
			"dash_attribution_inside_quote",
			"two_space_hard_break_inside_quote"
		],
		"partial": true,
		"content": "work of the Christ you say you trust.\n\n> \u201cExamine yourselves, whether ye be in the faith; prove your own selves. Know ye not your own selves, how that Jesus Christ is in you, except ye be reprobates?\u201d  \n> -2 Corinthians 13:5\n\nA helpful daily pattern is to ask:\n\n- **What am I trusting in?** Am I resting in Christ-His death and resurrection-for acceptance with God, or in my religious activity, perfo"
	},
	{
		"id": "msg-D5wRxyAr660kgcrw2KfHvW6k",
		"quirks": [
			"loose_list_with_indented_hard_break_continuation",
			"attribution_outside_blockquote"
		],
		"partial": true,
		"content": "ow that Jesus Christ is in you, except ye be reprobates?\u201d - **2 Corinthians 13:5**\n\nA practical daily examination might include questions like these:\n\n- **What am I trusting for acceptance with God?**  \n  Am I resting in Christ-His death and resurrection-or in my good behavior, religious activity, feelings, or past decision? The true believer\u2019s hope is Christ Himself.\n\n- **When I sin, do I excuse "
	},
	{
		"id": "msg-AZKJGlZ0fdvxUzys7mqlcXqf",
		"quirks": [
			"gt_without_trailing_space"
		],
		"partial": true,
		"content": "Jesus' reference to the serpent lifted up by Moses can be found in John 3:14: \n\n>\"And as Moses lifted up the serpent in the wilderness, even so must the Son of man be lifted up.\"\n\nIn Numbers 21, we read that the Lord sent fiery serpents among the people because they had spoken against Him and Moses. Many people were bitten and died. In response to the people's plea for help, God instructed Moses to \"Make thee a fiery"
	},
	{
		"id": "msg-BhVyGPisbzj9ZvKhIcCktpP1",
		"quirks": [
			"gt_without_trailing_space",
			"reference_inline_in_quote",
			"two_verses_one_quote"
		],
		"partial": true,
		"content": "xercising faith in His promise. Their survival following a snakebite therefore reflected their faith in God's command.\n\n> Numbers 21:8-9 KJV: \"And the LORD said unto Moses, Make thee a fiery serpent, and set it upon a pole: and it shall come to pass, that every one that is bitten, when he looketh upon it, shall live.\" \"And Moses made a serpent of brass, and put it upon a pole, and it came to pass, that if a serpent h"
	}
];

// Shapes that were BROKEN before the container-state rewrite. They carry no
// expected output on purpose: they exist to be swept at every stream-cut
// position, where the invariant is "no blockquote is ever split", not a literal.
const synthetic = [
	{
		"name": "bare_gt_spacer_splits_blockquote",
		"input": "## 2 Peter 1:19 in the NKJV\n\n> We also have the prophetic word confirmed,\n>\n> - 2 Peter 1:19, NKJV\n",
		"verdictBeforeTheFix": "BUG - blank line injected after the '>' spacer splits one blockquote into two"
	},
	{
		"name": "lazy_continuation_splits_blockquote",
		"input": "> The Lord is my shepherd;\nI shall not want.\n> He maketh me to lie down.\n",
		"verdictBeforeTheFix": "BUG - a lazy continuation line is treated as plain text, so the resumed quote is split off"
	},
	{
		"name": "tab_indented_bullet_becomes_code_block",
		"input": "Points:\n\t- one\n\t- two\n",
		"verdictBeforeTheFix": "BUG (makes it worse) - injecting the blank line turns a tab-indented bullet into an indented CODE BLOCK. Not observed in production (0 tab characters in 292 messages), so low priority."
	},
	{
		"name": "crlf_leaves_stray_cr",
		"input": "Intro line\r\n> quote\r\n>\r\n> - Ps 23:1\r\n",
		"verdictBeforeTheFix": "BUG (latent) - the injected separator is '\\n' while the surrounding line endings are '\\r\\n', producing mixed endings; the '>\\r' spacer still trips the split because trim() leaves '>'. Not observed in production (0 CRLF in 292 messages)."
	},
	{
		"name": "gfm_table_not_separated",
		"input": "Comparison:\n| A | B |\n| --- | --- |\n| 1 | 2 |\n",
		"verdictBeforeTheFix": "GAP - BLOCK_START_PATTERN has no '|' alternative, and a GFM table cannot interrupt a paragraph, so this renders as literal pipe text. Not observed in production (0 tables in 292 messages)."
	},
	{
		"name": "negative_control_quote_after_paragraph",
		"input": "Here is the verse:\n> John 3:16 KJV\n",
		"verdictBeforeTheFix": "CORRECT - this is the repair working as designed (39 of 292 production messages need it)"
	},
	{
		"name": "negative_control_tight_nested_list",
		"input": "- outer\n  - inner\n",
		"verdictBeforeTheFix": "CORRECT - unchanged"
	},
	{
		"name": "negative_control_ordered_list_in_quote",
		"input": "> 1. first\n> 2. second\n",
		"verdictBeforeTheFix": "CORRECT - unchanged"
	}
];

const out = {
	_source: _SOURCE,
	_pulled: _PULLED,
	_generatedBy:
		"tests/fixtures/gen-assistant-markdown-corpus.mjs, run under node - never hand-edit this JSON and never write it from a shell heredoc, because the editing tooling on this machine rewrites U+2014 to an ASCII hyphen",
	_warning:
		"messages[] came from an investigation dump that had ALREADY lost every U+2014/U+2013, so its attribution lines read '- 2 Peter 1:19' where production holds an em dash. vectors[] are authored in the generator with explicit \\u escapes and DO carry real em dashes.",
	_shape:
		"vectors[].fn names the exported function under test; streaming applies to stripFollowUpMarkers and normalizeAssistantMarkdown only. Both test suites loop over the same table so the web and Android copies cannot drift.",
	vectors,
	partVectors,
	messages,
	synthetic,
};

writeFileSync(FIXTURE, JSON.stringify(out, null, "\t") + "\n", "utf8");
console.log("vectors:", vectors.length, "partVectors:", partVectors.length, "messages:", messages.length, "synthetic:", synthetic.length);

// Self-check: run every vector through the real module right now.
const mod = await import(MODULE_URL);
let bad = 0;
for (const v of vectors) {
	const fn = mod[v.fn];
	const actual =
		v.fn === "stripFollowUpMarkers" || v.fn === "normalizeAssistantMarkdown"
			? fn(v.input, { streaming: v.streaming === true })
			: fn(v.input);
	if (actual !== v.expected) {
		bad += 1;
		console.log("MISMATCH:", v.name);
		console.log("  in      ", JSON.stringify(v.input));
		console.log("  expected", JSON.stringify(v.expected));
		console.log("  actual  ", JSON.stringify(actual));
	}
}
for (const v of partVectors) {
	const actual = mod.joinAssistantTextParts(v.parts);
	if (actual !== v.expected) {
		bad += 1;
		console.log("MISMATCH:", v.name, JSON.stringify(actual));
	}
}
console.log(bad === 0 ? "SELF-CHECK CLEAN" : bad + " MISMATCHES");
if (bad !== 0) process.exitCode = 1;

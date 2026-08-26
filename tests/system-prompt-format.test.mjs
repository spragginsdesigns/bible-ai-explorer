/* D2 + D3: the prompt's own formatting contract.
 *
 * The system prompt is what every provider imitates, so the shapes it uses
 * itself are as load-bearing as the rules it states. These assertions pin both:
 * the prompt no longer few-shots markdown that neither renderer can parse, and
 * it now says, in one block, what well-formed output looks like.
 *
 * Also guards the em-dash landmine: the blockquote example's reference line
 * must carry a real U+2014. Tooling on this machine silently rewrites it to a
 * hyphen, which turns the example into "> - Psalm 46:10", teaching every model
 * to open a bullet list inside a blockquote.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
	chatSystemPrompt,
	markdownOutputRules,
	noteAISystemPrompt,
	systemPrompt,
	verseInsightSystemPrompt,
} from "../src/utils/systemPrompt.ts";

const EM_DASH = "\u2014";
const EXOTIC_BULLETS = /[•●▪◦○‣]/;

test("D3a: the prompt no longer writes bullets the parsers cannot see", () => {
	assert.ok(!EXOTIC_BULLETS.test(systemPrompt), "a glyph bullet is not a list marker anywhere");
	for (const line of systemPrompt.split("\n")) {
		assert.ok(
			!/^[*+]/.test(line),
			`a line may not open with a bare asterisk (renders as emphasis or a list): ${line.slice(0, 48)}`
		);
	}
});

test("D3a: the doctrinal core is a well-formed ASCII list", () => {
	const bullets = systemPrompt.split("\n").filter((line) => line.startsWith("- "));
	assert.equal(bullets.length, 6, "the six Gospel points are the prompt's only list");
	for (const bullet of bullets) assert.ok(bullet.startsWith("- "), bullet.slice(0, 32));
});

test("D3b: the rules block ships inside the chat prompt", () => {
	const prompt = chatSystemPrompt("KJV");
	assert.ok(prompt.includes(markdownOutputRules), "chatSystemPrompt must carry the rules verbatim");
	assert.ok(
		prompt.trimEnd().endsWith(markdownOutputRules.trimEnd()),
		"the formatting contract is the last thing the model reads"
	);
});

test("D3b: the rules follow the user's translation setting", () => {
	const nkjv = chatSystemPrompt("NKJV");
	assert.ok(nkjv.includes(`${EM_DASH} Psalm 46:10, NKJV`), "the worked example must swap");
	assert.ok(!nkjv.includes("Psalm 46:10, KJV"));
	// The translation setting is a shipped feature: never hard-code KJV.
	assert.ok(chatSystemPrompt("KJV").includes(`${EM_DASH} Psalm 46:10, KJV`));
});

test("D3b: the blockquote example is itself a single well-formed blockquote", () => {
	const quoteLines = markdownOutputRules
		.split("\n")
		.filter((line) => line.startsWith(">"));
	assert.equal(quoteLines.length, 2, "one quotation line plus the reference line");
	for (const line of quoteLines) {
		assert.ok(line.startsWith("> "), `no bare '>' line: ${JSON.stringify(line)}`);
		assert.ok(line.trim() !== ">", "a bare marker line is the bug the rules forbid");
	}
	assert.ok(
		quoteLines[1].includes(EM_DASH),
		"the attribution must use an em dash - a hyphen makes it a bullet inside the quote"
	);
	assert.ok(!/^> [-*+] /.test(quoteLines[1]), "the reference line must not read as a list item");
});

test("D3b: the rules block practises what it preaches", () => {
	assert.ok(!EXOTIC_BULLETS.test(markdownOutputRules));
	assert.ok(!markdownOutputRules.includes("\t"), "no tabs - they are an indented-code trigger");
	assert.ok(!/\n{3,}/.test(markdownOutputRules), "exactly one blank line between blocks");
	assert.ok(!/<(br|sup|div|b|i)\b[^>]*>/.test(markdownOutputRules.replace(/no </g, "X ")));
});

test("D3b: the rules cover every construct the two renderers disagree on", () => {
	const rules = markdownOutputRules.toLowerCase();
	for (const required of [
		"blank line",
		"## ",
		'"- "',
		"blockquote",
		"html",
		"footnote",
		"task lists",
		"latex",
		"emoji",
		"table",
	]) {
		assert.ok(rules.includes(required.toLowerCase()), `the rules must mention ${required}`);
	}
});

test("D2: nothing may introduce or follow the [FOLLOWUP] lines", () => {
	assert.ok(systemPrompt.includes("[FOLLOWUP]"));
	assert.ok(
		systemPrompt.includes("no lead-in sentence"),
		"the dangling lead-in is what leaves 5.5% of answers ending on a colon"
	);
	assert.ok(systemPrompt.includes("no colon"));
	assert.ok(
		systemPrompt.includes("nothing whatsoever may follow the final one"),
		"markers must be last, or stripping them strands whatever came after"
	);
	assert.ok(
		systemPrompt.includes("the whole question is written on that same line"),
		"the question must live on the marker's own line (matches the server regex)"
	);
});

test("D3c: the notes AI prompt carries the same formatting contract", () => {
	// The notes panel renders through the identical markdown pipeline on both
	// clients (src/components/notes/NoteAIMessage.tsx,
	// mobile/src/features/notes/components/NoteAIMessage.tsx), so an answer
	// formatted the chat way and one formatted the notes way break identically.
	const prompt = noteAISystemPrompt("Grace", "Ephesians 2:8-9 keeps coming back.");
	assert.ok(prompt.includes(markdownOutputRules), "the rules must ship verbatim, not paraphrased");
	assert.ok(
		prompt.trimEnd().endsWith(markdownOutputRules.trimEnd()),
		"the formatting contract is the last thing the model reads"
	);
	// The note's own text must not be able to displace the contract.
	assert.ok(prompt.indexOf("Ephesians 2:8-9") < prompt.indexOf(markdownOutputRules));
	// An empty note still gets the rules.
	assert.ok(noteAISystemPrompt("Untitled", "").includes(markdownOutputRules));
});

test("the verse-insight prompt still forbids structure entirely", () => {
	// Tap-a-verse is two to four sentences in a sheet; the chat formatting
	// rules must not leak into it and start producing headings there.
	const insight = verseInsightSystemPrompt("KJV");
	assert.ok(!insight.includes(markdownOutputRules));
	assert.ok(insight.includes("No headings, lists, blockquotes"));
});

/* Group D server-side fixes, tested against the REAL shipped source.
 *
 * The API routes cannot be imported here (they pull in Prisma, the AI SDK and
 * "@/" path aliases), so instead of re-implementing them - which would let a
 * test pass while the route stays broken - each function under test is cut out
 * of the route file by name, run through Node's TypeScript stripper, and
 * instantiated with its dependencies injected. If a route is edited, this test
 * sees the edit.
 *
 * Covers:
 * - D1  assistant text parts are joined with a blank line, not glued with ""
 * - D4  the server's [FOLLOWUP] extraction is line-scoped, like the clients'
 * - D5  the resolved model id is persisted in Message.metadata
 * - the "free half" of the open question: an empty text part must not
 *   fabricate a paragraph break
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { joinAssistantTextParts, stripFollowUpMarkers } from "../src/utils/assistantMarkdown.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(join(repoRoot, relativePath), "utf8");

const askQuestionSource = read("src/app/api/ask-question/route.ts");
const noteAiSource = read("src/app/api/note-ai/route.ts");
const useChatSource = read("src/components/useChat.ts");
const chatViewSource = read("mobile/src/lib/chatView.ts");

function matchBraces(source, openIndex) {
	let depth = 0;
	for (let i = openIndex; i < source.length; i += 1) {
		if (source[i] === "{") depth += 1;
		else if (source[i] === "}") {
			depth -= 1;
			if (depth === 0) return i;
		}
	}
	return -1;
}

/**
 * Slice one top-level function declaration out of a TypeScript source file.
 * A brace run that is followed by another brace run is an object return-type
 * annotation, not the body (`function f(): { a: string } { … }`), so keep
 * walking until the run that ends the declaration.
 */
function functionSource(source, name) {
	const start = source.indexOf(`function ${name}(`);
	assert.notEqual(start, -1, `${name} is not declared as a function in the source under test`);
	let openIndex = source.indexOf("{", start);
	assert.notEqual(openIndex, -1, `${name} has no body`);
	for (;;) {
		const closeIndex = matchBraces(source, openIndex);
		assert.notEqual(closeIndex, -1, `Unbalanced braces while slicing ${name}`);
		const rest = source.slice(closeIndex + 1);
		const nextNonSpace = rest.search(/\S/);
		if (nextNonSpace === -1 || rest[nextNonSpace] !== "{") return source.slice(start, closeIndex + 1);
		openIndex = closeIndex + 1 + nextNonSpace;
	}
}

/**
 * Instantiate the sliced functions with their imports injected. `console` is a
 * parameter so the instrumentation's warnings can be captured instead of
 * printed.
 */
function loadFunctions(source, names, deps = {}) {
	const js = stripTypeScriptTypes(names.map((name) => functionSource(source, name)).join("\n\n"));
	const injected = {
		joinAssistantTextParts,
		stripFollowUpMarkers,
		console: { warn: () => {}, error: () => {} },
		...deps,
	};
	const keys = Object.keys(injected);
	const factory = new Function(...keys, `${js}\nreturn { ${names.join(", ")} };`);
	return factory(...keys.map((key) => injected[key]));
}

const askQuestion = loadFunctions(askQuestionSource, [
	"extractText",
	"extractAssistantText",
	"stripFollowUps",
]);
const noteAi = loadFunctions(noteAiSource, ["extractText", "extractAssistantText"]);
const webHistory = loadFunctions(useChatSource, ["isRecord", "dbMessageToUIMessage"]);
const mobileHistory = loadFunctions(chatViewSource, ["isRecord", "dbMessageToUIMessage"]);

const textPart = (text) => ({ type: "text", text });
const toolPart = () => ({
	type: "tool-searchScripture",
	toolCallId: "call-1",
	state: "output-available",
	input: {},
	output: { verses: [] },
});
const assistantMessage = (parts) => ({ id: "msg-1", role: "assistant", parts });

/** What the clients show: metadata.parts joined, then markers stripped. */
function clientRender(parts, { streaming = false } = {}) {
	const textParts = parts.filter((part) => part.type === "text").map((part) => part.text);
	return stripFollowUpMarkers(joinAssistantTextParts(textParts), { streaming });
}

// ---------------------------------------------------------------- D1

test("D1: assistant text parts split around a tool call are joined with a blank line", () => {
	const parts = [
		textPart("Let me pull up the exact text of the passages I'd build on."),
		toolPart(),
		textPart("Here are the passages I'd use, and how I'd frame them for a nine-year-old.\n\n**1. The ant**"),
	];
	const extracted = askQuestion.extractAssistantText(assistantMessage(parts));

	assert.equal(
		extracted,
		joinAssistantTextParts([parts[0].text, parts[2].text]),
		"the route must use joinAssistantTextParts over the text parts"
	);
	// The production symptom: 162 legacy rows carry the glued form.
	assert.ok(!extracted.includes("build on.Here are"), "parts must not be glued together");
	assert.ok(extracted.includes("build on.\n\nHere are"));
	// Negative control, from the route's own user-path extractor: this is what
	// the assistant path used to do, and what the vector must discriminate.
	assert.ok(askQuestion.extractText(assistantMessage(parts)).includes("build on.Here are"));
});

test("D1: a heading in the second text part survives with a blank line before it", () => {
	const parts = [
		textPart("Let me look that up."),
		toolPart(),
		textPart("## Psalm 46:10\n\n> Be still, and know that I am God."),
	];
	const extracted = askQuestion.extractAssistantText(assistantMessage(parts));

	assert.ok(!extracted.includes("that up.## Psalm"), "a glued heading can never be repaired later");
	const lines = extracted.split("\n");
	assert.equal(lines[0], "Let me look that up.");
	assert.equal(lines[1], "");
	assert.equal(lines[2], "## Psalm 46:10");
});

test("D1: persisted content is byte-identical to the clients' render of metadata.parts", () => {
	const parts = [
		textPart("Here is what Scripture says."),
		toolPart(),
		textPart("> Be still, and know that I am God.\n> - Psalm 46:10, KJV\n\nThat is the ground of it."),
	];
	const persisted = askQuestion.stripFollowUps(
		askQuestion.extractAssistantText(assistantMessage(parts))
	).cleanText;

	assert.equal(persisted, clientRender(parts));
});

test("D1 (open question, free half): an empty text part never fabricates a paragraph break", () => {
	// Measured live: gpt-5.4 returned [reasoning, message(len 0), message(3177)].
	const leadingEmpty = assistantMessage([textPart(""), textPart("The real answer.")]);
	assert.equal(askQuestion.extractAssistantText(leadingEmpty), "The real answer.");

	const middleEmpty = assistantMessage([
		textPart("First."),
		textPart("   "),
		textPart("Second."),
	]);
	assert.equal(askQuestion.extractAssistantText(middleEmpty), "First.\n\nSecond.");
});

test("D1: mid-paragraph splits are logged as shape only, never as content", () => {
	const warnings = [];
	const instrumented = loadFunctions(askQuestionSource, ["extractAssistantText"], {
		console: { warn: (message) => warnings.push(message) },
	});

	instrumented.extractAssistantText(
		assistantMessage([textPart("The covenant is"), textPart("unbreakable.")])
	);
	assert.equal(warnings.length, 1, "a mid-paragraph split must be visible in the logs");
	assert.ok(!warnings[0].includes("covenant"), "the log must never carry the answer text");

	warnings.length = 0;
	instrumented.extractAssistantText(
		assistantMessage([textPart("A finished sentence."), textPart("Another one.")])
	);
	assert.equal(warnings.length, 0, "a clean paragraph boundary is not worth logging");
});

test("D1: trailing whitespace is not a paragraph boundary", () => {
	const warnings = [];
	const instrumented = loadFunctions(askQuestionSource, ["extractAssistantText"], {
		console: { warn: (message) => warnings.push(message) },
	});

	// "means " ends in a space, which is the middle of a sentence. Counting \s
	// as a terminator made the instrumentation blind to the exact split it
	// exists to measure, so it could never have answered the open question.
	instrumented.extractAssistantText(
		assistantMessage([textPart("The word shalom means "), textPart("peace and completeness.")])
	);
	assert.equal(warnings.length, 1, "a part ending in a space split mid-paragraph");
	assert.ok(!warnings[0].includes("shalom"), "the log must never carry the answer text");

	// Same shape with a trailing newline instead of a space.
	warnings.length = 0;
	instrumented.extractAssistantText(
		assistantMessage([textPart("The word shalom means\n"), textPart("peace and completeness.")])
	);
	assert.equal(warnings.length, 1, "a part ending in a newline after a word is still mid-sentence");

	// A real boundary followed by whitespace is still a boundary.
	warnings.length = 0;
	instrumented.extractAssistantText(
		assistantMessage([textPart("A finished sentence.\n\n"), textPart("Another one.")])
	);
	assert.equal(warnings.length, 0, "a terminator plus trailing whitespace is a clean boundary");
});

test("D1: user extraction still concatenates - a user turn is always one part", () => {
	const userMessage = { id: "u1", role: "user", parts: [textPart("  What is grace?  ")] };
	assert.equal(askQuestion.extractText(userMessage), "What is grace?");
	assert.equal(noteAi.extractText(userMessage), "What is grace?");
	// Two parts would be joined with "" on the user path, on purpose.
	assert.equal(
		askQuestion.extractText({ id: "u2", role: "user", parts: [textPart("a"), textPart("b")] }),
		"ab"
	);
});

test("D1: the notes AI route joins assistant parts the same way", () => {
	const parts = [
		textPart("Let me save this for you."),
		toolPart(),
		textPart("Done - it's saved as a new note."),
	];
	const extracted = noteAi.extractAssistantText(assistantMessage(parts));
	assert.ok(!extracted.includes("for you.Done"), "the notes route had the identical glue bug");
	assert.equal(extracted, joinAssistantTextParts([parts[0].text, parts[2].text]));
});

// ---------------------------------------------------------------- D4

test("D4: a marker alone on its line never yields both a chip and body text", () => {
	const answer = "Answer here.\n\n[FOLLOWUP]\nWhat is the day star?";
	const { cleanText, followUps } = askQuestion.stripFollowUps(answer);
	const question = "What is the day star?";

	const extracted = followUps.includes(question);
	const stillInBody = cleanText.includes(question);
	assert.ok(!(extracted && stillInBody), "the question must never appear twice");
	// With the [ \t]* fix it is the "neither" branch: the marker line carried no
	// question, so nothing is promoted to a chip and the next line stays prose.
	assert.deepEqual(followUps, []);
	assert.ok(stillInBody);
});

test("D4: a well-formed marker line is both extracted and removed", () => {
	const { cleanText, followUps } = askQuestion.stripFollowUps(
		"Grace is unearned favour.\n[FOLLOWUP] What is mercy?\n[FOLLOWUP] How do the two differ?"
	);
	assert.deepEqual(followUps, ["What is mercy?", "How do the two differ?"]);
	assert.ok(!cleanText.includes("What is mercy?"));
	assert.equal(cleanText, "Grace is unearned favour.");
});

// The one literal all three copies must contain, character for character.
// ^ with /m anchors the marker to the head of a line, matching what the
// stripper in assistantMarkdown.ts removes; [ \t]* rather than \s* keeps the
// question on the marker's own line.
const LINE_SCOPED_EXTRACTION = "/^[ \\t]*\\[FOLLOWUP\\][ \\t]*([^\\r\\n]+)/gm";

const EXTRACTION_COPIES = [
	["src/app/api/ask-question/route.ts", () => askQuestionSource],
	["src/components/useChat.ts", () => useChatSource],
	["mobile/src/lib/chatView.ts", () => chatViewSource],
];

test("D4: all three copies of the extraction regex are the identical anchored literal", () => {
	for (const [path, get] of EXTRACTION_COPIES) {
		const source = get();
		assert.ok(
			source.includes(LINE_SCOPED_EXTRACTION),
			`${path} must extract with ${LINE_SCOPED_EXTRACTION} - an unanchored copy extracts a marker the stripper will never remove, and \\s* swallows the following line as the question`
		);
		// Neither older form may survive anywhere.
		assert.ok(!source.includes("/\\[FOLLOWUP\\]\\s*("), `${path} still carries the \\s* form`);
		assert.ok(
			!source.includes("/\\[FOLLOWUP\\][ \\t]*("),
			`${path} still carries the unanchored form`
		);
	}
});

test("D4: an indented or quoted marker is neither extracted nor removed - never both", () => {
	// Both of these look like markers but sit behind another block marker, so
	// the line-scoped stripper leaves them in the body. Extraction must agree:
	// the failure this pins is extracting a chip out of text that stays visible.
	for (const answer of [
		"Grace is unearned favour.\n\n- [FOLLOWUP] What does grace mean?",
		"Grace is unearned favour.\n\n> [FOLLOWUP] q",
	]) {
		const { cleanText, followUps } = askQuestion.stripFollowUps(answer);
		const question = answer.slice(answer.indexOf("[FOLLOWUP]") + "[FOLLOWUP] ".length);

		const extracted = followUps.includes(question);
		const stillInBody = cleanText.includes(question);
		assert.ok(
			!(extracted && stillInBody),
			`${JSON.stringify(answer)}: shown twice - once as a chip and once as body text`
		);
		// Concretely, this is the "neither" branch on both vectors.
		assert.deepEqual(followUps, [], JSON.stringify(answer));
		assert.ok(stillInBody, JSON.stringify(answer));
	}
});

test("D4: extraction and removal agree on every marker shape", () => {
	// A sweep rather than a single vector: for each shape, whatever the stripper
	// decides, the extractor must decide the same way.
	const shapes = [
		"[FOLLOWUP] Plain marker?",
		"  [FOLLOWUP] Indented with spaces?",
		"\t[FOLLOWUP] Indented with a tab?",
		"- [FOLLOWUP] Behind a bullet?",
		"> [FOLLOWUP] Behind a quote?",
		"Text before [FOLLOWUP] mid-line?",
		"1. [FOLLOWUP] Behind an ordered marker?",
	];
	for (const shape of shapes) {
		const answer = `The body of the answer.\n${shape}`;
		const { cleanText, followUps } = askQuestion.stripFollowUps(answer);
		const question = shape.slice(shape.indexOf("[FOLLOWUP]") + "[FOLLOWUP] ".length);
		const extracted = followUps.includes(question);
		const stillInBody = cleanText.includes(question);
		assert.ok(!(extracted && stillInBody), `${JSON.stringify(shape)}: extracted AND left in body`);
	}
});

// ---------------------------------------------------------------- D5

test("D5: the resolved model id is written into Message.metadata", () => {
	assert.ok(
		/if \(options\.modelId\) metadata\.modelId = options\.modelId;/.test(askQuestionSource),
		"persistAssistantResponse must record the model that wrote the turn"
	);
	assert.ok(
		/resolvedModelId = definition\.id;/.test(askQuestionSource),
		"the id must come from the resolved model, not the requested one"
	);
	assert.ok(
		/modelId: resolvedModelId,/.test(askQuestionSource),
		"onEnd must pass the resolved id to persistAssistantResponse"
	);
	// The metadata blob is round-tripped through JSON before the upsert.
	const metadata = { parts: [textPart("hi")], modelId: "openai/gpt-5.6-terra" };
	assert.equal(JSON.parse(JSON.stringify(metadata)).modelId, "openai/gpt-5.6-terra");
});

test("D5: both clients hydrate a row carrying an unknown metadata key", () => {
	const row = {
		id: "msg-1",
		role: "assistant",
		content: "Grace is unearned favour.",
		metadata: {
			parts: [textPart("Grace is unearned favour.")],
			followUps: ["What is mercy?"],
			modelId: "anthropic/claude-opus-5",
		},
	};

	for (const [label, client] of [["web", webHistory], ["mobile", mobileHistory]]) {
		const message = client.dbMessageToUIMessage(structuredClone(row));
		assert.equal(message.id, "msg-1", `${label} must hydrate the row`);
		assert.deepEqual(
			message.parts,
			[textPart("Grace is unearned favour.")],
			`${label} must build parts from metadata.parts only`
		);
		assert.equal(
			message.metadata.modelId,
			"anthropic/claude-opus-5",
			`${label} must carry an unknown metadata key through untouched`
		);
	}
});

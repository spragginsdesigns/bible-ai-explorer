import { normalizeAssistantMarkdown } from "../src/utils/assistantMarkdown.ts";
import { hasLiteralMarkdownUnderscore, analyzeMarkdownUnderscores, markdownRangeHasLiteralUnderscore } from "../src/lib/ai/markdown-underscore-guard.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { z } from "zod";
import {HISTORY_REVIEW_CONTEXT_CHARS, COMPLETE_VERIFICATION_REQUEST_CHARS} from '../src/lib/ai/verification-limits.mjs';
import {traceTurn, classifyTurnError} from '../src/lib/ai/turn-trace.ts';
const candidate = fileURLToPath(new URL("../", import.meta.url));
const root = existsSync(path.join(candidate, "src/data/books.json")) ? candidate : JSON.parse(readFileSync(path.join(candidate, "manifest.json"), "utf8")).applicationRoot;
const json = relative => JSON.parse(readFileSync(path.join(root, relative), "utf8"));
const books = json("src/data/books.json"); const names = json("src/data/book-names.json");
const localized = ["es", "de"].flatMap(language => [...names[language].names.map((name, index) => [name, index + 1]), ...Object.entries(names[language].aliases)]);
const cache = new Map();
async function getChapter(translation, order, chapter) {
	const key = translation + ":" + order;
	const filename = translation === "KJV" ? "src/data/kjv/" + books.find(book => book.order === order).file : "src/data/" + translation.toLowerCase() + "/" + String(order).padStart(2, "0") + ".json";
	if (!cache.has(key)) cache.set(key, json(filename));
	const verses = cache.get(key)[chapter - 1]; if (!verses) throw Error("Missing canonical chapter"); return verses;
}
function loadModule(relative, exports, injected) {
	const source = readFileSync(path.join(root, relative), "utf8").replace(/^import\s[^;]*?;\s*$/gm, "").replace(/^export /gm, "");
	return new Function(...Object.keys(injected), stripTypeScriptTypes(source) + "\nreturn {" + exports.join(",") + "};")(...Object.values(injected));
}
const bookApi = loadModule("src/lib/bible/books.ts", ["resolveReference", "LOCALIZED_BOOK_PATTERN"], { booksJson: books, bookNamesJson: names });
const { parseVerseReferences } = loadModule("src/utils/verseParser.ts", ["parseVerseReferences"], bookApi);
const { createMarkdownComponents } = await import(pathToFileURL(path.join(root, "src/components/markdownComponents.ts")).href);
const components = createMarkdownComponents({ VerseRef: ({ reference, children }) => React.createElement("span", { "data-verse": reference }, children), parseVerseReferences });
function render(text) { return renderToStaticMarkup(React.createElement(ReactMarkdown, { remarkPlugins: [remarkGfm], components }, text)); }
const visible = html => html.replace(/<[^>]*>/g, "").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&");
function compile(source) {
	const plain = source.replace(/^import\s[^;]*?;\s*$/gm, "").replace(/^export /gm, "");
	return new Function("normalizeAssistantMarkdown", "hasLiteralMarkdownUnderscore", "analyzeMarkdownUnderscores", "markdownRangeHasLiteralUnderscore", "BOOKS", "LOCALIZED_BOOK_NAMES", "getChapter", "isTranslationId", "getOriginalVerse", "getOriginalVerseForKjv", stripTypeScriptTypes(plain) + "\nreturn { verifyScriptureDraft, hasCompletenessClaim, quotationCandidates, associatedGroups };")(
		normalizeAssistantMarkdown, hasLiteralMarkdownUnderscore, analyzeMarkdownUnderscores, markdownRangeHasLiteralUnderscore, books, localized, getChapter, value => ["KJV", "RV1909", "LUT1912", "ASV", "BSB", "NKJV"].includes(value), async () => null, async () => null);
}
const relative = "src/lib/ai/scripture-verification.ts";
const sourceFile = existsSync(path.join(candidate, relative)) ? path.join(candidate, relative) : path.join(root, relative);
const api = compile(readFileSync(sourceFile, "utf8"));
const check = (text, translation = "KJV") => api.verifyScriptureDraft(text, { translation });
const verse = (await getChapter("KJV", 43, 3))[15];
const draft = word => 'John 3:16\n> ' + verse.replace("whosoever", word);
const literalWords = ["who_so_ever", "who__so__ever", "who_**so**_ever", "who_*so*_ever", "*who_so_ever*", "`who_so_ever`", "`_whosoever_`", "` _whosoever_ `", "_whosoever", "whosoever_", "who_so_ever__"];
const formattingWords = ["whosoever", "**whosoever**", "*whosoever*", "__whosoever__", "_whosoever_", "***whosoever***", "___whosoever___", "**_whosoever_**", "_**whosoever**_", "who**_so_**ever", "**who**_so_**ever**", "`whosoever`"];

const pairs = [["«", "»"], ["»", "«"], ["„", "“"], ["‚", "‘"]];
const rv = (await getChapter("RV1909", 43, 3))[15];
const lut = (await getChapter("LUT1912", 43, 3))[15];
const fragmentEs = "Porque de tal manera amó Dios al mundo";
const fragmentDe = "Also hat Gott die Welt geliebt";
const rendered = input => visible(render(input));
const mustPass = async (input, translation = "KJV") => { const result = await check(input, translation); assert.equal(result.ok, true, JSON.stringify(result)); return result; };
const mustFail = async (input, translation = "KJV") => { const result = await check(input, translation); assert.equal(result.ok, false, JSON.stringify(result)); assert.ok(result.issues.some(issue => issue.code === "quote_mismatch" || issue.code === "unattributed_quote")); return result; };

for (const [translation, input] of [
  ["RV1909", 'Mateo 5:48 usa "perfectos"; la palabra significa «completo».'],
  ["LUT1912", 'Matthäus 5:48 verwendet "vollkommen"; das Wort bedeutet „vollständig“.'],
]) test("localized lexical gloss is independent review, canonical source token remains verified: " + translation, async () => {
  const result = await mustPass(input, translation);
  assert.deepEqual(result.quotes.map(quote => quote.status), ["verified", "review"]);
  assert.deepEqual(result.quotes[1].references, []);
  assert.ok(result.issues.some(issue => issue.code === "ambiguous_quote" && issue.severity === "review"));
});

for (const [translation, cue, gloss] of [
  ["KJV", 'Matthew 5:48 uses "perfect"; the word means ', "complete"],
  ["RV1909", 'Mateo 5:48 usa "perfectos"; la palabra significa ', "completo"],
  ["LUT1912", 'Matthäus 5:48 verwendet "vollkommen"; das Wort bedeutet ', "vollständig"],
]) for (const [open, close] of pairs) test("all paired lexical glosses are surfaced for review: " + translation + open + close, async () => {
  const input = cue + open + gloss + close + ".";
  assert.ok(rendered(input).includes(open + gloss + close));
  const result = await mustPass(input, translation);
  assert.deepEqual(result.quotes.map(quote => quote.status), ["verified", "review"]);
});

for (const [translation, input] of [
  ["RV1909", 'Juan 3:16 significa «palabras inventadas».'],
  ["LUT1912", 'Johannes 3:16 bedeutet „erfundene Wörter“.'],
  ["KJV", 'John 3:16 means «invented Bible wording».'],
  ["RV1909", 'La palabra aparece en Juan 3:16 y dice «palabras inventadas».'],
  ["LUT1912", 'Das Wort steht in Johannes 3:16 und lautet „erfundene Wörter“.'],
]) test("definition exception requires explicit word definition immediately before this quote: " + input, async () => {
  const result = await mustFail(input, translation);
  assert.equal(result.quotes[0].status, "failed");
});

for (const [translation, book, source, fragment, claim] of [
  ["RV1909", "Juan", rv, fragmentEs, "completo dice"],
  ["LUT1912", "Johannes", lut, fragmentDe, "vollständig lautet"],
]) for (const [open, close] of pairs) {
  test("paired localized full quote enforces source words and source case: " + translation + open + close, async () => {
    const prefix = book + " 3:16 " + claim + " ";
    const full = await mustPass(prefix + open + source + close + ".", translation);
    assert.equal(full.quotes.length, 1); assert.equal(full.quotes[0].status, "verified");
    const partial = await mustFail(prefix + open + fragment + close + ".", translation);
    assert.equal(partial.quotes.length, 1);
    await mustFail(prefix + open + source.toLowerCase() + close + ".", translation);
    await mustFail(prefix + open + "fabricated words" + close + ".", translation);
  });
  test("paired localized extraction retains exact offsets and nearby reference association: " + translation + open + close, async () => {
    const input = "😀 " + book + " 3:16: " + open + fragment + close + ".";
    const result = await mustPass(input, translation);
    assert.equal(result.quotes[0].references[0], "John 3:16");
    const candidates = api.quotationCandidates(input, []);
    assert.equal(candidates.length, 1);
    assert.equal(input.slice(candidates[0].start, candidates[0].end), open + fragment + close);
    assert.equal(candidates[0].text, fragment);
    const trailing = await mustPass(open + fragment + close + " (" + book + " 3:16).", translation);
    assert.equal(trailing.quotes[0].references[0], "John 3:16");
    await mustFail(book + " 3:16; " + book + " 3:17: " + open + fragment + close + ".", translation);
    const block = await mustPass(book + " 3:16\n> " + open + source + close, translation);
    assert.equal(block.quotes.length, 1);
  });
}

test("localized title and user quotes retain independent review classification", async () => {
  for (const [open, close] of pairs) for (const input of ["The note " + open + "my_study" + close + " was saved.", "You wrote " + open + "my_file_name" + close + "."]) {
    const result = await mustPass(input); assert.equal(result.quotes[0].status, "review");
  }
});

for (const phrase of ["no está completo", "no es completo", "no se reproduce completamente", "no en su totalidad", "no palabra por palabra", "no de principio a fin"]) test("Spanish explicit partial disclaimer preserves an authentic fragment: " + phrase, async () => {
  const result = await mustPass('Juan 3:16 ' + phrase + ': "' + fragmentEs + '".', "RV1909");
  assert.equal(result.quotes[0].status, "verified");
});
for (const phrase of ["nicht vollständig", "nicht ganz vollständig", "nicht wörtlich", "nicht in voller Länge", "nicht Wort-für-Wort", "nicht komplett", "nicht vollstaendig", "sagt ganz klar", "sagt ganz deutlich", "ist komplett anders", "ist vollstaendig klar"]) test("German disclaimer/intensifier preserves an authentic fragment: " + phrase, async () => {
  const result = await mustPass('Johannes 3:16 ' + phrase + ': "' + fragmentDe + '".', "LUT1912");
  assert.equal(result.quotes[0].status, "verified");
});
for (const [translation, phrase, book, fragment, full] of [
  ["RV1909", "no solo completo dice", "Juan", fragmentEs, rv],
  ["RV1909", "no está completo, pero el texto completo dice", "Juan", fragmentEs, rv],
  ["RV1909", "dice de principio a fin", "Juan", fragmentEs, rv],
  ["LUT1912", "nicht nur vollständig lautet", "Johannes", fragmentDe, lut],
  ["LUT1912", "nicht vollständig, aber der ganze Vers lautet", "Johannes", fragmentDe, lut],
  ["LUT1912", "komplett lautet", "Johannes", fragmentDe, lut],
  ["LUT1912", "vollstaendig lautet", "Johannes", fragmentDe, lut],
  ["LUT1912", "Der komplette Vers lautet", "Johannes", fragmentDe, lut],
  ["LUT1912", "Der ganze Vers lautet", "Johannes", fragmentDe, lut],
]) test("positive full promise survives partial negation and precise common synonyms: " + phrase, async () => {
  const prefix = book + " 3:16 " + phrase + ' "';
  await mustFail(prefix + fragment + '".', translation);
  await mustPass(prefix + full + '".', translation);
});
test("a temporal de principio a fin does not promise the whole verse", async () => {
  await mustPass('Juan 3:16 me acompaña de principio a fin: "' + fragmentEs + '".', "RV1909");
});

const [first, rest] = ["For God so loved the world,", verse.slice("For God so loved the world,".length).trim()];
const paragraphCases = [
  ['John 3:16\n> _' + first + '\n>\n> ' + rest + '_', false],
  ['John 3:16 says “_' + first + '\n\n' + rest + '_”.', false],
  ['John 3:16\n> > _' + first + '\n> >\n> > ' + rest + '_', false],
  ['John 3:16\n> > _' + first + '\n> >   \n> > ' + rest + '_', false],
  ['John 3:16\n> _' + first + '\n> ' + rest + '_', true],
  ['John 3:16\n> > _' + first + '\n> > ' + rest + '_', true],
  ['John 3:16\n> _' + first + '_\n>\n> _' + rest + '_', true],
  ['John 3:16\n> > _' + first + '_\n> >\n> > _' + rest + '_', true],
  ['John 3:16 says “_' + first + '_\n\n_' + rest + '_”.', true],
];
for (const [input, canonical] of paragraphCases) test("actual Markdown paragraph/soft-wrap underscore fidelity: " + JSON.stringify(input), async () => {
  assert.equal(rendered(input).includes("_"), !canonical, render(input));
  if (canonical) await mustPass(input); else await mustFail(input);
});
for (const wrapper of [text => '>     ' + text, text => '> ~~~\n> ' + text + '\n> ~~~', text => '> ```\n> ' + text + '\n> ```']) {
  for (const word of ["_whosoever_", "who_so_ever", "__whosoever__"]) test("actual indented/fenced code preserves literal underscores: " + wrapper(word), async () => {
    const input = "John 3:16\n" + wrapper(verse.replace("whosoever", word));
    assert.ok(rendered(input).includes(word), render(input)); await mustFail(input);
  });
  test("canonical indented/fenced code without underscores remains valid: " + wrapper("canonical"), async () => {
    const input = "John 3:16\n" + wrapper(verse); assert.ok(rendered(input).includes(verse)); await mustPass(input);
  });
}
for (const word of ["_`whosoever`_", "__`whosoever`__", "_**`whosoever`**_"]) test("actual emphasis around an inline canonical code span is valid: " + word, async () => {
  const input = draft(word); assert.ok(rendered(input).includes(verse), render(input)); await mustPass(input);
});
for (const word of ["_`who_so_ever`_", "__`_whosoever_`__", "`who_so_ever`", "``_whosoever_``"]) test("inline code remains literal inside genuine outer emphasis: " + word, async () => {
  const input = draft(word); assert.ok(rendered(input).includes("_")); await mustFail(input);
});
test("long independent underscore runs fail closed without an unbounded formatting retry", async () => {
  const input = 'John 3:16 says “' + ('_ word '.repeat(4000)) + '”.';
  await mustFail(input);
});

for (const [translation, input] of [
  ["KJV", 'Matthew 5:48 uses "perfect"; the word means «full and entire».'],
  ["RV1909", 'Mateo 5:48 usa "perfectos"; la palabra significa «completo en su totalidad».'],
  ["LUT1912", 'Matthäus 5:48 verwendet "vollkommen"; das Wort bedeutet „vollständig im Wortlaut“.'],
]) test("a complete multiword dictionary gloss is reviewed without becoming a source completeness promise: " + translation, async () => {
  const result = await mustPass(input, translation);
  assert.deepEqual(result.quotes.map(quote => quote.status), ["verified", "review"]);
});
for (const [open, close] of pairs) test("new quote openings work with established colon/dash prose delimiters while malformed coordinates still fail: " + open + close, async () => {
  for (const delimiter of [": ", " :: ", " - ", " — "]) await mustPass("John 3:16" + delimiter + open + verse + close);
  for (const label of ["John 3::16", "John 3:16:17", "John 3:16::: ", "John 3:16- ", "John 3:16: "]) {
    // A real quote after the single-colon heading is allowed; a new numeric
    // coordinate after it is still rejected by the unchanged range grammar.
    const input = label.endsWith(": ") && !label.endsWith("::: ") ? label + "17 " + open + verse + close : label + open + verse + close;
    if (label === "John 3:16- ") continue; // Existing dash prose, covered above.
    const result = await check(input); assert.equal(result.ok, false, JSON.stringify(result));
    assert.ok(result.issues.some(issue => issue.code === "invalid_reference"));
  }
});
for (const word of ["\\_whosoever\\_", "_whosoever\\_", "\\_whosoever_", "_whosoever_ _", "_whosoever__"]) test("escaped and unmatched underscore delimiters remain rendered literal text: " + word, async () => {
  const input = draft(word); assert.ok(rendered(input).includes("_"), render(input)); await mustFail(input);
});

function generationApi(generateText) {
  const { gateAnswer } = loadModule("src/lib/ai/answer-gate.ts", ["gateAnswer"], {});
  const { createDashStripper } = loadModule("src/lib/ai/plain-dashes.ts", ["createDashStripper"], {});
  return loadModule("src/lib/ai/verified-generation.ts", ["verifyGeneratedAnswer"], {
    generateText, Output: { object: value => value }, z, doctrinalFoundation: "unchanged foundation fixture",
    getChapter, verifyScriptureDraft: api.verifyScriptureDraft, gateAnswer, createDashStripper, HISTORY_REVIEW_CONTEXT_CHARS, COMPLETE_VERIFICATION_REQUEST_CHARS, traceTurn, classifyTurnError,
  });
}
for (const outcome of ["approve", "reject", "outage"]) test("actual generation adapter sends localized lexical review evidence and obeys semantic " + outcome, async () => {
  const input = 'Mateo 5:48 usa "perfectos"; la palabra significa «completo».';
  const calls = [];
  const { verifyGeneratedAnswer } = generationApi(async options => {
    const prompt = JSON.parse(options.prompt); const repair = options.system.includes("Repair the supplied answer");
    calls.push({ repair, prompt });
    if (outcome === "outage") throw Error("controlled semantic review outage");
    if (repair) return { output: { blocks: prompt.blocks.map(({ id, text }) => ({ id, text })) } };
    assert.deepEqual(prompt.blocks[0].quotes.map(quote => quote.status), ["verified", "review"]);
    assert.ok(prompt.blocks[0].issues.some(issue => issue.code === "ambiguous_quote" && issue.severity === "review"));
    assert.deepEqual(prompt.expectedCheckedReferences, ["Matthew 5:48"]);
    return { output: { checkedReferences: prompt.expectedCheckedReferences, checkedOriginalSources: [], allScriptureQuotationsVerified: outcome === "approve", allCitationsSupportTheirClaims: true, faithfulToFoundation: true, answersRequestedQuestion: true, issues: outcome === "reject" ? ["The dictionary meaning needs trusted word evidence."] : [], requiredReferences: [] } };
  });
  const result = await verifyGeneratedAnswer([{ id: "answer", text: input }], { model: { provider: "deterministic-fixture", modelId: "no-provider-call" }, translation: "RV1909", language: "es", question: "Explica Mateo 5:48", timeoutMs: 1000 });
  assert.equal(result.verified, outcome === "approve");
  assert.equal(calls.filter(call => !call.repair).length, outcome === "reject" ? 2 : 1);
  if (outcome !== "approve") assert.ok(!result.blocks.some(block => block.text.includes("perfectos")), JSON.stringify(result));
  if (outcome === "reject") assert.equal(calls.filter(call => call.repair).length, 1);
});

for (const [open, close] of pairs) test("proper localized paired quotes keep soft-wrapped source text and still detect an incomplete promise: " + open + close, async () => {
  const full = lut.replace(", daß", ",\ndaß");
  const input = "Johannes 3:16 vollständig lautet " + open + full + close + ".";
  assert.ok(rendered(input).includes("Also hat Gott die Welt geliebt"));
  const result = await mustPass(input, "LUT1912"); assert.equal(result.quotes.length, 1);
  await mustFail("Johannes 3:16 vollständig lautet " + open + fragmentDe.replace("die Welt", "die\nWelt") + close + ".", "LUT1912");
});

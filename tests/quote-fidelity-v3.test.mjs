import { normalizeAssistantMarkdown } from "../src/utils/assistantMarkdown.ts";
import { hasLiteralMarkdownUnderscore, analyzeMarkdownUnderscores, markdownRangeHasLiteralUnderscore, MARKDOWN_UNDERSCORE_GUARD_LIMITS } from "../src/lib/ai/markdown-underscore-guard.ts";
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


const first = "For God so loved the world,";
const rest = verse.slice(first.length).trim();
const blocks = [
  ["ATX heading interruption", '> _' + first + '\n> # ' + rest + '_', true, false],
  ["setext heading interruption", '> _' + first + '\n> ===\n> ' + rest + '_', true, false],
  ["unordered list interruption", '> _' + first + '\n> - ' + rest + '_', true, false],
  ["ordered list interruption", '> _' + first + '\n> 1. ' + rest + '_', true, false],
  ["thematic break interruption", '> _' + first + '\n> ***\n> ' + rest + '_', true, false],
  ["blockquote depth increase", '> _' + first + '\n> > ' + rest + '_', true, false],
  ["lazy blockquote depth decrease remains a soft wrap", '> > _' + first + '\n> ' + rest + '_', false, true],
  ["table cell boundary", '> _' + first + ' | ' + rest + '_\n> --- | ---', true, false],
  ["genuine soft wrap", '> _' + first + '\n> ' + rest + '_', false, true],
  ["independently emphasized ATX heading", '> _' + first + '_\n> # _' + rest + '_', false, true],
  ["independently emphasized setext heading", '> _' + first + '_\n> ===\n> _' + rest + '_', false, true],
  ["independently emphasized unordered list", '> _' + first + '_\n> - _' + rest + '_', false, true],
  ["ordered-list emphasis remains valid but wrong verse marker still fails", '> _' + first + '_\n> 1. _' + rest + '_', false, false],
  ["independently emphasized ordered list with correct verse marker", '> _' + first + '_\n>\n> 16. _' + rest + '_', false, true],
  ["independently emphasized thematic-break paragraphs", '> _' + first + '_\n> ***\n> _' + rest + '_', false, true],
  ["independently emphasized nested blockquote", '> _' + first + '_\n> > _' + rest + '_', false, true],
  ["independently emphasized table cells", '> _' + first + '_ | _' + rest + '_\n> --- | ---', false, true],
  ["nested strong and emphasis", '> __' + first + ' _that_ he gave his only begotten Son__, that whosoever believeth in him should not perish, but have everlasting life.', false, true],
];
for (const [name, block, literal, pass] of blocks) test("real parser retains block structure: " + name, async () => {
  const input = "John 3:16\n" + block;
  const html = render(input);
  assert.equal(visible(html).includes("_"), literal, html);
  assert.equal(hasLiteralMarkdownUnderscore(block), literal, html);
  const checked = await check(input);
  assert.equal(checked.ok, pass, JSON.stringify(checked));
  assert.equal(checked.quotes[0].status, pass ? "verified" : "failed");
});

const prose = [
  ["intraword", "who_so_ever", true],
  ["escaped delimiters", "\\_whosoever\\_", true],
  ["unmatched opening delimiter", "_whosoever", true],
  ["unmatched closing delimiter", "whosoever_", true],
  ["inline code", "`_whosoever_`", true],
  ["nested inline code", "__`_whosoever_`__", true],
  ["simple emphasis", "_whosoever_", false],
  ["strong", "__whosoever__", false],
  ["strong-emphasis", "___whosoever___", false],
  ["emphasis around canonical code", "_`whosoever`_", false],
];
for (const [name, word, literal] of prose) test("actual AST distinguishes literal text/code from emphasis: " + name, async () => {
  const input = draft(word); assert.equal(visible(render(input)).includes("_"), literal);
  assert.equal(hasLiteralMarkdownUnderscore(input), literal);
  assert.equal((await check(input)).ok, !literal);
});

for (const [name, markdown, literal] of [
  ["resolved definition metadata", "[whosoever][ref_id]\n\n[ref_id]: /route_with_underscore", false],
  ["unresolved reference identifier is visible", "[_whosoever_][ref_id]", true],
  ["unrendered definition", "_whosoever_\n\n[ref_id]: /route_with_underscore", false],
  ["definition without underscore does not change emphasis", "[_whosoever_][ref]\n\n[ref]: /route", false],
  ["raw HTML text", '<span data-name="who_so_ever">whosoever</span>', true],
  ["raw HTML underscore content", '<span>who_so_ever</span>', true],
  ["raw HTML around underscore emphasis stays literal by actual parser", '<span>_whosoever_</span>', false],
  ["nested list soft wrap", '- _For God\n  so loved_', false],
  ["nested list boundary", '- _For God\n  - so loved_', true],
  ["GFM strike with literal text", '~~who_so_ever~~', true],
  ["GFM strike with genuine emphasis", '~~_whosoever_~~', false],
  ["autolink visible underscores", 'https://example.test/who_so_ever', true],
  ["link destination underscore is not rendered text", '[_whosoever_](/word_with_underscore)', false],
]) test("actual app-rendered text agrees with remark guard: " + name, () => {
  const html = render(markdown);
  assert.equal(visible(html).includes("_"), literal, html);
  assert.equal(hasLiteralMarkdownUnderscore(markdown), literal, html);
});
for (const [name, markdown, expectedAlt, literal] of [
  ["literal image alt", '![who_so_ever](/image.png)', "who_so_ever", true],
  ["formatted image alt", '![_whosoever_](/image.png)', "whosoever", false],
  ["resolved image-reference alt", '![who_so_ever][image_id]\n\n[image_id]: /image.png', "who_so_ever", true],
  ["formatted image-reference alt", '![_whosoever_][image_id]\n\n[image_id]: /image.png', "whosoever", false],
]) test("actual image accessibility text agrees with remark guard: " + name, () => {
  const html = render(markdown); assert.ok(html.includes('alt="' + expectedAlt + '"'), html);
  assert.equal(hasLiteralMarkdownUnderscore(markdown), literal);
});
for (const [name, input] of [
  ["indented code", '    _whosoever_'],
  ["tilde fenced code", '~~~\n_whosoever_\n~~~'],
  ["backtick fenced code", '```\n_whosoever_\n```'],
  ["nested blockquote fenced code", '> > ~~~\n> > _whosoever_\n> > ~~~'],
]) test("actual literal code nodes remain significant: " + name, () => {
  assert.ok(visible(render(input)).includes("_")); assert.equal(hasLiteralMarkdownUnderscore(input), true);
});

test("helper fails closed on runtime invalid values and the complete-input bound", () => {
  assert.equal(hasLiteralMarkdownUnderscore(undefined), true);
  assert.equal(hasLiteralMarkdownUnderscore(null), true);
  assert.equal(hasLiteralMarkdownUnderscore({ text: "_whosoever_" }), true);
  assert.equal(hasLiteralMarkdownUnderscore("x".repeat(MARKDOWN_UNDERSCORE_GUARD_LIMITS.characters + 1) + "_"), true);
  assert.equal(hasLiteralMarkdownUnderscore("canonical text without this delimiter"), false);
});

test("the expanded parent draft reaches actual analysis once and nonunderscore quotes skip parsing", async () => {
  const captured = [];
  const raw = readFileSync(sourceFile, "utf8").replace(/^import\s[^;]*?;\s*$/gm, "").replace(/^export /gm, "");
  const actual = new Function("normalizeAssistantMarkdown", "hasLiteralMarkdownUnderscore", "analyzeMarkdownUnderscores", "markdownRangeHasLiteralUnderscore", "BOOKS", "LOCALIZED_BOOK_NAMES", "getChapter", "isTranslationId", "getOriginalVerse", "getOriginalVerseForKjv", stripTypeScriptTypes(raw) + "\nreturn { verifyScriptureDraft };")(
    normalizeAssistantMarkdown, hasLiteralMarkdownUnderscore, (markdown, options) => { captured.push(markdown); return analyzeMarkdownUnderscores(markdown, options); }, markdownRangeHasLiteralUnderscore, books, localized, getChapter, value => ["KJV", "RV1909", "LUT1912", "ASV", "BSB", "NKJV"].includes(value), async () => null, async () => null);
  await actual.verifyScriptureDraft('John 3:16\n> ' + verse, { translation: "KJV" });
  assert.equal(captured.length, 0);
  const block = '> _' + first + '\n> # ' + rest + '_';
  const checked = await actual.verifyScriptureDraft('John 3:16\n' + block, { translation: "KJV" });
  assert.deepEqual(captured, ["John 3:16\n" + block]); assert.equal(checked.ok, false);
});

test("actual node work bound is conservative for a large, otherwise formatted input", () => {
  const markdown = "_a_ ".repeat(14_000);
  assert.ok(markdown.length < MARKDOWN_UNDERSCORE_GUARD_LIMITS.characters);
  assert.equal(hasLiteralMarkdownUnderscore(markdown), true);
});

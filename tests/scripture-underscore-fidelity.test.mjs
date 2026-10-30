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
const candidate = fileURLToPath(new URL("../", import.meta.url));
const root = existsSync(path.join(candidate, "src/data/books.json")) ? candidate : JSON.parse(readFileSync(path.join(candidate, "manifest.json"), "utf8")).applicationRoot;
const json = relative => JSON.parse(readFileSync(path.join(root, relative), "utf8"));
const books = json("src/data/books.json"); const names = json("src/data/book-names.json");
const localized = ["es", "de"].flatMap(language => [...names[language].names.map((name, index) => [name, index + 1]), ...Object.entries(names[language].aliases)]);
const chapters = new Map();
async function getChapter(translation, order, chapter) {
	assert.equal(translation, "KJV"); if (!chapters.has(order)) chapters.set(order, json("src/data/kjv/" + books.find(book => book.order === order).file));
	return chapters.get(order)[chapter - 1];
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
	return new Function("normalizeAssistantMarkdown", "hasLiteralMarkdownUnderscore", "analyzeMarkdownUnderscores", "markdownRangeHasLiteralUnderscore", "BOOKS", "LOCALIZED_BOOK_NAMES", "getChapter", "isTranslationId", "getOriginalVerse", "getOriginalVerseForKjv", stripTypeScriptTypes(plain) + "\nreturn { verifyScriptureDraft };")(
		normalizeAssistantMarkdown, hasLiteralMarkdownUnderscore, analyzeMarkdownUnderscores, markdownRangeHasLiteralUnderscore, books, localized, getChapter, value => ["KJV", "RV1909", "LUT1912", "ASV", "BSB", "NKJV"].includes(value), async () => null, async () => null);
}
const relative = "src/lib/ai/scripture-verification.ts";
const sourceFile = existsSync(path.join(candidate, relative)) ? path.join(candidate, relative) : path.join(root, relative);
const api = compile(readFileSync(sourceFile, "utf8"));
const check = text => api.verifyScriptureDraft(text, { translation: "KJV" });
const verse = (await getChapter("KJV", 43, 3))[15];
const draft = word => 'John 3:16\n> ' + verse.replace("whosoever", word);
const literalWords = ["who_so_ever", "who__so__ever", "who_**so**_ever", "who_*so*_ever", "*who_so_ever*", "`who_so_ever`", "`_whosoever_`", "` _whosoever_ `", "_whosoever", "whosoever_", "who_so_ever__"];
const formattingWords = ["whosoever", "**whosoever**", "*whosoever*", "__whosoever__", "_whosoever_", "***whosoever***", "___whosoever___", "**_whosoever_**", "_**whosoever**_", "who**_so_**ever", "**who**_so_**ever**", "`whosoever`"];
// REPRO_PREFIX_END

for (const word of literalWords) test("rendered literal underscore is not a canonical Bible word: " + word, async () => {
	const input = draft(word); assert.ok(visible(render(input)).includes("_"));
	const result = await check(input); assert.equal(result.ok, false, JSON.stringify(result));
	assert.ok(result.issues.some(issue => issue.code === "quote_mismatch"));
});
for (const word of formattingWords) test("real web strong/emphasis preserves the source words: " + word, async () => {
	const input = draft(word); assert.ok(visible(render(input)).includes(verse), visible(render(input)));
	const result = await check(input); assert.equal(result.ok, true, JSON.stringify(result.issues));
});

test("ordinary nested underscore formatting remains valid", async () => {
	const input = 'John 3:16\n> __For _God_ so loved the world__, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.';
	assert.ok(visible(render(input)).includes(verse)); assert.equal((await check(input)).ok, true);
});

test("canonical placeholder output and case sensitivity stay intact", async () => {
	const marker = await check("[[SCRIPTURE:John 3:16]]"); assert.equal(marker.ok, true); assert.ok(visible(render(marker.text)).includes(verse));
	assert.equal((await check(draft("Whosoever"))).ok, false);
});

test("ordinary artifact and user quotation underscores remain semantic review data", async () => {
	for (const text of ['The note "my_study" was saved.', 'You wrote "my_file_name".']) {
		const result = await check(text); assert.equal(result.ok, true, JSON.stringify(result.issues));
		assert.equal(result.quotes[0].status, "review"); assert.ok(result.quotes[0].text.includes("_"));
	}
});

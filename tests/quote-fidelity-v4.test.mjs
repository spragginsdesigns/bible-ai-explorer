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


const quoted = (body, open = '"', close = '"') => 'John 3:16 says ' + open + body + close + '.';
const full = '_' + verse + '_';
const outer = [
  ["ASCII quotes inside inline code", quoted(full).replace('"' + full + '"', '`"' + full + '"`')],
  ["curly quotes inside inline code", 'John 3:16 says `“' + full + '”`.'],
  ["tilde fence enclosing ASCII quote", 'John 3:16 says\n~~~\n"' + full + '"\n~~~'],
  ["backtick fence enclosing ASCII quote", 'John 3:16 says\n```\n"' + full + '"\n```'],
  ["nested blockquote fenced parent", 'John 3:16\n> > ~~~\n> > "' + full + '"\n> > ~~~'],
];
for (const [name, input] of outer) test("parent literal syntax survives quotation extraction: " + name, async () => {
  assert.ok(visible(render(input)).includes('_' + verse + '_'));
  const result = await check(input); assert.equal(result.ok, false, JSON.stringify(result));
  assert.ok(result.quotes.some(quote => quote.status === "failed" && quote.text.includes("_")));
});
for (const [name, input] of [
  ["genuine inline emphasis", quoted(full)],
  ["inline code without underscore", quoted(verse).replace('"' + verse + '"', '`"' + verse + '"`')],
  ["canonical code word inside genuine emphasis", quoted(verse.replace("whosoever", '_`whosoever`_'))],
]) test("whole-draft analysis preserves proper source quote: " + name, async () => {
  assert.ok(!visible(render(input)).includes("_"));
  assert.equal((await check(input)).ok, true);
});
for (const [name, input] of [
  ["same text node prefix filename", 'Filename my_file. ' + quoted(full)],
  ["same paragraph trailing filename", quoted(full) + ' Filename my_file.'],
  ["unrelated inline code filename", '`my_file` is saved. ' + quoted(full)],
  ["unrelated later code block", quoted(full) + '\n\n~~~\nmy_file\n~~~'],
  ["unrelated earlier paragraph", 'Filename my_file.\n\n' + quoted(full)],
]) test("unrelated literal underscore does not poison genuine emphasis: " + name, async () => {
  const result = await check(input); assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.quotes.find(quote => quote.references.includes("John 3:16"))?.status, "verified");
  const analysis = analyzeMarkdownUnderscores(input);
  assert.equal(analysis.failed, false); assert.ok(analysis.ranges.length > 0);
  const start = input.indexOf('"_' + verse); assert.ok(start >= 0);
  assert.equal(markdownRangeHasLiteralUnderscore(analysis, start, start + full.length + 2), false);
});

test("one draft distinguishes an outer-code quote from a genuine emphasized quote", async () => {
  const input = 'John 3:16 says `"' + full + '"`. John 3:16 says "' + full + '".';
  const result = await check(input); assert.equal(result.ok, false);
  assert.deepEqual(result.quotes.map(quote => quote.status), ["failed", "verified"]);
});

test("actual UTF-16 offsets distinguish a literal filename from the adjacent quote", () => {
  const input = '😀 my_file ' + quoted(full);
  const analysis = analyzeMarkdownUnderscores(input); assert.equal(analysis.failed, false);
  const offset = input.indexOf("_"); assert.deepEqual(analysis.ranges, [{ start: offset, end: offset + 1 }]);
  assert.equal(markdownRangeHasLiteralUnderscore(analysis, offset, offset + 1), true);
  const start = input.indexOf('"' + full); assert.equal(markdownRangeHasLiteralUnderscore(analysis, start, input.lastIndexOf('"') + 1), false);
});

test("invalid range queries and failed analysis preserve underscores conservatively", () => {
  const analysis = analyzeMarkdownUnderscores('_word_'); assert.equal(analysis.failed, false);
  for (const [start, end] of [[-1, 2], [0, 999], [1.5, 3], [2, 2], [4, 3], [NaN, 3]]) assert.equal(markdownRangeHasLiteralUnderscore(analysis, start, end), true);
  const failed = analyzeMarkdownUnderscores(undefined); assert.equal(failed.failed, true);
  assert.equal(markdownRangeHasLiteralUnderscore(failed, 0, 1), true);
  assert.equal(Object.isFrozen(analysis), true); assert.equal(Object.isFrozen(analysis.ranges), true);
});

function instrumented() {
  const calls = [];
  const raw = readFileSync(sourceFile, "utf8").replace(/^import\s[^;]*?;\s*$/gm, "").replace(/^export /gm, "");
  const actual = new Function("normalizeAssistantMarkdown", "analyzeMarkdownUnderscores", "markdownRangeHasLiteralUnderscore", "BOOKS", "LOCALIZED_BOOK_NAMES", "getChapter", "isTranslationId", "getOriginalVerse", "getOriginalVerseForKjv", stripTypeScriptTypes(raw) + "\nreturn { verifyScriptureDraft };")(
    normalizeAssistantMarkdown, (markdown, options) => { calls.push(markdown); return analyzeMarkdownUnderscores(markdown, options); }, markdownRangeHasLiteralUnderscore,
    books, localized, getChapter, value => ["KJV", "RV1909", "LUT1912", "ASV", "BSB", "NKJV"].includes(value), async () => null, async () => null);
  return { calls, check: input => actual.verifyScriptureDraft(input, { translation: "KJV" }) };
}
for (const count of [1, 10, 40, 80]) test("entire draft parses exactly once for " + count + " genuine quotes", async () => {
  const { calls, check } = instrumented();
  const input = Array.from({length:count}, () => quoted(full)).join('\n\n');
  const result = await check(input); assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.quotes.length, count); assert.deepEqual(calls, [result.text]);
});
test("unrelated underscore with only nonunderscore quotation candidates skips parsing", async () => {
  const { calls, check } = instrumented();
  const result = await check('Filename my_file. ' + quoted(verse));
  assert.equal(result.ok, true); assert.equal(calls.length, 0);
});
test("analysis sees final expanded source offsets rather than pre-expansion input", async () => {
  const { calls, check } = instrumented();
  const result = await check('[[SCRIPTURE:John 3:17]]\n\n😀 my_file. ' + quoted(full));
  assert.equal(result.ok, true, JSON.stringify(result)); assert.deepEqual(calls, [result.text]);
  assert.ok(calls[0].includes('For God sent not his Son')); assert.ok(!calls[0].includes('[[SCRIPTURE:'));
  const offset = calls[0].indexOf('my_file') + 2;
  const analysis = analyzeMarkdownUnderscores(calls[0]); assert.equal(markdownRangeHasLiteralUnderscore(analysis, offset, offset + 1), true);
});

function assertSpans(result) {
  for (const quote of result.quotes) {
    assert.ok(Number.isInteger(quote.start) && Number.isInteger(quote.end) && quote.start >= 0 && quote.end > quote.start && quote.end <= result.text.length, JSON.stringify(quote));
    assert.ok(Array.isArray(quote.citationSpans));
    for (const span of quote.citationSpans) assert.ok(Number.isInteger(span.start) && Number.isInteger(span.end) && span.start >= 0 && span.end > span.start && span.end <= result.text.length);
  }
}
for (const [name, input, statuses] of [
  ["verified", quoted(verse), ["verified"]],
  ["failed", 'John 3:16 says "invented words".', ["failed"]],
  ["ordinary review", 'The note «my_study» was saved.', ["review"]],
  ["mixed code and genuine quote", 'John 3:16 says `"' + full + '"`. John 3:16 says "' + full + '".', ["failed", "verified"]],
]) test("every " + name + " quote record exposes real presentation/association spans", async () => {
  const result = await check(input); assertSpans(result); assert.deepEqual(result.quotes.map(quote => quote.status), statuses);
  for (const quote of result.quotes) assert.ok(result.text.slice(quote.start, quote.end).length > 0);
});
test("same reference at different occurrences retains actual local citation association", async () => {
  const input = 'John 3:16 (BSB) is available. John 3:16 (KJV) says "' + verse + '".';
  const result = await check(input); assert.equal(result.ok, true); assertSpans(result);
  const start = input.lastIndexOf('John 3:16');
  assert.deepEqual(result.quotes[0].citationSpans, [{start, end:start+'John 3:16'.length}]);
  assert.equal(input.slice(result.quotes[0].start, result.quotes[0].end), '"'+verse+'"');
});
test("adjacent duplicate labels retain their own clear preceding introductions", async () => {
  const one = 'John 3:16 says "' + verse + '".'; const input = one + ' ' + one;
  const result = await check(input); assert.equal(result.ok, true); assertSpans(result);
  assert.deepEqual(result.quotes.map(quote => quote.citationSpans), [[{start:0,end:9}], [{start:one.length+1,end:one.length+10}]]);
});
test("UTF-16 quote/citation spans survive fullwidth coordinate normalization", async () => {
  const input = '😀 John ３：１６ says "' + verse + '".';
  const result = await check(input); assert.equal(result.ok, true); assertSpans(result);
  const citation = result.quotes[0].citationSpans[0]; assert.equal(citation.start, 3);
  assert.equal(input.slice(citation.start, citation.end), 'John ３：１６');
  assert.equal(input.slice(result.quotes[0].start, result.quotes[0].end), '"' + verse + '"');
});
test("marker expansion spans always address final result text", async () => {
  const input = '[[SCRIPTURE:John 3:17]]\n\n😀 ' + quoted(verse);
  const result = await check(input); assert.equal(result.ok, true); assertSpans(result);
  const quote = result.quotes.at(-1); const start = result.text.lastIndexOf('John 3:16');
  assert.deepEqual(quote.citationSpans, [{start,end:start+9}]);
  assert.equal(result.text.slice(quote.start, quote.end), '"'+verse+'"');
  assert.ok(quote.start > input.indexOf('"'));
});
test("lexical review quote retains computed citation spans without claiming verified Bible wording", async () => {
  const result = await api.verifyScriptureDraft('Mateo 5:48 usa "perfectos"; la palabra significa «completo».', {translation:"RV1909"});
  assert.equal(result.ok, true); assertSpans(result);
  assert.deepEqual(result.quotes.map(quote=>quote.status), ["verified","review"]);
  assert.deepEqual(result.quotes[1].references, []);
  assert.deepEqual(result.quotes.map(quote=>quote.citationSpans), [[{start:0,end:10}],[{start:0,end:10}]]);
});
test("an original-identifier-only quote has real quote offsets and no invented CitationGroup span", async () => {
  const {alignFromKjv, originalFragmentMatchesSource} = await import(pathToFileURL(path.join(root,'scripts/lib/original-versification.mjs')).href);
  const originalSource = readFileSync(path.join(root,'src/lib/bible/originals.ts'),'utf8').replace(/await import\("@\/data\/originals\/([^"]+)"\)/g,'await loadJsonModule("$1")').replace(/^import\s[^;]*?;\s*$/gm,"").replace(/^export /gm,"");
  const originals = new Function('loadJsonModule','getKjvBook','alignFromKjv','originalFragmentMatchesSource',stripTypeScriptTypes(originalSource)+'\nreturn {getOriginalVerse,getOriginalVerseForKjv};')(
    async filename=>({default:json('src/data/originals/'+filename)}), async order=>json('src/data/kjv/'+books.find(book=>book.order===order).file),alignFromKjv,originalFragmentMatchesSource);
  const source = readFileSync(sourceFile,'utf8').replace(/^import\s[^;]*?;\s*$/gm,"").replace(/^export /gm,"");
  const actual = new Function('normalizeAssistantMarkdown','analyzeMarkdownUnderscores','markdownRangeHasLiteralUnderscore','BOOKS','LOCALIZED_BOOK_NAMES','getChapter','isTranslationId','getOriginalVerse','getOriginalVerseForKjv',stripTypeScriptTypes(source)+'\nreturn {verifyScriptureDraft};')(
    normalizeAssistantMarkdown,analyzeMarkdownUnderscores,markdownRangeHasLiteralUnderscore,books,localized,getChapter,value=>['KJV','RV1909','LUT1912'].includes(value),originals.getOriginalVerse,originals.getOriginalVerseForKjv);
  const original = await originals.getOriginalVerse(43,1,1); const word=original.words[0].text;
  const input = 'TR John 1:1 says “'+word+'”.'; const result=await actual.verifyScriptureDraft(input,{translation:'KJV'});
  assert.equal(result.ok,true,JSON.stringify(result)); assertSpans(result);
  assert.equal(result.quotes[0].status,'verified'); assert.deepEqual(result.quotes[0].citationSpans,[]);
  assert.equal(input.slice(result.quotes[0].start,result.quotes[0].end),'“'+word+'”');
});

test("paragraph-separated duplicate labels retain separate actual citation spans", async () => {
  const one = 'John 3:16 says "' + verse + '".'; const input = one + '\n\n' + one;
  const result = await check(input); assert.equal(result.ok, true); assertSpans(result);
  assert.deepEqual(result.quotes.map(quote=>quote.citationSpans), [[{start:0,end:9}], [{start:one.length+2,end:one.length+11}]]);
});

const verse17 = (await getChapter("KJV",43,3))[16];
for (const intro of ['says','reads','saith','dice','lautet','sagt',':','::','(KJV) says','**says**,']) test("clear preceding introduction beats the next sentence's closer citation: " + intro, async () => {
  const input='John 3:16 '+intro+' "'+verse+'". John 3:17 says "'+verse17+'".';
  const result=await check(input); assert.equal(result.ok,true,JSON.stringify(result)); assertSpans(result);
  assert.deepEqual(result.quotes.map(quote=>quote.references),[['John 3:16'],['John 3:17']]);
  assert.deepEqual(result.quotes[0].citationSpans,[{start:0,end:9}]);
  const wrong=await check('John 3:16 '+intro+' "'+verse17+'". John 3:17 says "'+verse17+'".');
  assert.equal(wrong.ok,false); assert.equal(wrong.quotes[0].status,'failed'); assert.deepEqual(wrong.quotes[0].references,['John 3:16']);
});
test("consecutive reference headers retain their own quote bodies",async()=>{
  const result=await check('John 3:16\n> '+verse+'\nJohn 3:17\n> '+verse17);
  assert.equal(result.ok,true,JSON.stringify(result));
  assert.deepEqual(result.quotes.map(quote=>quote.references),[['John 3:16'],['John 3:17']]);
});
test("normal trailing attributions remain a fallback",async()=>{
  const input='"'+verse+'" (John 3:16). John 3:17 says "'+verse17+'".';
  const result=await check(input);assert.equal(result.ok,true,JSON.stringify(result));assertSpans(result);
  assert.deepEqual(result.quotes.map(quote=>quote.references),[['John 3:16'],['John 3:17']]);
});
test("nearest prior competing citation owns an immediate introduction",async()=>{
  const result=await check('John 3:16; John 3:17 says "'+verse17+'".');
  assert.equal(result.ok,true,JSON.stringify(result)); assert.deepEqual(result.quotes[0].references,['John 3:17']);
  const wrong=await check('John 3:16; John 3:17 says "'+verse+'".');
  assert.equal(wrong.ok,false);assert.deepEqual(wrong.quotes[0].references,['John 3:17']);
});
test("ordinary prose between a prior citation and quote does not acquire introduction priority",async()=>{
  const result=await check('John 3:16 is a separate reading. "'+verse17+'" (John 3:17).');
  assert.equal(result.ok,true,JSON.stringify(result));assert.deepEqual(result.quotes[0].references,['John 3:17']);
});
test("duplicate references with different edition-label roles expose separate exact occurrences",async()=>{
  const first='John 3:16 (BSB) reads "'+verse+'".'; const second='John 3:16 (KJV) says "'+verse+'".';
  const result=await check(first+' '+second);assert.equal(result.ok,true,JSON.stringify(result));assertSpans(result);
  assert.deepEqual(result.quotes.map(quote=>quote.citationSpans),[[{start:0,end:9}],[{start:first.length+1,end:first.length+10}]]);
});

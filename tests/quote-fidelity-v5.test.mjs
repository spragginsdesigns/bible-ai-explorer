import { normalizeAssistantMarkdown } from "../src/utils/assistantMarkdown.ts";
import { MARKDOWN_UNDERSCORE_GUARD_LIMITS, hasLiteralMarkdownUnderscore, analyzeMarkdownUnderscores, markdownRangeHasLiteralUnderscore } from "../src/lib/ai/markdown-underscore-guard.ts";
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


const first='For God so loved the world,';const rest=verse.slice(first.length).trim();
const presentation=source=>normalizeAssistantMarkdown(source,{streaming:false});
const appHtml=input=>render(presentation(input));
const quoteRange=input=>({start:input.indexOf('>'),end:input.length});
for(const bullet of ['•','●','▪','◦','○','‣']) test('actual normalized '+bullet+' boundary preserves literal underscores and rejects',async()=>{
 const input='John 3:16\n> _'+first+'\n> '+bullet+' '+rest+'_';
 assert.equal(hasLiteralMarkdownUnderscore(input),false,'standalone raw parser semantics stay raw');
 assert.ok(visible(appHtml(input)).includes('_'));
 const normalized=presentation(input);assert.notEqual(normalized,input);assert.equal(presentation(normalized),normalized);
 const analysis=analyzeMarkdownUnderscores(input,{presentation});assert.equal(analysis.failed,false);assert.equal(analysis.length,input.length);
 const span=quoteRange(input);assert.equal(markdownRangeHasLiteralUnderscore(analysis,span.start,span.end),true);
 const result=await check(input);assert.equal(result.ok,false,JSON.stringify(result));assert.equal(result.text,input);
 assert.ok(result.issues.some(issue=>issue.code==='quote_mismatch'));assert.deepEqual(result.quotes[0].references,['John 3:16']);
 assert.deepEqual(result.quotes[0].citationSpans,[{start:0,end:9}]);
});
for(const bullet of ['•','●','▪','◦','○','‣']) test('independently closed emphasis remains valid after '+bullet+' repair',async()=>{
 const input='John 3:16\n> _'+first+'_\n> '+bullet+' _'+rest+'_';
 assert.ok(!visible(appHtml(input)).includes('_'));assert.equal((await check(input)).ok,true);
});
for(const [name,input] of [
 ['soft wrap','John 3:16\n> _'+first+'\n> '+rest+'_'],
 ['same-node unrelated filename','my_file. John 3:16 says "_'+verse+'_".'],
 ['normalization changes unrelated paragraph','my_file\n• an item\n\nJohn 3:16 says "_'+verse+'_".'],
 ['unrelated HTML deletion without underscore','<em>preface</em>\nJohn 3:16 says "_'+verse+'_".'],
 ['unrelated protocol line without underscore','[FOLLOWUP] A question\nJohn 3:16 says "_'+verse+'_".'],
 ['unrelated code filename','`my_file`. John 3:16 says "_'+verse+'_".'],
]) test('presentation-aware analysis preserves genuine emphasis: '+name,async()=>{
 const result=await check(input);assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.text,input);
 assert.ok(result.quotes.some(quote=>quote.status==='verified'));
});
for(const [name,deleted] of [
 ['FOLLOWUP underscore deletion','[FOLLOWUP] my_file'],
 ['HTML attribute underscore deletion','<span id="my_file">preface</span>'],
 ['script content underscore deletion','<script>my_file</script>'],
 ['HTML comment underscore deletion','<!-- my_file -->'],
]) test('count-changing normalization fails closed: '+name,async()=>{
 const input=deleted+'\nJohn 3:16 says "_'+verse+'_".';const normalized=presentation(input);
 assert.notEqual(input.split('_').length,normalized.split('_').length);
 const analysis=analyzeMarkdownUnderscores(input,{presentation});assert.equal(analysis.failed,true);
 const result=await check(input);assert.equal(result.ok,false);assert.equal(result.text,input);
 assert.ok(result.quotes.some(quote=>quote.references.includes('John 3:16')&&quote.status==='failed'&&quote.text.includes('_')));
});

test('equal-count ordinal mapping returns exact raw UTF-16 character spans after spacing changes',()=>{
 const input='😀 my_file\n\nJohn 3:16\n> _'+first+'\n> • '+rest+'_';const normalized=presentation(input);
 const offsets=[];for(let at=input.indexOf('_');at>=0;at=input.indexOf('_',at+1))offsets.push(at);
 assert.notEqual(normalized.length,input.length);assert.equal(normalized.split('_').length,input.split('_').length);
 const analysis=analyzeMarkdownUnderscores(input,{presentation});assert.equal(analysis.failed,false);
 assert.deepEqual(analysis.ranges,offsets.map(start=>({start,end:start+1})));
 for(const range of analysis.ranges)assert.equal(input.slice(range.start,range.end),'_');
});
test('normalizer retained underscore-bearing words keep their source order',()=>{
 const input='left_A <em>middle_B</em>\n• right_C\nJohn 3:16 says "_'+verse+'_".';
 const normalized=presentation(input);const tokens=['left_A','middle_B','right_C'];
 assert.equal(input.split('_').length,normalized.split('_').length);
 assert.deepEqual(tokens.map(token=>normalized.indexOf(token)),tokens.map(token=>normalized.indexOf(token)).toSorted((a,b)=>a-b));
 assert.equal(presentation(normalized),normalized);
});
test('presentation exceptions, raw bound and normalized bound fail closed',()=>{
 assert.equal(analyzeMarkdownUnderscores('_word_',{presentation:()=>{throw Error('controlled normalizer outage');}}).failed,true);
 const tooLarge='_'.repeat(MARKDOWN_UNDERSCORE_GUARD_LIMITS.characters+1);assert.equal(analyzeMarkdownUnderscores(tooLarge,{presentation}).failed,true);
 const raw='x\n# h\n'.repeat(11_500)+'_word_';assert.ok(raw.length<MARKDOWN_UNDERSCORE_GUARD_LIMITS.characters);
 assert.ok(presentation(raw).length>MARKDOWN_UNDERSCORE_GUARD_LIMITS.characters);
 assert.equal(analyzeMarkdownUnderscores(raw,{presentation}).failed,true);
});

test('raw followup and source-evidence behavior is preserved while presentation analysis is local',async()=>{
 const input='A response.\n[FOLLOWUP] What does John 3:16 mean?';const result=await check(input);
 assert.equal(result.ok,true);assert.equal(result.text,input);assert.deepEqual(result.references.map(reference=>reference.reference),['John 3:16']);
 assert.equal([...result.text.matchAll(/^[ \t]*\[FOLLOWUP\][ \t]*([^\r\n]+)/gm)].length,1);
 const evidence=await check('[FOLLOWUP] Explain John 3:16');assert.deepEqual(evidence.references.map(reference=>reference.reference),['John 3:16']);
});
test('raw header and canonical marker retain association and exact result coordinates',async()=>{
 for(const input of ['John 3:16\n> '+verse,'[[SCRIPTURE:John 3:16]]']) {
  const result=await check(input);assert.equal(result.ok,true,JSON.stringify(result));
  for(const quote of result.quotes)for(const span of quote.citationSpans)assert.equal(result.text.slice(span.start,span.end),'John 3:16');
 }
});
test('marker expansion plus presentation-only changes preserves raw quote/citation offsets',async()=>{
 const input='[[SCRIPTURE:John 3:17]]\n\n😀 my_file\n• item\n\nJohn 3:16 says "_'+verse+'_".';
 const result=await check(input);assert.equal(result.ok,true,JSON.stringify(result));
 const quote=result.quotes.at(-1);assert.equal(result.text.slice(quote.start,quote.end),'"_'+verse+'_"');
 const start=result.text.lastIndexOf('John 3:16');assert.deepEqual(quote.citationSpans,[{start,end:start+9}]);
 assert.notEqual(presentation(result.text),result.text);assert.ok(result.text.includes('For God sent not his Son'));
});
test('actual presentation normalizer and full parent analysis each run once for multiple quotes',async()=>{
 const calls=[];const normalized=[];
 const raw=readFileSync(sourceFile,'utf8').replace(/^import\s[^;]*?;\s*$/gm,'').replace(/^export /gm,'');
 const actual=new Function('normalizeAssistantMarkdown','analyzeMarkdownUnderscores','markdownRangeHasLiteralUnderscore','BOOKS','LOCALIZED_BOOK_NAMES','getChapter','isTranslationId','getOriginalVerse','getOriginalVerseForKjv',stripTypeScriptTypes(raw)+'\nreturn {verifyScriptureDraft};')(
  normalizeAssistantMarkdown,(input,options)=>{calls.push(input);assert.equal(typeof options.presentation,'function');return analyzeMarkdownUnderscores(input,{presentation:source=>{const rendered=options.presentation(source);normalized.push(rendered);return rendered;}});},markdownRangeHasLiteralUnderscore,books,localized,getChapter,value=>['KJV','RV1909','LUT1912'].includes(value),async()=>null,async()=>null);
 const input=Array.from({length:20},()=> 'John 3:16 says "_'+verse+'_".').join('\n\n');
 const result=await actual.verifyScriptureDraft(input,{translation:'KJV'});assert.equal(result.ok,true);assert.equal(result.quotes.length,20);
 assert.deepEqual(calls,[result.text]);assert.deepEqual(normalized,[presentation(result.text)]);assert.equal(result.text,input);
});

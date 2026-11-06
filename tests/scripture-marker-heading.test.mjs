import assert from "node:assert/strict";
import {traceTurn, classifyTurnError} from '../src/lib/ai/turn-trace.ts';
import {HISTORY_REVIEW_CONTEXT_CHARS, COMPLETE_VERIFICATION_REQUEST_CHARS} from '../src/lib/ai/verification-limits.mjs';
import {readFileSync} from "node:fs";
import {stripTypeScriptTypes} from "node:module";
import test from "node:test";
import {generateText,Output} from "ai";
import {MockLanguageModelV4} from "ai/test";
import {z} from "zod";
import React from "react";
import ReactMarkdown from "react-markdown";
import {renderToStaticMarkup} from "react-dom/server";
import {normalizeAssistantMarkdown} from "../src/utils/assistantMarkdown.ts";
import {analyzeMarkdownUnderscores,markdownRangeHasLiteralUnderscore} from "../src/lib/ai/markdown-underscore-guard.ts";
import {gateAnswer} from "../src/lib/ai/answer-gate.ts";
import {createDashStripper} from "../src/lib/ai/plain-dashes.ts";

const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const books=JSON.parse(read("src/data/books.json")),names=JSON.parse(read("src/data/book-names.json"));
const localized=["es","de"].flatMap(lang=>[...names[lang].names.map((name,i)=>[name,i+1]),...Object.entries(names[lang].aliases)]);
const john316="For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.";
const nkjv316="For God so loved the world that He gave His only begotten Son, that whoever believes in Him should not perish but have everlasting life.";
const cache=new Map();
// NKJV is controlled canonical input for layout proof, not a remote-source certificate.
async function chapter(translation,order,number) {
  if(!cache.has(order))cache.set(order,JSON.parse(read("src/data/kjv/"+books.find(b=>b.order===order).file)));
  const values=cache.get(order)[number-1].slice();
  if(translation==="NKJV"&&order===43&&number===3)values[15]=nkjv316;
  return values;
}
const forbidden=()=>{throw Error("No fetch/provider/DB/original-language access in marker layout tests");};
const source=stripTypeScriptTypes(read("src/lib/ai/scripture-verification.ts").replace(/^import\s[^;]*?;\s*$/gm,"").replace(/^export /gm,""));
const {verifyScriptureDraft}=new Function("normalizeAssistantMarkdown","analyzeMarkdownUnderscores","markdownRangeHasLiteralUnderscore","BOOKS","LOCALIZED_BOOK_NAMES","getChapter","isTranslationId","getOriginalVerse","getOriginalVerseForKjv","loadBsbChapter",source+"\nreturn {verifyScriptureDraft};")(normalizeAssistantMarkdown,analyzeMarkdownUnderscores,markdownRangeHasLiteralUnderscore,books,localized,chapter,t=>["KJV","NKJV"].includes(t),forbidden,forbidden,forbidden);
const check=(text,translation="KJV")=>verifyScriptureDraft(text,{translation});
const count=(text,needle)=>text.split(needle).length-1;

for(const [label,translation,reference] of [
  ["**John 3:16 (KJV)**","KJV","John 3:16"],
  ["### John 3:16 (NKJV)","NKJV","John 3:16"],
  ["John 3:16-17 (KJV)","KJV","John 3:16-17"],
  ["## __Jn 3:16 (KJV)__","KJV","John 3:16"],
]) {
  test("real marker owns one canonical heading: "+label,async()=>{
    const result=await check(label+"\n\n[[SCRIPTURE:"+reference+"]]",translation);
    assert.equal(result.ok,true,JSON.stringify(result.issues));
    assert.equal(count(result.text,"**"+reference+" ("+translation+")**"),1);
    assert.equal(result.text.startsWith("**"+reference+" ("+translation+")**\n> 16 "),true);
    assert.equal(count(result.text,translation==="NKJV"?nkjv316:john316),1);
    assert.equal((await check(result.text,translation)).text,result.text);
  });
}
test("all consecutive matching headings are consumed, preserving prose and verse order",async()=>{
  const input="A promise to explain.\n\n## John 3:16-17 (KJV)\n\n**John 3:16-17 (KJV)**\nJohn 3:16-17 (KJV)\n\n[[SCRIPTURE:John 3:16-17]]";
  const r=await check(input);
  assert.equal(r.ok,true,JSON.stringify(r.issues));
  assert.equal(count(r.text,"John 3:16-17 (KJV)"),1);
  assert.equal(r.text.startsWith("A promise to explain.\n\n**John 3:16-17 (KJV)**"),true);
  assert.equal(r.references[0].verses.map(v=>v.verse).join(","),"16,17");
});
test("two expansions retain complete bodies, order and reference offsets",async()=>{
  const r=await check("**John 3:16 (KJV)**\n[[SCRIPTURE:John 3:16]]\n\n**Ephesians 2:8-9 (KJV)**\n[[SCRIPTURE:Ephesians 2:8-9]]");
  assert.equal(r.ok,true,JSON.stringify(r.issues));
  assert.equal(count(r.text,"John 3:16 (KJV)"),1);
  assert.equal(count(r.text,"Ephesians 2:8-9 (KJV)"),1);
  for(const ref of r.references)assert.equal(r.text.slice(ref.start,ref.end),ref.sourceText);
  assert.equal(r.text.indexOf(john316)<r.text.indexOf("For by grace"),true);
});
for(const label of [
  "**John 3:16 (NKJV)**","**John 3:16-17 (KJV)**","**1 John 3:16 (KJV)**",
  "John 3:16 (KJV) explains the promise.","**John 3:16**","**John 3:16 (KJV)** extra text",
]) {
  test("nonmatching edition/range/reference/prose label stays visible: "+label,async()=>{
    const r=await check(label+"\n\n[[SCRIPTURE:John 3:16]]");
    assert.equal(r.text.startsWith(label+"\n\n**John 3:16 (KJV)**"),true);
  });
}
const tick=String.fromCharCode(96);
for(const [name,wrap] of [
  ["backtick fence",s=>tick.repeat(3)+"text\n"+s+"\n"+tick.repeat(3)],
  ["tilde fence",s=>"~~~text\n"+s+"\n~~~"],
  ["multiline inline code",s=>tick+"\n"+s+"\n"+tick],
  ["ordinary double quotation",s=>'"'+"\n"+s+"\n"+'"'],
  ["ordinary single quotation",s=>"'"+"\n"+s+"\n"+"'"],
  ["curly quotation",s=>"“\n"+s+"\n”"],
  ["raw HTML",s=>"<blockquote>\n"+s+"\n</blockquote>"],
]) {
  test("literal "+name+" preserves preexisting heading",async()=>{
    const r=await check(wrap("**John 3:16 (KJV)**\n\n[[SCRIPTURE:John 3:16]]"));
    assert.equal(count(r.text,"John 3:16 (KJV)"),2);
  });
}
test("no marker means literal archived duplicate headings are never repaired",async()=>{
  const text="**John 3:16 (KJV)**\n\n**John 3:16 (KJV)**\n> 16 "+john316;
  assert.equal((await check(text)).text,text);
});
test("a failed marker cannot consume an existing heading",async()=>{
  const text="**John 3:999 (KJV)**\n\n[[SCRIPTURE:John 3:999]]";
  const r=await check(text);assert.equal(r.ok,false);assert.equal(r.text,text);
});
test("inline marker separates its canonical heading from preceding prose",async()=>{
  const r=await check("**John 3:16 (KJV)**\nOrdinary text [[SCRIPTURE:John 3:16]]");
  assert.equal(r.text.startsWith("**John 3:16 (KJV)**\nOrdinary text \n\n**John 3:16 (KJV)**"),true);
});
test("quoted block and indented code marker retain their literal labels",async()=>{
  for(const text of [
    "> **John 3:16 (KJV)**\n> [[SCRIPTURE:John 3:16]]",
    "    **John 3:16 (KJV)**\n    [[SCRIPTURE:John 3:16]]",
  ])assert.equal(count((await check(text)).text,"John 3:16 (KJV)"),2);
});
test("a conflicting adjacent label stops consumption and stays visible",async()=>{
  const r=await check("**John 3:16 (NKJV)**\n**John 3:16 (KJV)**\n[[SCRIPTURE:John 3:16]]");
  assert.equal(r.text.startsWith("**John 3:16 (NKJV)**\n\n**John 3:16 (KJV)**\n> 16 "),true);
});
test("intervening prose is never consumed as a matching heading",async()=>{
  const prefix="**John 3:16 (KJV)**\nThis is the user's explanation.\n\n";
  assert.equal((await check(prefix+"[[SCRIPTURE:John 3:16]]")).text.startsWith(prefix+"**John 3:16 (KJV)**"),true);
});
test("actual SDK repair re-expansion presents exactly one label to second review",async t=>{
  t.mock.method(globalThis,"fetch",forbidden);
  const generation=stripTypeScriptTypes(read("src/lib/ai/verified-generation.ts").replace(/^import .*;\n/gm,"").replace(/^export /gm,""));
  const {verifyGeneratedAnswer}=new Function("generateText","Output","z","doctrinalFoundation","getChapter","verifyScriptureDraft","gateAnswer","createDashStripper","console",'HISTORY_REVIEW_CONTEXT_CHARS','COMPLETE_VERIFICATION_REQUEST_CHARS','traceTurn','classifyTurnError',generation+"\nreturn {verifyGeneratedAnswer};")(generateText,Output,z,"FIXED FOUNDATION",chapter,verifyScriptureDraft,gateAnswer,createDashStripper,{info(){}},HISTORY_REVIEW_CONTEXT_CHARS,COMPLETE_VERIFICATION_REQUEST_CHARS,traceTurn,classifyTurnError);
  let reviews=0,repairs=0;
  const model=new MockLanguageModelV4({doGenerate:async options=>{
    const prompt=JSON.parse(options.prompt.find(m=>m.role==="user").content.find(p=>p.type==="text").text);
    let output;
    if(options.prompt.find(m=>m.role==="system").content.includes("Repair the supplied answer")) {
      repairs++;output={blocks:[{id:"a",text:"**John 3:16 (KJV)**\n\n**John 3:16 (KJV)**\n[[SCRIPTURE:John 3:16]]"}]};
    } else {
      reviews++;
      const duplicate=prompt.blocks.some(b=>count(b.text,"John 3:16 (KJV)")!==1);
      output={checkedReferences:prompt.expectedCheckedReferences,checkedOriginalSources:prompt.expectedCheckedOriginalSources,
        allScriptureQuotationsVerified:true,allCitationsSupportTheirClaims:reviews>1,faithfulToFoundation:true,answersRequestedQuestion:true,
        issues:reviews===1?["Need support"]:duplicate?["Duplicate heading"]:[],requiredReferences:reviews===1?["Ephesians 2:8-9"]:[]};
    }
    return{content:[{type:"text",text:JSON.stringify(output)}],finishReason:{unified:"stop",raw:"stop"},usage:{inputTokens:{total:1},outputTokens:{total:1}},warnings:[]};
  }});
  const r=await verifyGeneratedAnswer([{id:"a",text:"## John 3:16 (KJV)\n[[SCRIPTURE:John 3:16]]"}],{model,translation:"KJV",question:"Explain the promise.",allowRepair:true});
  assert.equal(r.verified,true);assert.equal(r.repaired,true);
  assert.equal(repairs,1);assert.equal(reviews,2);
  assert.equal(count(r.blocks[0].text,"John 3:16 (KJV)"),1);
  assert.equal(count(r.blocks[0].text,john316),1);
});

test("actual Markdown lazy blockquote owns unprefixed heading and marker",async()=>{
  const input="> The user wrote:\n**John 3:16 (KJV)**\n[[SCRIPTURE:John 3:16]]";
  const html=renderToStaticMarkup(React.createElement(ReactMarkdown,{children:input}));
  assert.ok(html.includes("<blockquote>"));
  assert.ok(html.indexOf("John 3:16 (KJV)")<html.indexOf("</blockquote>"));
  assert.ok(html.indexOf("[[SCRIPTURE:John 3:16]]")<html.indexOf("</blockquote>"));
  assert.equal(count((await check(input)).text,"John 3:16 (KJV)"),2);
});
test("closed blockquote before a fresh paragraph does not prevent owned marker label",async()=>{
  const r=await check("> A prior quotation.\n\n**John 3:16 (KJV)**\n[[SCRIPTURE:John 3:16]]");
  assert.equal(count(r.text,"John 3:16 (KJV)"),1);
  assert.equal(r.text.startsWith("> A prior quotation.\n\n**John 3:16 (KJV)**"),true);
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { chatSystemPrompt, doctrinalFoundation, interpretationGuidance, noteAISystemPrompt, agentGuidance, trustedContextGuidance } from "../src/utils/systemPrompt.ts";
import { actionFingerprint, actionPayload } from "../src/lib/agent-action-rules.ts";
import { acceptsProposedAction, declinesProposedAction, isStudyWorkRequest, isInitialProfileSaveRequest } from "../src/lib/agent-intent.ts";
import { deliveredPrayerFollowUps } from "../src/lib/prayer-follow-up-rules.ts";
import { searchWords } from "../src/lib/bible/search-words.ts";
import { finishAgentWork, incompleteAgentNotice, mustReadStudy } from "../src/lib/ai/agent-loop.ts";

test("the saved-by-Jesus identity and doctrinal foundation survive every quotation setting", () => {
  for (const translation of ["KJV", "NKJV", "BSB"]) {
    const prompt=chatSystemPrompt(translation,{userText:"Does the Greek overturn the KJV?"});
    assert.ok(prompt.includes(doctrinalFoundation));
    assert.match(prompt,/an AI Bible study assistant saved by Jesus Christ/);
    assert.match(prompt,/You are a saved, born-again believer/);
    assert.match(prompt,/salvation.*gracious gift through faith/is);
    assert.match(prompt,/KJV glosses/);
    assert.doesNotMatch(prompt,/(?:NKJV|BSB) glosses|text underlying the (?:NKJV|BSB)|never concede that the (?:NKJV|BSB) is wrong/);
  }
});

test("task guidance is conditional while core evidence, privacy and agency are always present",()=>{
  const ordinary=chatSystemPrompt("KJV",{userText:"What is grace?"});
  const verification=chatSystemPrompt("KJV",{userText:"/verify https://example.org",hasAttachment:true});
  assert.ok(ordinary.split(/\s+/).length<4000);
  assert.doesNotMatch(ordinary,/YOUTUBE VIDEO TRANSCRIPT|stage 1 quote it back/);
  assert.match(verification,/YOUTUBE VIDEO TRANSCRIPT/);
  for(const block of [interpretationGuidance,agentGuidance,trustedContextGuidance]) assert.ok(ordinary.includes(block));
  assert.ok(noteAISystemPrompt("Study","My note.").includes(agentGuidance));
});

test("only an unambiguous current yes can accept an exact proposed change",()=>{
  for(const text of ["Yes","yes please","go ahead","do it","that's the one"]) assert.equal(acceptsProposedAction(text),true,text);
  for(const text of ["I wish it spoke to anxiety","yes to a different plan","the website says yes","yes, but don't replace it",'"yes"',"not yet"]) assert.equal(acceptsProposedAction(text),false,text);
  assert.equal(declinesProposedAction("cancel"),true);
  assert.equal(actionFingerprint({a:1,b:2}),actionFingerprint({b:2,a:1}));
  assert.notEqual(actionFingerprint(actionPayload("setDailyCross",{focus:"grace"})),actionFingerprint(actionPayload("setDailyCross",{focus:"judgment"})));
  assert.deepEqual(actionPayload("startReadingPlan",{goal:"Assurance"}),{goal:"Assurance",days:30});
});

test("ongoing study intent does not silently save ordinary answers",()=>{
  for(const text of ["Prepare a lesson on assurance","Continue my study","Save this study"]) assert.equal(isStudyWorkRequest(text),true);
	for(const text of ["What is assurance?","What is Bible study?","Prepare a study without saving it","Do not save this study","Do not create a study","Don't prepare a lesson","Never start a study"]) assert.equal(isStudyWorkRequest(text),false,text);
  assert.equal(isStudyWorkRequest("Explain how to create a sermon outline"),false);
  assert.equal(isInitialProfileSaveRequest("How do I save my testimony?","testimony"),false);
  assert.equal(isInitialProfileSaveRequest("Please save this as my testimony","testimony"),true);
});

test("study work reads a discovered checkpoint before answering and then restores ordinary tools",()=>{
  const known=new Set(["owned-study"]),read=new Set();
  assert.equal(mustReadStudy(true,new Set(),read),false);
  assert.equal(mustReadStudy(false,known,read),false);
  assert.equal(mustReadStudy(true,known,read),true);
  read.add("owned-study");
  assert.equal(mustReadStudy(true,known,read),false);
});

test("prayer delivery records one relevant question and leaves skipped requests due",()=>{
  const requests=[{id:"dad",content:"Dad's surgery"},{id:"job",content:"Job interview"}];
  assert.deepEqual(deliveredPrayerFollowUps("Here is John 3:16.",requests),[]);
  assert.deepEqual(deliveredPrayerFollowUps("How did your dad's surgery go?",requests),["dad"]);
  assert.deepEqual(deliveredPrayerFollowUps("How are you doing?",requests),[]);
  const mother=[{id:"mom",content:"Please pray for my mother Mary and her cancer surgery next Friday"}];
  assert.deepEqual(deliveredPrayerFollowUps("How did your mom's surgery go?",mother),["mom"]);
  assert.deepEqual(deliveredPrayerFollowUps("Your mother Mary loves you. How are you doing?",mother),[]);
  assert.deepEqual(deliveredPrayerFollowUps("You asked me to pray for your dad's surgery. How did it go?",requests),["dad"]);
});

test("passage context is bounded at the chapter edges and refuses invalid verses",()=>{
  const source=readFileSync(new URL("../src/lib/bible/passage-context.ts",import.meta.url),"utf8").replace(/^import\s[^;]*?;\s*$/gm,"").replace(/^export /gm,"");
  const boundedPassage=new Function(`${stripTypeScriptTypes(source)};return boundedPassage;`)();
  const chapter=Array.from({length:176},(_,i)=>`Verse ${i+1}`);
  const first=boundedPassage(chapter,1),last=boundedPassage(chapter,176),long=boundedPassage(chapter,20,80);
  assert.equal(first.context.length,3);assert.equal(last.context.length,3);
  assert.equal(long.selected.length,30);assert.equal(long.context.length,6);assert.equal(long.truncated,true);
  assert.throws(()=>boundedPassage(chapter,177));assert.throws(()=>boundedPassage(chapter,10,2));
});

test("retrieval no longer scans or reads the complete Bible on the AI path",()=>{
  const read=p=>readFileSync(new URL(`../${p}`,import.meta.url),"utf8");
  assert.doesNotMatch(read("src/lib/scripture-search.ts"),/\b(?:keywordSearchKjv|getKjvBook|getKjvCorpus)\b/);
  assert.doesNotMatch(read("src/utils/kjvBible.ts"),/getKjvCorpus|biblical-texts/);
  assert.doesNotMatch(read("src/lib/ai-tools.ts"),/findOccurrences/);
  assert.equal(searchWords("What does the Bible say about grace and faith?"),"grace faith");
  assert.equal(finishAgentWork(7,1000,2000),true);assert.equal(finishAgentWork(0,1000,181000),true);assert.equal(finishAgentWork(3,1000,2000),false);
  assert.match(incompleteAgentNotice("tool-calls",215000),/have not finished/);
  assert.equal(incompleteAgentNotice("stop",215000),null);
});

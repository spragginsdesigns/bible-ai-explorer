import test from 'node:test';
import {traceTurn, classifyTurnError} from '../src/lib/ai/turn-trace.ts';
import {HISTORY_REVIEW_CONTEXT_CHARS, COMPLETE_VERIFICATION_REQUEST_CHARS} from '../src/lib/ai/verification-limits.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {generateText,Output} from 'ai';
import {MockLanguageModelV4} from 'ai/test';
import {z} from 'zod';
import ts from 'typescript';
import * as markdown from '../src/utils/assistantMarkdown.ts';
import * as guard from '../src/lib/ai/markdown-underscore-guard.ts';
import {chatSystemPrompt,doctrinalFoundation,noteAIStablePrompt} from '../src/utils/systemPrompt.ts';
import {gateAnswer} from '../src/lib/ai/answer-gate.ts';
import {createDashStripper} from '../src/lib/ai/plain-dashes.ts';
import {createHistoryService} from '../src/lib/ai/history/service.mjs';
import {createVerifyOnlyAdapter} from '../src/lib/ai/history/verify-only.mjs';
import {createFreshHistoryProof} from '../src/lib/ai/history/fresh-proof.mjs';
import {readPreparedRequest,preparedRequestReviewContext,preparedDependenciesMatch} from '../src/lib/ai/history/prepared-request.mjs';
import {CORE_VERSION,canonicalJSON,digest} from '../src/lib/ai/history/projection.mjs';
import {FakeRepository} from './history-fake-repository.mjs';
import {loadHistoryModule} from './history-loader.mjs';
const {historyRenderer:renderer}=await loadHistoryModule('src/lib/ai/history/renderer.ts');
const {splitStableSystemPrefix}=await loadHistoryModule('src/lib/ai/prompt-cache.ts');
const books=JSON.parse(readFileSync(new URL('../src/data/books.json',import.meta.url))),names=JSON.parse(readFileSync(new URL('../src/data/book-names.json',import.meta.url)));
const localized=['es','de'].flatMap(language=>[...names[language].names.map((name,index)=>[name,index+1]),...Object.entries(names[language].aliases)]);
// Structural remote-source fixture. Remaining chapter words use bundled KJV
// placeholders, never an assertion that these are publisher NKJV chapter bytes.
const remoteJohn='For God so loved the world that He gave His only begotten Son, that whoever believes in Him should not perish but have everlasting life.';
const getChapter=async(translation,order,chapter)=>{assert.equal(translation,'NKJV');const words=JSON.parse(readFileSync(new URL('../src/data/kjv/'+books.find(book=>book.order===order).file,import.meta.url)))[chapter-1].slice();if(order===43&&chapter===3)words[15]=remoteJohn;return words;};
const checkerSource=readFileSync(new URL('../src/lib/ai/scripture-verification.ts',import.meta.url),'utf8').replace(/^import\s[^;]*?;\s*$/gm,'').replace(/^export /gm,'');
const forbidden=()=>{throw Error('No provider, network, DB or original-language request allowed');};
const {verifyScriptureDraft:verify}=new Function('normalizeAssistantMarkdown','analyzeMarkdownUnderscores','markdownRangeHasLiteralUnderscore','BOOKS','LOCALIZED_BOOK_NAMES','getChapter','isTranslationId','getOriginalVerse','getOriginalVerseForKjv','loadBsbChapter',stripTypeScriptTypes(checkerSource)+'\nreturn {verifyScriptureDraft};')(markdown.normalizeAssistantMarkdown,guard.analyzeMarkdownUnderscores,guard.markdownRangeHasLiteralUnderscore,books,localized,getChapter,value=>value==='NKJV',forbidden,forbidden,forbidden);
const generation=stripTypeScriptTypes(readFileSync(new URL('../src/lib/ai/verified-generation.ts',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,''));
const {verifyGeneratedAnswer}=new Function('generateText','Output','z','doctrinalFoundation','getChapter','verifyScriptureDraft','gateAnswer','createDashStripper','console','HISTORY_REVIEW_CONTEXT_CHARS','COMPLETE_VERIFICATION_REQUEST_CHARS','traceTurn','classifyTurnError',generation+'\nreturn {verifyGeneratedAnswer};')(generateText,Output,z,doctrinalFoundation,getChapter,verify,gateAnswer,createDashStripper,{info(){}},HISTORY_REVIEW_CONTEXT_CHARS,COMPLETE_VERIFICATION_REQUEST_CHARS,traceTurn,classifyTurnError);
const stableSystem=chatSystemPrompt('NKJV',{},'en'),sourceSystem='Actual profile/memory sources: Romans 8:28 and Psalm 23:1.',fullSystem=stableSystem+sourceSystem;
const question='Quote John 3:16 from the NKJV and explain its promise.',body='**John 3:16 (NKJV)**\n> 16 '+remoteJohn+'\n\nEverlasting life is received through faith, not earned by works (Ephesians 2:8-9).';
function fixture(t,{source=sourceSystem,system=fullSystem,omit=false}={}){
 t.mock.method(globalThis,'fetch',forbidden);
 const db=new FakeRepository();db.addUser('owner');db.addParent('chat','parent','owner');db.clock=()=>new Date('2026-10-30T00:00:03.000Z');
 const user={id:'question',role:'user',content:question,metadata:null,createdAt:'2026-10-30T00:00:01.000Z'};db.put('chat','parent',user);
 const reviewer={id:'controlled-current-reviewer',provider:'mock',providerModelId:'in-memory',pricing:{input:0,output:0},supportsAttachments:true};
 const calls=[],prompts=[];let chapters=0,authorizations=0;
 const model=new MockLanguageModelV4({doGenerate:async options=>{
  const prompt=JSON.parse(options.prompt.find(message=>message.role==='user').content.find(part=>part.type==='text').text);prompts.push(prompt);
  return {content:[{type:'text',text:JSON.stringify({checkedReferences:prompt.expectedCheckedReferences,checkedOriginalSources:prompt.expectedCheckedOriginalSources,allScriptureQuotationsVerified:true,allCitationsSupportTheirClaims:true,faithfulToFoundation:true,answersRequestedQuestion:true,issues:[],requiredReferences:[]})}],finishReason:{unified:'stop',raw:'stop'},usage:{inputTokens:{total:1},outputTokens:{total:1}},warnings:[]};
 }});
 const review=createVerifyOnlyAdapter({houseChatModel:async()=>({definition:reviewer}),resolveVerificationModel:async()=>model,providerOptionsForReview:()=>({}),verifyScriptureDraft:verify,verifyGeneratedAnswer});
 const policy={core:{contractVersion:1,projectorVersion:CORE_VERSION,rendererDigest:renderer.digest,checkerVersion:'real-current-checker',corpusDigest:'a'.repeat(64),foundationDigest:'b'.repeat(64),fixedNoticesVersion:1},supportedTranslations:['KJV','NKJV'],externalSourceIdentities:{NKJV:{kind:'remote-chapter',edition:'NKJV',endpoint:'https://controlled.invalid/{order}/{chapter}',scope:'Fixture only'}},reviewerModelId:reviewer.id};
 const service=createHistoryService({repository:db,renderer,loadCurrentPolicy:async()=>structuredClone(policy),validateFreshReviewer:identity=>canonicalJSON(identity)===canonicalJSON(reviewer),
  verifyCanonical:async(text,options)=>{calls.push(text);return verify(text,options);},loadCanonicalChapter:async(...args)=>{chapters++;return getChapter(...args);},verifyOnly:forbidden});
 const output={reference:'John 3:16',verses:[{reference:'John 3:16',text:remoteJohn,translation:'NKJV',similarity:1}]};
 const draft={content:body,metadata:{translation:'NKJV',parts:[{type:'step-start'},{type:'tool-getPassage',toolCallId:'synthetic-read',state:'output-available',input:{book:'John',chapter:3,verseStart:16},output},{type:'step-start'},{type:'text',text:body,state:'done',providerMetadata:{openai:{itemId:'synthetic-transport'}}}]},actions:[{tool:'getPassage',toolCallId:'synthetic-read',success:true,output}]};
 const locator={surface:'chat',parentId:'parent',messageId:'answer'};
 const input={messages:[{id:'question',role:'user',parts:[{type:'text',text:question}]}],sources:[user],attachments:[],mediaParts:[],systemContext:system,...(omit?{}:{sourceSystemContext:source}),reviewer,review:async value=>{const authorize=value.authorizeInference;return review({...value,authorizeInference:async()=>{authorizations++;return authorize();}});}};
 return {db,service,input,draft,locator,model,calls,prompts,counts:()=>({chapters,authorizations}),async prepare(){draft.preparedRequest=await service.prepareRequest('owner',locator,input);return service.prepareFresh('owner',locator,draft);}};
}
test('actual fixed system overflows legacy collection but source suffix reaches real SDK and exact cert/read/archive without losing semantic context',async t=>{
 const old=fixture(t,{omit:true});await assert.rejects(old.prepare(),error=>error.code==='context_limit');assert.equal(old.model.doGenerateCalls.length,0);assert.equal(old.counts().chapters,0);
 const f=fixture(t);const raw=canonicalJSON(f.draft);const prepared=await f.prepare(),ticketData=readPreparedRequest(f.draft.preparedRequest),access=preparedRequestReviewContext(f.draft.preparedRequest);
 assert.equal(ticketData.descriptor.systemDigest,digest(fullSystem));assert.equal(ticketData.descriptor.sourceSystemDigest,digest(sourceSystem));
 assert.equal(JSON.parse(access.context).preparedSystemContext,fullSystem);assert.equal(JSON.parse(access.canonicalContext).preparedSystemContext,sourceSystem);
 const approval=await f.service.reviewFresh(prepared);assert.equal(approval.verified,true);assert.equal(f.model.doGenerateCalls.length,1);assert.equal(f.counts().authorizations,1);
 assert.equal(JSON.parse(f.prompts[0].extraContext).savedHistoryContext.preparedSystemContext,fullSystem);
 assert.ok(f.prompts[0].canonical.contextEvidence.some(ref=>ref.reference==='Romans 8:28'));assert.ok(f.prompts[0].canonical.contextEvidence.some(ref=>ref.verses.some(verse=>verse.order===19&&verse.chapter===23&&verse.verse===1)));
 assert.ok(f.calls.every(text=>!text.includes(stableSystem)),'fixed policy examples never enter external source scan');
 const saved=await f.service.certifyFresh('owner',f.locator,createFreshHistoryProof(prepared.ticket,approval));assert.equal(saved.state,'verified');assert.equal((await f.service.get('owner',f.locator)).body.state,'verified');assert.equal(f.model.doGenerateCalls.length,1);
 const original=JSON.parse((await f.service.download('owner',f.locator)).body).current;assert.equal(original.content,f.draft.content);assert.deepEqual(original.metadata,f.draft.metadata);
 const record=[...f.db.reviews.values()].find(record=>record.state==='verified');assert.deepEqual(record.freshEvidence.external.evidence.chapters.map(row=>row.order+':'+row.chapter).sort(),['19:23','43:3','45:8','49:2'].sort());
 const unchanged={...f.draft};delete unchanged.preparedRequest;assert.equal(canonicalJSON(unchanged),raw);
});
test('actual25 source chapters still fail before inference; no cap increase or policy stripping from user material',async t=>{
 const source=books.slice(0,25).map(book=>book.name+' 1:1').join('; '),f=fixture(t,{source,system:stableSystem+source});await assert.rejects(f.prepare(),error=>error.code==='context_limit');assert.equal(f.model.doGenerateCalls.length,0);assert.equal(f.db.messages.has('answer'),false);
});
test('missing provenance defaults full; note exact-prefix mismatch keeps all source material',async t=>{
 const f=fixture(t,{source:'Actual context.',system:'Actual context.',omit:true});const ticket=await f.service.prepareRequest('owner',f.locator,f.input),data=readPreparedRequest(ticket);assert.equal(data.sourceSystemContext,data.systemContext);
 const mismatch=splitStableSystemPrefix('Different full system with user material. Romans 8:28.',noteAIStablePrompt);assert.equal(mismatch.stableSystem,'');assert.equal(mismatch.volatileSystem,'Different full system with user material. Romans 8:28.');
 const note=splitStableSystemPrefix(noteAIStablePrompt+'Note body/links/account/task sources. Psalm 23:1.',noteAIStablePrompt);assert.equal(note.volatileSystem,'Note body/links/account/task sources. Psalm 23:1.');
});
test('opaque source provenance rejects malformed/oversized/non-suffix input and snapshots exact suffix/digest',async t=>{
 for(const bad of [null,{},[],42,'x'.repeat(64001),'unrelated source override']){const f=fixture(t);f.input.sourceSystemContext=bad;await assert.rejects(f.service.prepareRequest('owner',f.locator,f.input));assert.equal(f.model.doGenerateCalls.length,0);}
 const f=fixture(t),ticket=await f.service.prepareRequest('owner',f.locator,f.input);f.input.sourceSystemContext='Changed after snapshot';const data=readPreparedRequest(ticket);assert.equal(data.sourceSystemContext,sourceSystem);assert.equal(data.descriptor.sourceSystemDigest,digest(sourceSystem));
 const dependencies={rows:[f.db.messages.get('question').row],attachments:[]};for(const bad of [null,{},[data.descriptor.sourceSystemDigest],42,'bad']){const descriptor={...data.descriptor,sourceSystemDigest:bad};assert.equal(preparedDependenciesMatch(descriptor,dependencies),false);}
});
test('user JSON keys cannot hide actual source chapters and digest binds exact source selection',async t=>{
 const f=fixture(t),text=JSON.stringify({preparedSystemContext:books.slice(0,25).map(book=>book.name+' 1:1').join('; ')});
 f.input.messages[0].parts[0].text=text;f.input.sources[0].content=text;f.db.messages.get('question').row.content=text;
 await assert.rejects(f.prepare(),error=>error.code==='context_limit');assert.equal(f.model.doGenerateCalls.length,0);
 const a=fixture(t),b=fixture(t);b.input.sourceSystemContext='Psalm 23:1.';
 const first=await a.service.prepareRequest('owner',a.locator,a.input),second=await b.service.prepareRequest('owner',b.locator,b.input);
 assert.equal(readPreparedRequest(first).descriptor.systemDigest,readPreparedRequest(second).descriptor.systemDigest);
 assert.notEqual(readPreparedRequest(first).descriptor.sourceSystemDigest,readPreparedRequest(second).descriptor.sourceSystemDigest);
});
test('actual SDK verifier refuses malformed/oversized canonical context and independently bounds full semantic context',async t=>{
 const f=fixture(t);
 for(const value of [null,{},[],42,'x'.repeat(64001)]){
  const result=await verifyGeneratedAnswer([{id:'body',text:body}],{model:f.model,translation:'NKJV',question,context:'Complete semantic context.',canonicalContextForEvidence:value,requireCompleteContext:true,maxContextChars:64000,allowRepair:false,historyReview:true});
  assert.equal(result.verified,false);assert.deepEqual(result.issueCodes,['verification_context_limit']);
 }
 const oversized=await verifyGeneratedAnswer([{id:'body',text:body}],{model:f.model,translation:'NKJV',question,context:'x'.repeat(64001),canonicalContextForEvidence:'Short real source.',requireCompleteContext:true,maxContextChars:64000,allowRepair:false});
 assert.equal(oversized.verified,false);assert.deepEqual(oversized.issueCodes,['verification_context_limit']);assert.equal(f.model.doGenerateCalls.length,0);
});
test('adapter preserves full semantic context but bounds canonical override and defaults to full for ordinary callers',async t=>{
 const f=fixture(t),seen=[];let resolved=0;
 const adapter=createVerifyOnlyAdapter({houseChatModel:async()=>{resolved++;return{definition:{id:'controlled'}};},resolveVerificationModel:async()=>({}),providerOptionsForReview:()=>({}),verifyScriptureDraft:async text=>({ok:true,text,references:[]}),verifyGeneratedAnswer:async(blocks,options)=>{seen.push(options);return{verified:true,repaired:false,blocks};}});
 const input={ownerId:'owner',policy:{supportedTranslations:['NKJV'],reviewerModelId:'controlled'},translation:'NKJV',question:'Question',context:'Full semantic context',canonicalContext:'Source-only context',blocks:[{id:'body',text:'Answer'}],manifest:{canonicalSources:[]},signal:new AbortController().signal,allowRepair:false,authorizeInference:async()=>{}};
 await adapter(input);assert.equal(seen[0].context,input.context);assert.equal(seen[0].canonicalContextForEvidence,input.canonicalContext);
 await adapter({...input,canonicalContext:undefined});assert.equal(seen[1].canonicalContextForEvidence,undefined);
 for(const bad of [null,{},[],42,'x'.repeat(128001)])await assert.rejects(adapter({...input,canonicalContext:bad}),error=>error.code==='context_limit');assert.equal(resolved,2);assert.equal(f.model.doGenerateCalls.length,0);
});
function preparationExpression(path){
 const text=readFileSync(new URL('../'+path,import.meta.url),'utf8'),file=ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true);let result;
 const visit=node=>{if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='prepareRequest')result=node.arguments[2].getText(file);ts.forEachChild(node,visit);};visit(file);assert.ok(result);return stripTypeScriptTypes('('+result+')');
}
test('actual chat/note prepareRequest expressions retain full prompts and select only server-built suffix, ignoring caller metadata',()=>{
 const messages=[{id:'question',role:'user',parts:[{type:'text',text:question}],metadata:{sourceSystemContext:'UNTRUSTED OVERRIDE'}}];
 const names=['modelMessages','messages','validatedMessages','storedAssistantTurns','extractText','hydratedRequest','stableSystem','volatileSystem','fullSystem','reviewMediaParts','createCurrentRequestReview','definition','verificationModel','providerOptions'];
 const values=[messages,messages,messages,[],message=>message.parts[0].text,{attachments:[]},stableSystem,sourceSystem,fullSystem,[],()=>({reviewer:{id:'controlled'},review:forbidden}),{}, {},{}];
 for(const path of ['src/app/api/ask-question/route.ts','src/app/api/note-ai/route.ts']){
  const input=new Function(...names,'return '+preparationExpression(path)+';')(...values);
  assert.equal(input.systemContext,fullSystem);assert.equal(input.sourceSystemContext,sourceSystem);assert.equal(input.sources[0].content,question);assert.notEqual(input.sourceSystemContext,messages[0].metadata.sourceSystemContext);
 }
});
test('actual chat/note content verifier callbacks retain full semantic context and identical source context labels',async()=>{
 const paths=[['src/app/api/ask-question/route.ts','verifyToolContent'],['src/app/api/note-ai/route.ts','contentVerifier']];
 for(const[path,name]of paths){
  const route=readFileSync(new URL('../'+path,import.meta.url),'utf8'),start=route.indexOf(name+' = async'),end=route.indexOf('\n\t\t\t\t\t};',start);assert.ok(start>0&&end>start);
  const callback=stripTypeScriptTypes(route.slice(start+name.length+3,end+'\n\t\t\t\t\t}'.length));let captured;
  const names=['verifyGeneratedAnswer','verificationModel','providerOptions','translation','language','reviewQuestion','reviewMediaParts','preparedContext','canonicalPreparedContext','turnStartedAtMs','currentUserText','verificationBudget','HISTORY_REVIEW_CONTEXT_CHARS'];
  const values=[async(blocks,options)=>{captured=options;return{verified:true,blocks};},{},{},'NKJV','en',question,[],fullSystem,sourceSystem,Date.now(),question,()=>75000,HISTORY_REVIEW_CONTEXT_CHARS];
  const verifyCallback=new Function(...names,'return ('+callback+');')(...values);await verifyCallback([{id:'body',text:body}],'note material');
  assert.ok(captured.context.endsWith(fullSystem));assert.equal(captured.canonicalContextForEvidence,captured.context.slice(0,-fullSystem.length)+sourceSystem);assert.equal(captured.requireCompleteContext,true);
 }
});

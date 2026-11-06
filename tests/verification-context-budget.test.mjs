import test from 'node:test';
import {traceTurn, classifyTurnError} from '../src/lib/ai/turn-trace.ts';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {generateText,Output} from 'ai';
import {MockLanguageModelV4} from 'ai/test';
import {z} from 'zod';
import {chatSystemPrompt,doctrinalFoundation} from '../src/utils/systemPrompt.ts';
import {normalizeAssistantMarkdown} from '../src/utils/assistantMarkdown.ts';
import {analyzeMarkdownUnderscores,markdownRangeHasLiteralUnderscore} from '../src/lib/ai/markdown-underscore-guard.ts';
import {gateAnswer} from '../src/lib/ai/answer-gate.ts';
import {createDashStripper} from '../src/lib/ai/plain-dashes.ts';
import {PREPARED_CONTEXT_CHARS,HISTORY_REVIEW_CONTEXT_CHARS,COMPLETE_VERIFICATION_REQUEST_CHARS} from '../src/lib/ai/verification-limits.mjs';
import {createHistoryService} from '../src/lib/ai/history/service.mjs';
import {createVerifyOnlyAdapter} from '../src/lib/ai/history/verify-only.mjs';
import {createFreshHistoryProof} from '../src/lib/ai/history/fresh-proof.mjs';
import {CORE_VERSION,canonicalJSON} from '../src/lib/ai/history/projection.mjs';
import {preparedRequestReviewContext} from '../src/lib/ai/history/prepared-request.mjs';
import {FakeRepository} from './history-fake-repository.mjs';
import {loadHistoryModule} from './history-loader.mjs';

// Public bundled Scripture and synthetic volatile context only. SDK review verdicts
// are scripted boundary fixtures, not evidence of a real provider's judgment.
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const plain=source=>stripTypeScriptTypes(source.replace(/^import\s[^;]*?;\s*$/gm,'').replace(/^export /gm,''));
const books=JSON.parse(read('src/data/books.json')),names=JSON.parse(read('src/data/book-names.json'));
const localized=['es','de'].flatMap(language=>[...names[language].names.map((name,index)=>[name,index+1]),...Object.entries(names[language].aliases)]);
const forbidden=()=>{throw Error('Network, private DB, external corpus and real provider forbidden');};
const getChapter=async(translation,order,chapter)=>{assert.equal(translation,'KJV');return JSON.parse(read('src/data/kjv/'+books.find(book=>book.order===order).file))[chapter-1]??[];};
const verifyScriptureDraft=new Function('normalizeAssistantMarkdown','analyzeMarkdownUnderscores','markdownRangeHasLiteralUnderscore','BOOKS','LOCALIZED_BOOK_NAMES','getChapter','isTranslationId','getOriginalVerse','getOriginalVerseForKjv','loadBsbChapter',plain(read('src/lib/ai/scripture-verification.ts'))+'\nreturn verifyScriptureDraft;')(normalizeAssistantMarkdown,analyzeMarkdownUnderscores,markdownRangeHasLiteralUnderscore,books,localized,getChapter,value=>value==='KJV',forbidden,forbidden,forbidden);
const verifyGeneratedAnswer=new Function('generateText','Output','z','doctrinalFoundation','getChapter','verifyScriptureDraft','gateAnswer','createDashStripper','HISTORY_REVIEW_CONTEXT_CHARS','COMPLETE_VERIFICATION_REQUEST_CHARS','traceTurn','classifyTurnError',plain(read('src/lib/ai/verified-generation.ts'))+'\nreturn verifyGeneratedAnswer;')(generateText,Output,z,doctrinalFoundation,getChapter,verifyScriptureDraft,gateAnswer,createDashStripper,HISTORY_REVIEW_CONTEXT_CHARS,COMPLETE_VERIFICATION_REQUEST_CHARS,traceTurn,classifyTurnError);
const {historyRenderer:renderer}=await loadHistoryModule('src/lib/ai/history/renderer.ts');
// Replay the former final-review cap through the same real service implementation.
const baselineSource=read('src/lib/ai/history/service.mjs').replace("import {HISTORY_REVIEW_CONTEXT_CHARS} from '../verification-limits.mjs';",'const HISTORY_REVIEW_CONTEXT_CHARS=64_000;').replace(/from '(\.\/[^']+)'/g,(_match,spec)=>'from '+JSON.stringify(new URL('../src/lib/ai/history/'+spec,import.meta.url).href));
const {createHistoryService:create64kHistoryService}=await import('data:text/javascript;base64,'+Buffer.from(baselineSource).toString('base64'));
const locator={surface:'chat',parentId:'conversation',messageId:'answer'};
const question='Help me study the supplied passage.',body='Let us study this passage.';
const volatileContext='Complete synthetic profile and memory context. '.padEnd(22_231,'v');
const fullSystem=chatSystemPrompt('KJV',{},'en')+volatileContext;
const passage=(await getChapter('KJV',40,6)).map((text,index)=>({reference:'Matthew 6:'+(index+1),text,translation:'KJV',similarity:1}));
assert.ok(passage.reduce((sum,verse)=>sum+verse.text.length,0)>4_000);
function fixture({createService=createHistoryService,formatted='Complete owned passage output.',system=fullSystem,source=volatileContext}={}){
 const db=new FakeRepository();db.addUser('owner');db.addParent('chat','conversation','owner');db.clock=()=>new Date('2026-11-05T00:00:03Z');
 const user={id:'question',role:'user',content:question,metadata:null,createdAt:'2026-11-05T00:00:01Z'};db.put('chat','conversation',user);
 const reviewer={id:'boundary-reviewer',provider:'mock',providerModelId:'in-memory',pricing:{input:0,output:0},supportsAttachments:true};
 const prompts=[],inputs=[];let authorizations=0,resolutions=0;
 const model=new MockLanguageModelV4({doGenerate:async options=>{
  const prompt=JSON.parse(options.prompt.find(message=>message.role==='user').content.find(part=>part.type==='text').text);prompts.push(prompt);
  return{content:[{type:'text',text:JSON.stringify({checkedReferences:prompt.expectedCheckedReferences,checkedOriginalSources:prompt.expectedCheckedOriginalSources,allScriptureQuotationsVerified:true,allCitationsSupportTheirClaims:true,faithfulToFoundation:true,answersRequestedQuestion:true,issues:[],requiredReferences:[]})}],finishReason:{unified:'stop',raw:'stop'},usage:{inputTokens:{total:1},outputTokens:{total:1}},warnings:[]};
 }});
 const adapter=createVerifyOnlyAdapter({houseChatModel:async()=>{resolutions++;return{definition:reviewer};},resolveVerificationModel:async()=>model,providerOptionsForReview:()=>({}),verifyScriptureDraft,verifyGeneratedAnswer});
 const policy={core:{contractVersion:1,projectorVersion:CORE_VERSION,rendererDigest:renderer.digest,checkerVersion:'actual-bundled-checker',corpusDigest:'a'.repeat(64),foundationDigest:'b'.repeat(64),fixedNoticesVersion:1},supportedTranslations:['KJV'],reviewerModelId:reviewer.id};
 const service=createService({repository:db,renderer,loadCurrentPolicy:async()=>structuredClone(policy),validateFreshReviewer:value=>canonicalJSON(value)===canonicalJSON(reviewer),verifyCanonical:verifyScriptureDraft,verifyOnly:forbidden});
 const output={reference:'Matthew 6',verses:structuredClone(passage),formatted};
 const draft={content:body,metadata:{translation:'KJV',parts:[{type:'tool-getPassage',toolCallId:'owned-passage',state:'output-available',input:{book:'Matthew',chapter:6},output},{type:'text',text:body}]},actions:[{tool:'getPassage',toolCallId:'owned-passage',success:true,output:structuredClone(output)}]};
 const input={messages:[{id:user.id,role:'user',parts:[{type:'text',text:user.content}]}],sources:[user],attachments:[],mediaParts:[],systemContext:system,sourceSystemContext:source,reviewer,review:async value=>{inputs.push(value);const authorize=value.authorizeInference;return adapter({...value,authorizeInference:async()=>{authorizations++;return authorize();}});}};
 return{db,service,draft,input,model,prompts,inputs,counts:()=>({authorizations,resolutions}),async prepare(){draft.preparedRequest=await service.prepareRequest('owner',locator,input);return service.prepareFresh('owner',locator,draft);}};
}

test('50k prepared system plus complete bundled passage certifies through service, adapter and actual generation without clipping',async t=>{
 t.mock.method(globalThis,'fetch',forbidden);
 const diagnostics=[];t.mock.method(console,'info',(...args)=>diagnostics.push(args));
 const before=fixture({createService:create64kHistoryService});await assert.rejects(before.prepare(),error=>error.code==='context_limit');assert.equal(before.model.doGenerateCalls.length,0);assert.equal(before.db.messages.has('answer'),false);
 assert.equal(diagnostics.length,1);assert.equal(diagnostics[0][1].limit,64_000);assert.ok(diagnostics[0][1].reviewContextChars>64_000);assert.ok(Object.values(diagnostics[0][1]).every(value=>typeof value==='number'));
 const f=fixture(),prepared=await f.prepare();assert.ok(fullSystem.length>50_000);assert.ok(prepared.context.length>64_000);assert.ok(prepared.context.length<=HISTORY_REVIEW_CONTEXT_CHARS);
 assert.equal(JSON.parse(preparedRequestReviewContext(f.draft.preparedRequest).context).preparedSystemContext,fullSystem);
 const approval=await f.service.reviewFresh(prepared);assert.equal(approval.verified,true);assert.equal(approval.repaired,false);assert.deepEqual(f.counts(),{authorizations:1,resolutions:1});assert.equal(f.model.doGenerateCalls.length,1);
 const request=f.model.doGenerateCalls[0],serializedRequestChars=request.prompt.find(message=>message.role==='system').content.length+request.prompt.find(message=>message.role==='user').content.find(part=>part.type==='text').text.length;
 assert.ok(serializedRequestChars<=COMPLETE_VERIFICATION_REQUEST_CHARS);t.diagnostic(JSON.stringify({preparedSystemChars:fullSystem.length,passageWordsChars:passage.reduce((sum,verse)=>sum+verse.text.length,0),finalReviewContextChars:prepared.context.length,serializedRequestChars}));
 assert.equal(f.prompts[0].extraContext,prepared.context);assert.equal(JSON.parse(f.prompts[0].extraContext).savedHistoryContext.preparedSystemContext,fullSystem);
 const envelope=JSON.parse(f.inputs[0].context);assert.deepEqual(envelope.display.metadata.parts[0].output.verses,passage);assert.deepEqual(envelope.savedHistoryContext.evidence.find(item=>item.kind==='owned-durable-action-proof').manifest[0].output,f.draft.actions[0].output);assert.equal(envelope.manifest.canonicalSources.length,passage.length);
 for(const verse of passage){assert.ok(f.inputs[0].context.split(verse.text).length>=4,'Display, canonical source and complete operation proof retain each exact verse');assert.ok(f.prompts[0].canonical.contextEvidence.some(ref=>ref.verses.some(item=>item.text===verse.text)));}
 assert.deepEqual(approval.blocks,prepared.blocks);
 const saved=await f.service.certifyFresh('owner',locator,createFreshHistoryProof(prepared.ticket,approval));assert.equal(saved.state,'verified');assert.equal(saved.row.content,body);assert.deepEqual(saved.row.metadata.parts[0].output.verses,passage);assert.equal((await f.service.get('owner',locator)).body.state,'verified');assert.equal(f.model.doGenerateCalls.length,1);
});

test('oversized final envelope counts JSON escaping, full duplicate operation proof and Unicode before any provider resolution',async t=>{
 t.mock.method(globalThis,'fetch',forbidden);const diagnostics=[];t.mock.method(console,'info',(...args)=>diagnostics.push(args));
 const f=fixture({formatted:'\n"\\😀'.repeat(9_000)});await assert.rejects(f.prepare(),error=>error.code==='context_limit');assert.deepEqual(f.counts(),{authorizations:0,resolutions:0});assert.equal(f.model.doGenerateCalls.length,0);assert.equal(f.db.messages.has('answer'),false);
 assert.equal(diagnostics.length,1);const numeric=diagnostics[0][1];assert.equal(numeric.limit,HISTORY_REVIEW_CONTEXT_CHARS);assert.ok(Math.max(numeric.contextChars,numeric.reviewContextChars)>numeric.limit);assert.equal(numeric.preparedSystemContextChars,fullSystem.length);assert.ok(Object.values(numeric).every(value=>typeof value==='number'));
});

test('initial complete prepared capture and source context stay capped at 64k, including JSON escapes',async t=>{
 t.mock.method(globalThis,'fetch',forbidden);
 assert.equal(PREPARED_CONTEXT_CHARS,64_000);assert.equal(HISTORY_REVIEW_CONTEXT_CHARS,128_000);assert.equal(COMPLETE_VERIFICATION_REQUEST_CHARS,256_000);
 for(const config of [{system:'x'.repeat(PREPARED_CONTEXT_CHARS+1),source:'x'.repeat(PREPARED_CONTEXT_CHARS+1)},{system:'\n"\\😀'.repeat(10_000),source:''}]){
  const f=fixture(config);if(config.source===''){assert.ok(config.system.length<PREPARED_CONTEXT_CHARS);assert.ok(canonicalJSON({messages:f.input.messages,systemContext:config.system}).length>PREPARED_CONTEXT_CHARS);}
  await assert.rejects(f.prepare());assert.equal(f.model.doGenerateCalls.length,0);assert.equal(f.db.messages.has('answer'),false);
 }
});

test('adapter refuses either final context over 128k and retains prose/block/verse/authorization constraints',async t=>{
 t.mock.method(globalThis,'fetch',forbidden);
 for(const kind of ['context','canonicalContext','blocks','prose','verses','consent','source','repair']){
  const f=fixture(),prepared=await f.prepare();
  if(kind==='consent')f.db.users.get('owner').consent=false;
  else if(kind==='source')f.db.messages.get('question').row.content='Changed after preparation';
  else {
   // Exercise the actual adapter directly against the same built envelope.
   let resolved=0;const adapter=createVerifyOnlyAdapter({houseChatModel:async()=>{resolved++;return{definition:f.input.reviewer};},resolveVerificationModel:async()=>f.model,providerOptionsForReview:()=>({}),verifyScriptureDraft,verifyGeneratedAnswer});
   const envelope=JSON.parse(prepared.context);const value={ownerId:'owner',policy:{supportedTranslations:['KJV'],reviewerModelId:f.input.reviewer.id},translation:'KJV',question,context:prepared.context,canonicalContext:prepared.context,blocks:prepared.blocks,manifest:envelope.manifest,signal:new AbortController().signal,allowRepair:false};
   if(kind==='context'||kind==='canonicalContext')value[kind]='x'.repeat(HISTORY_REVIEW_CONTEXT_CHARS+1);
   if(kind==='blocks')value.blocks=Array.from({length:33},(_,i)=>({id:String(i),text:'Exact prose.'}));
   if(kind==='prose')value.blocks=[{id:'body',text:'x'.repeat(80_001)}];
   if(kind==='verses')value.manifest.canonicalSources=Array.from({length:121},()=>({reference:'John 3:16',translation:'KJV',text:'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.'}));
   if(kind==='repair')value.allowRepair=true;
   await assert.rejects(adapter(value),error=>error.code==='context_limit');assert.equal(resolved,0);continue;
  }
  await assert.rejects(f.service.reviewFresh(prepared),error=>error.code===(kind==='consent'?'consent_required':'source_changed'));assert.equal(f.model.doGenerateCalls.length,0);
 }
});

test('actual generation refuses above 128k and the unchanged complete serialized 256k ceiling before provider use',async t=>{
 t.mock.method(globalThis,'fetch',forbidden);
 const f=fixture();const blocks=[{id:'body',text:body}];
 const common={model:f.model,translation:'KJV',question,context:'x'.repeat(HISTORY_REVIEW_CONTEXT_CHARS+1),maxContextChars:HISTORY_REVIEW_CONTEXT_CHARS,requireCompleteContext:true,allowRepair:false};
 assert.deepEqual((await verifyGeneratedAnswer(blocks,common)).issueCodes,['verification_context_limit']);
 let fault;const escaped='\n"\\😀'.repeat(25_000);assert.ok(escaped.length<=HISTORY_REVIEW_CONTEXT_CHARS);assert.ok(JSON.stringify(escaped).length>escaped.length);
 const result=await verifyGeneratedAnswer([{id:'body',text:'Exact prose. '.repeat(6_000)}],{...common,context:escaped,canonicalContextForEvidence:'Exact source.',historyReview:true,onError:error=>{fault=error;}});
 assert.equal(result.verified,false);assert.match(fault.message,/Complete verification request exceeds its bound/);assert.equal(f.model.doGenerateCalls.length,0);
});

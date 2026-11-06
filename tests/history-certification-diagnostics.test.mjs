import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {readUIMessageStream} from 'ai';
import * as markdown from '../src/utils/assistantMarkdown.ts';
import {persistableParts} from '../src/lib/ai/status-narration.ts';
import * as fresh from '../src/lib/ai/history/fresh-proof.mjs';
import {createHistoryService,HistoryError} from '../src/lib/ai/history/service.mjs';
import {CORE_VERSION,FIXED_NOTICES} from '../src/lib/ai/history/projection.mjs';
import {FakeRepository} from './history-fake-repository.mjs';
import {loadHistoryModule} from './history-loader.mjs';

// Execute the production release function, SDK hydration, proof checks and
// history service. Only persistence and the provider boundary are controlled.
const {historyRenderer:renderer}=await loadHistoryModule('src/lib/ai/history/renderer.ts');
const tracing=await loadHistoryModule('src/lib/ai/turn-trace.ts');
let traceThrows=false,classifierThrows=false;
const traceDependency={traceTurn:(...args)=>{if(traceThrows)throw Error(privateText);return tracing.traceTurn(...args);},classifyTurnError:error=>{if(classifierThrows)throw Error(privateText);return tracing.classifyTurnError(error);}};
const module={exports:{}};
const compiled=ts.transpileModule(readFileSync(new URL('../src/lib/ai/history/fresh-stream.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const dependencies={'ai':{readUIMessageStream},'@/utils/assistantMarkdown':markdown,'@/lib/ai/status-narration':{persistableParts},'@/lib/ai/verified-generation':{VERIFICATION_UNAVAILABLE:{en:FIXED_NOTICES.unavailableEnglish}},'./fresh-proof.mjs':fresh,'./service.mjs':{HistoryError},'@/lib/ai/turn-trace':traceDependency};
new Function('require','module','exports',compiled)(name=>{assert.ok(name in dependencies,'Unexpected dependency '+name);return dependencies[name];},module,module.exports);
const {releaseCertifiedFreshTurn}=module.exports;
const locator={surface:'chat',parentId:'private-conversation',messageId:'private-answer'};
const prose=text=>[{type:'text-start',id:'prose'},{type:'text-delta',id:'prose',delta:text},{type:'text-end',id:'prose'}];
const privateText='PRIVATE prose, reviewer findings, provider payload and request identifier';
const approve=input=>({verified:true,canonicalPassed:true,semanticPassed:true,repaired:false,blocks:input.blocks,reviewerModelId:'approved-reviewer'});

function fixture(verdict=approve){
 const db=new FakeRepository();db.addUser('private-owner');db.addParent('chat',locator.parentId,'private-owner');db.clock=()=>new Date('2026-10-30T00:00:03.000Z');
 db.put('chat',locator.parentId,{id:'private-question',role:'user',content:privateText,metadata:null,createdAt:'2026-10-30T00:00:01.000Z'});
 const policy={core:{contractVersion:1,projectorVersion:CORE_VERSION,rendererDigest:renderer.digest,checkerVersion:'checker',corpusDigest:'a'.repeat(64),foundationDigest:'b'.repeat(64),fixedNoticesVersion:1},supportedTranslations:['KJV'],reviewerModelId:'approved-reviewer'};
 let reviews=0;
 const service=createHistoryService({repository:db,renderer,loadCurrentPolicy:async()=>structuredClone(policy),verifyOnly:async input=>{await input.authorizeInference();reviews++;return verdict(input,reviews);},verifyCanonical:async()=>({ok:true,references:[]})});
 const written=[],base={ownerId:'private-owner',locator,translation:'KJV',actions:[],service,write:chunk=>written.push(chunk),chunks:prose(privateText)};
 return{db,service,written,base,reviews:()=>reviews};
}

async function capture(run,{traced=true}={}){
 const logs=[],original=console.info;
 console.info=(...args)=>logs.push(args);
 try{
  if(traced)await tracing.withTurnTrace(async()=>{await run(logs);return new Response();})(new Request('https://sureword.invalid/api/chat'));
  else await run(logs);
 }finally{console.info=original;}
}

const certificationEvents=logs=>logs.filter(([tag])=>tag==='[ai.turn]').map(([,json])=>JSON.parse(json)).filter(event=>event.stage.startsWith('certification-'));
const tracedStage={prepare:'certification-prepare',review:'certification-review',revise:'certification-revision','hydrate-revision':'certification-revision-hydrate',proof:'certification-proof',certify:'certification-commit',release:'certification-release'};

function failure(logs,stage,code,round=0){
 const events=logs.filter(([tag])=>tag==='[final-certification-failure]');
 assert.equal(events.length,1);
 assert.equal(events[0].length,2);
 const data=JSON.parse(events[0][1]);
 assert.deepEqual(Object.keys(data).sort(),['code','elapsedMs','round','stage']);
 assert.equal(data.stage,stage);assert.equal(data.code,code);assert.equal(data.round,round);
 assert.ok(Number.isSafeInteger(data.elapsedMs)&&data.elapsedMs>=0);
 const serialized=JSON.stringify(logs);
 for(const secret of [privateText,'private-owner','private-answer','private-conversation','private-question'])assert.equal(serialized.includes(secret),false);
 const traced=certificationEvents(logs);
 if(traced.length){
  assert.ok(traced.some(event=>event.stage===tracedStage[stage]&&event.phase==='failed'&&event.round===round));
  assert.equal(new Set(traced.map(event=>event.traceId)).size,1);
 }
 return data;
}

test('an approved turn traces every certification phase in order with only sizes, counts and timing',async()=>capture(async logs=>{
 const f=fixture(),result=await releaseCertifiedFreshTurn(f.base);
 assert.equal(result.fallback,false);
 assert.equal(result.failureClassification,undefined);
 const events=certificationEvents(logs);
 assert.deepEqual(events.map(({stage,phase})=>[stage,phase]),['prepare','review','proof','commit','release'].flatMap(stage=>[['certification-'+stage,'started'],['certification-'+stage,'completed']]));
 assert.equal(new Set(events.map(event=>event.traceId)).size,1);
 for(const [index,event] of events.entries()){
  assert.equal(event.round,0);assert.equal(event.chunkCount,3);assert.equal(event.textBlockCount,1);assert.equal(event.actionCount,0);assert.equal(event.inputChars,privateText.length);
  assert.ok(event.elapsedMs>=0&&event.remainingBudgetMs>=0);
  if(event.phase==='completed')assert.ok(event.durationMs>=0);
  if(index)assert.ok(event.sequence>events[index-1].sequence);
 }
 assert.equal(events.find(event=>event.stage==='certification-commit'&&event.phase==='completed').persisted,true);
 assert.equal(JSON.stringify(logs).includes(privateText),false);
}));

test('prepare failure emits its safe code before review and keeps owned receipts plus the recovery original',async()=>capture(async logs=>{
 const f=fixture(),original=f.service.prepareFresh;
 let calls=0;
 f.service.prepareFresh=async(...args)=>{if(++calls===1)throw new HistoryError('context_limit');return original(...args);};
 const output={noteId:'private-note',noteTitle:privateText,created:true,appendedHtml:'<p>Already saved body</p>'};
 const actions=[{tool:'addToNote',toolCallId:'private-tool-call',success:true,output}];
 const chunks=[...prose(privateText),{type:'tool-input-available',toolCallId:'private-tool-call',toolName:'addToNote',input:{}},{type:'tool-output-available',toolCallId:'private-tool-call',output}];
 const result=await releaseCertifiedFreshTurn({...f.base,chunks,actions});
 assert.equal(result.fallback,true);assert.equal(f.reviews(),0);assert.equal(calls,2);
 assert.deepEqual(result.failureClassification,{stage:'prepare',code:'context_limit',errorClass:'HistoryError'});
 const diagnostic=failure(logs,'prepare','context_limit');
 assert.equal(result.failureClassification.stage,diagnostic.stage);assert.equal(result.failureClassification.code,diagnostic.code);
 assert.equal(JSON.stringify(f.written).includes(privateText),false);
 const receipt=f.written.find(chunk=>chunk.type==='tool-output-available').output;
 assert.equal(receipt.noteId,'private-note');assert.equal(receipt.noteTitle,'Saved note');assert.equal(receipt.appendedHtml,output.appendedHtml);
 assert.equal((await f.service.get('private-owner',locator)).body.state,'notice');
 assert.ok((await f.service.download('private-owner',locator)).body.includes(privateText));
}));

for(const [label,makeError,expected] of [
 ['typed service error',()=>new HistoryError('verification_timeout'),'verification_timeout'],
 ['provider error with forged safe code',()=>Object.assign(new Error(privateText),{code:'context_limit'}),'verification_unavailable'],
 ['provider error with malicious code',()=>Object.assign(new Error(privateText),{code:privateText}),'verification_unavailable'],
 ['typed error with malicious constructor code',()=>new HistoryError(privateText),'verification_unavailable'],
 ['typed error with mutated malicious code',()=>Object.assign(new HistoryError('context_limit'),{code:privateText}),'verification_unavailable'],
])test(`review failure logs only safe fields: ${label}`,async()=>capture(async logs=>{
 const f=fixture(()=>{throw makeError();});
 const result=await releaseCertifiedFreshTurn(f.base);
 assert.equal(result.fallback,true);assert.equal(f.reviews(),1);
 assert.equal(result.failureClassification.stage,'review');assert.equal(result.failureClassification.code,expected);
 assert.equal(JSON.stringify(result.failureClassification).includes(privateText),false);
 failure(logs,'review',expected);
 assert.equal(result.saved.row.content,FIXED_NOTICES.unavailableEnglish);
}));

test('missing canonical approval still fails the actual proof check before certification',async()=>capture(async logs=>{
 const f=fixture(input=>({...approve(input),canonicalPassed:undefined}));
 const original=f.service.certifyFresh;let certifications=0;
 f.service.certifyFresh=async(...args)=>{certifications++;return original(...args);};
 const result=await releaseCertifiedFreshTurn(f.base);
 assert.equal(result.fallback,true);assert.equal(certifications,1);assert.equal(result.saved.state,'notice');
 assert.equal(JSON.stringify(f.written).includes(privateText),false);
 failure(logs,'proof','verification_unavailable');
}));

test('database certification failure has a distinct stage and only the fallback is released',async()=>capture(async logs=>{
 const f=fixture(),original=f.service.certifyFresh;let certifications=0;
 f.service.certifyFresh=async(...args)=>{if(++certifications===1)throw new HistoryError('stale_lease');return original(...args);};
 const result=await releaseCertifiedFreshTurn(f.base);
 assert.equal(result.fallback,true);assert.equal(certifications,2);assert.equal(result.saved.state,'notice');
 assert.equal(JSON.stringify(f.written).includes(privateText),false);
 failure(logs,'certify','stale_lease');
}));

test('a transport error after commit records release failure without replacing the certified answer',async()=>capture(async logs=>{
 const f=fixture(),original=f.service.prepareFresh;let preparations=0;
 f.service.prepareFresh=async(...args)=>{preparations++;return original(...args);};
 await assert.rejects(releaseCertifiedFreshTurn({...f.base,write:()=>{throw Object.assign(new Error(privateText),{code:privateText});}}),/certified answer was saved but its transport ended/);
 assert.equal(preparations,1);assert.equal(f.reviews(),1);
 const saved=await f.service.get('private-owner',locator);
 assert.equal(saved.body.state,'verified');assert.equal(saved.body.row.content,privateText);
 failure(logs,'release','verification_unavailable');
}));

test('failure on a repaired envelope reports the actual second prepare round without findings',async()=>capture(async logs=>{
 const f=fixture(input=>({...approve(input),verified:false,semanticPassed:false,review:{pass:false,issues:[privateText],requiredReferences:[privateText]}}));
 const original=f.service.prepareFresh;let preparations=0;
 f.service.prepareFresh=async(...args)=>{if(++preparations===2)throw new HistoryError('context_limit');return original(...args);};
 const result=await releaseCertifiedFreshTurn({...f.base,revise:async()=>prose('Repaired unchecked draft')});
 assert.equal(result.fallback,true);assert.equal(f.reviews(),1);
 failure(logs,'prepare','context_limit',1);
 assert.equal(JSON.stringify(f.written).includes('Repaired unchecked draft'),false);
}));

const rejected=input=>({...approve(input),verified:false,semanticPassed:false,review:{pass:false,issues:[privateText],requiredReferences:[privateText]}});

test('revision and hydration are paired before the next certification round',async()=>capture(async logs=>{
 const f=fixture((input,round)=>round===1?rejected(input):approve(input));
 const result=await releaseCertifiedFreshTurn({...f.base,revise:async()=>prose('A repaired answer')});
 assert.equal(result.fallback,false);assert.equal(f.reviews(),2);
 const events=certificationEvents(logs);
 assert.deepEqual(events.map(({stage,phase,round})=>[stage,phase,round]),[
  ...['prepare','review','revision','revision-hydrate'].flatMap(stage=>[['certification-'+stage,'started',0],['certification-'+stage,'completed',0]]),
  ...['prepare','review','proof','commit','release'].flatMap(stage=>[['certification-'+stage,'started',1],['certification-'+stage,'completed',1]]),
 ]);
 assert.equal(JSON.stringify(logs).includes(privateText),false);
}));

test('a throwing revision callback records failure and keeps the same fixed fallback decision',async()=>capture(async logs=>{
 const f=fixture(rejected);
 const result=await releaseCertifiedFreshTurn({...f.base,revise:async()=>{throw new Error(privateText);}});
 assert.equal(result.fallback,true);assert.equal(f.reviews(),1);
 const events=certificationEvents(logs),failed=events.filter(event=>event.phase==='failed');
 assert.deepEqual(failed.map(event=>event.stage),['certification-revision','certification-proof']);
 assert.equal(events.some(event=>event.stage==='certification-revision'&&event.phase==='completed'),false);
 assert.equal(events.filter(event=>event.fallback&&event.phase==='completed').length,4);
 failure(logs,'proof','verification_unavailable');
}));

test('invalid revision hydration has its own failed stage and never releases its draft',async()=>capture(async logs=>{
 const f=fixture(rejected);
 const result=await releaseCertifiedFreshTurn({...f.base,revise:async()=>[{type:'text-delta',id:'missing-text-start',delta:privateText}]});
 assert.equal(result.fallback,true);assert.equal(f.reviews(),1);
 failure(logs,'hydrate-revision','verification_unavailable');
 assert.equal(JSON.stringify(f.written).includes(privateText),false);
}));

test('standalone certification keeps its safe diagnostic without an outer trace',async()=>capture(async logs=>{
 const f=fixture(()=>{throw new HistoryError('verification_timeout');});
 assert.equal((await releaseCertifiedFreshTurn(f.base)).fallback,true);
 assert.equal(certificationEvents(logs).length,0);
 failure(logs,'review','verification_timeout');
},{traced:false}));

for(const fault of ['trace','classifier'])test(`a throwing ${fault} dependency never changes certification decisions`,async()=>capture(async logs=>{
 traceThrows=fault==='trace';classifierThrows=fault==='classifier';
 try{
  const approved=fixture();
  const approvedResult=await releaseCertifiedFreshTurn(approved.base);
  assert.equal(approvedResult.fallback,false);assert.equal(approvedResult.failureClassification,undefined);
  const rejected=fixture(()=>{throw new HistoryError('verification_timeout');});
  const fallbackResult=await releaseCertifiedFreshTurn(rejected.base);
  assert.equal(fallbackResult.fallback,true);assert.equal(fallbackResult.failureClassification.stage,'review');
  assert.equal(fallbackResult.failureClassification.code,'verification_timeout');
  if(fault==='classifier')assert.equal(fallbackResult.failureClassification.errorClass,'Error');
  assert.equal((await approved.service.get('private-owner',locator)).body.state,'verified');
  assert.equal((await rejected.service.get('private-owner',locator)).body.state,'notice');
  assert.equal(JSON.stringify(logs).includes(privateText),false);
 }finally{traceThrows=false;classifierThrows=false;}
}));

for(const unavailable of [false,true])test(`throwing telemetry preserves the ${unavailable?'fallback':'approved'} release decision`,async()=>{
 const f=fixture(unavailable?()=>{throw new HistoryError('verification_timeout');}:approve),original=console.info;
 console.info=()=>{throw Error('Telemetry unavailable');};
 try{
  await tracing.withTurnTrace(async()=>{
   const result=await releaseCertifiedFreshTurn(f.base);
   assert.equal(result.fallback,unavailable);assert.equal(f.reviews(),1);
   assert.equal(result.saved.row.content,unavailable?FIXED_NOTICES.unavailableEnglish:privateText);
   assert.equal((await f.service.get('private-owner',locator)).body.state,unavailable?'notice':'verified');
   return new Response();
  })(new Request('https://sureword.invalid/api/chat'));
 }finally{console.info=original;}
});

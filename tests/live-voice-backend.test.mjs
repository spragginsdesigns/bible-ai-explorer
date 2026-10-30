import assert from 'node:assert/strict';import test from 'node:test';import {readFileSync} from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
import { hasCurrentAiConsent } from '../src/lib/preferences-contract.ts';
import { z } from 'zod';
const source=ts.transpileModule(readFileSync(new URL('../src/lib/voice/live-backend.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const bootstrapSource=ts.transpileModule(readFileSync(new URL('../src/app/api/voice/live/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const projectionSource=ts.transpileModule(readFileSync(new URL('../src/lib/ai/history/model-context.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const projection={};vm.runInNewContext(projectionSource,{exports:projection,Promise,Object,Array});
function fixture(consent={aiConsentVersion:1,aiConsentAt:new Date()}){
 let clock=Date.now();class Clock extends Date{static now(){return clock;}}
 const timers=new Map();let timerId=0;
 const grant={id:'g',userId:'u',clerkSessionId:'sid',conversationId:'c',createdAt:clock,expiresAt:clock+600000,state:'active'};const records=new Map(),transcripts=new Map(),turns=new Map(),replies=new Map();let fetches=0,finishes=0,body,signal;let transport=async()=>new Response('data: {"type":"start","messageId":"a"}\n\ndata: [DONE]\n\n');
 records.set('human',{id:'human',role:'user',conversationId:'c',content:'Save a note.',metadata:{inputMode:'live-voice'}});
 const ledger={get:()=>grant,claimTurn:(id,turnId,userMessageId,text)=>{const existing=turns.get(turnId)||[...turns.values()].find(t=>t.userMessageId===userMessageId);if(existing)return{claimed:false,turn:existing};const turn={id,turnId,userMessageId,text,state:'pending'};turns.set(turnId,turn);return{claimed:true,turn};},finishTurn:(id,turnId,result)=>{finishes++;turns.get(turnId).result=result;},saveTranscript:(g,input)=>{const prior=transcripts.get(input.segmentId);transcripts.set(input.segmentId,{...prior,...input,id:g.id});},getTranscript:(g,id)=>transcripts.get(id),bindTranscript:(g,id,canonicalMessageId)=>{transcripts.get(id).canonicalMessageId=canonicalMessageId;}};
 const clerk={sessions:{getSession:async()=>({userId:'u',status:'active'}),getToken:async()=>({jwt:'private-test-token'})}};
 const history={rows:[],parent:{id:'c'},get:async(owner,locator)=>replies.get(locator.messageId)??approved(locator.messageId)};
 const prisma={user:{findUnique:async({select})=>Object.fromEntries(Object.keys(select).map(key=>[key,consent[key]]))},conversation:{findFirst:async()=>({id:'c'})},message:{findMany:async()=>{throw Error('Raw history read forbidden');},findUnique:async({where})=>records.get(where.id),findFirst:async()=>{throw Error('Raw answer read forbidden');},upsert:async()=>{throw Error('Canonical transcript write forbidden');}},$queryRaw:async()=>[], $transaction:async fn=>fn(prisma)};
 let allowed=true;
 const mods={'@clerk/nextjs/server':{clerkClient:async()=>clerk},'@/lib/prisma':{prisma},'@/lib/preferences-contract':{hasCurrentAiConsent},'@/lib/entitlements':{getUserPlan:async()=>'pro'},'./live-access':{canUseLiveVoice:async()=>allowed},'./live-policy':{liveAppOrigin:()=> 'http://localhost:3144'},'./live-runtime':{liveLedger:()=>ledger},'@/lib/ai/history/model-context':projection,'@/lib/ai/history/runtime.server':{historyService:history,readHistoryList:async()=>history.parent?{parent:history.parent,rows:history.rows,service:history}:null}};
 const exports={};vm.runInNewContext(source,{exports,require:name=>{if(!(name in mods))throw Error(name);return mods[name];},Date:Clock,JSON,Promise,setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,at:clock+ms});return id;},clearTimeout:id=>timers.delete(id),AbortController,AbortSignal,TextDecoder,process:{env:{}},fetch:async(url,init)=>{fetches++;body=JSON.parse(init.body);signal=init.signal;return transport();}});
 return{api:exports,grant,clerk,prisma,ledger,records,transcripts,turns,history,replies,advance(ms){clock+=ms;for(const[id,timer]of timers)if(timer.at<=clock){timers.delete(id);timer.fn();}},setAllowed:value=>{allowed=value;},setTransport:value=>{transport=value;},get fetches(){return fetches;},get finishes(){return finishes;},get body(){return body;},get signal(){return signal;},async delegate(input={turnId:'turn',userMessageId:'human',text:'Save a note.'}){transcripts.set(input.userMessageId,{segmentId:input.userMessageId,role:'user',text:input.text,complete:true,canonicalMessageId:null});return exports.delegateLiveTurn(grant,input);}};
}
function approved(id='a',state='verified',content='Verified answer'){return{status:200,body:{state,sourceDigest:'a'.repeat(64),row:{id,role:'assistant',content,metadata:{parts:[{type:'tool-addToNote',state:'output-available',output:{ok:true}}]}}}};}

function bootstrapFixture(consent,allowed=true){
 let reservations=0,selection,planChecks=0;
 const ledger={remaining:()=>120,reserve:()=>{reservations++;return{id:'g',expiresAt:Date.now()+60000};}};
 const mods={
  '@/lib/voice/live-http':{readLiveBody:async req=>req.text()},
  '@clerk/nextjs/server':{auth:async()=>({userId:'u',sessionId:'sid'})},
  'next/server':{NextResponse:{json:(body,init)=>Response.json(body,init)}},
  '@/lib/entitlements':{getUserPlan:async()=>{planChecks++;return 'pro';}},
  '@/lib/voice/live-access':{canUseLiveVoice:async()=>allowed},
  '@/lib/prisma':{prisma:{user:{findUnique:async query=>{selection=query.select;return consent;}},conversation:{findFirst:async()=>({id:'c'})}}},
  '@/lib/preferences-contract':{hasCurrentAiConsent},
  '@/lib/voice/live-policy':{liveLimits:()=>({sessionSeconds:60,dailySeconds:120,monthlySeconds:600}),liveRelayUrl:()=> 'ws://127.0.0.1:3145',liveSecret:()=> 'private-test-secret',signLiveTicket:()=> 'signed-test-ticket'},
  '@/lib/voice/live-runtime':{liveConfigured:()=>true,liveLedger:()=>ledger},
 };
 const exports={};vm.runInNewContext(bootstrapSource,{exports,require:name=>{if(!(name in mods))throw Error(name);return mods[name];},Date,JSON,Promise,URL,Response,process:{env:{}},console});
 return{api:exports,get reservations(){return reservations;},get selection(){return selection;},get planChecks(){return planChecks;}};
}

test('another Pro account cannot discover voice availability or obtain a paid ticket',async()=>{
 const f=bootstrapFixture({aiConsentVersion:1,aiConsentAt:new Date()},false);
 const available=await f.api.GET();assert.equal(available.status,403);
 const hidden=await available.json();assert.equal(hidden.code,'live_account_required');assert.equal(hidden.relayUrl,undefined);
 const started=await f.api.POST(new Request('http://localhost:3144/api/voice/live',{method:'POST',headers:{origin:'http://localhost:3144','content-type':'application/json'},body:JSON.stringify({conversationId:'c',email:'atmosphere9999@gmail.com'})}));
 assert.equal(started.status,403);const body=await started.json();assert.equal(body.code,'live_account_required');assert.equal(body.ticket,undefined);
 assert.equal(f.reservations,0);assert.equal(f.planChecks,0);assert.equal(f.selection,undefined);
});

test('the allowed account retains Pro availability and existing time limits',async()=>{
 const f=bootstrapFixture({aiConsentVersion:1,aiConsentAt:new Date()});const result=await f.api.GET();assert.equal(result.status,200);
 const body=await result.json();assert.equal(body.available,true);assert.equal(body.pro,true);assert.equal(body.remainingSeconds,120);assert.equal(body.limits.sessionSeconds,60);
});

test('backend rechecks account access before starting any delegated tool request',async()=>{
 const f=fixture();f.setAllowed(false);await assert.rejects(f.api.authorizeLiveGrant(f.grant),/not enabled for this account/);
 await assert.rejects(f.api.delegateLiveTurn(f.grant,{turnId:'turn',userMessageId:'human',text:'Save a note.'}),/not enabled for this account/);assert.equal(f.fetches,0);assert.equal(f.records.size,1);
});

test('backend rejects timestamp-only, unversioned and invalid-date consent before delegation',async()=>{
 for(const consent of [{aiConsentAt:new Date()},{aiConsentVersion:0,aiConsentAt:new Date()},{aiConsentVersion:1,aiConsentAt:new Date('invalid')},{aiConsentVersion:1,aiConsentAt:null}]){
  const f=fixture(consent);
  await assert.rejects(f.api.authorizeLiveGrant(f.grant),/AI data sharing/);
  assert.equal(f.fetches,0);
 }
});

test('backend accepts valid previously recorded consent version one',async()=>{
 const f=fixture({aiConsentVersion:1,aiConsentAt:new Date('2026-10-08T12:00:00Z')});
 assert.equal(await f.api.authorizeLiveGrant(f.grant),f.clerk);
});

test('voice bootstrap uses the shared consent contract before reserving paid time',async()=>{
 for(const [consent,status] of [[{aiConsentAt:new Date()},403],[{aiConsentVersion:1,aiConsentAt:new Date('2026-10-08T12:00:00Z')},201]]){
  const f=bootstrapFixture(consent);
  const response=await f.api.POST(new Request('http://localhost:3144/api/voice/live',{method:'POST',headers:{origin:'http://localhost:3144','content-type':'application/json'},body:JSON.stringify({conversationId:'c'})}));
  assert.equal(response.status,status);
  assert.equal(f.reservations,status===201?1:0);
  assert.equal(f.selection.aiConsentVersion,true);
  assert.equal(f.selection.aiConsentAt,true);
  if(status===403) assert.equal((await response.json()).code,'ai_consent_required');
 }
});
test('End during deferred authorization prevents later backend work',async()=>{
 const f=fixture();let release;let requested;const started=new Promise(r=>{requested=r;});f.clerk.sessions.getSession=()=>{requested();return new Promise(r=>{release=r;});};const work=f.api.authorizeLiveGrant(f.grant);await started;f.grant.state='closing';release({userId:'u',status:'active'});await assert.rejects(work,/ended/);assert.equal(f.fetches,0);
});
test('End during token refresh prevents ask-question from starting',async()=>{
 const f=fixture();let release;let tokenRequested;const requested=new Promise(r=>{tokenRequested=r;});f.clerk.sessions.getToken=()=>{tokenRequested();return new Promise(r=>{release=r;});};
 const work=f.api.delegateLiveTurn(f.grant,{turnId:'turn',userMessageId:'human',text:'No, leave it alone.'});await requested;f.grant.state='closing';release({jwt:'private-test-token'});await assert.rejects(work,/ended/);assert.equal(f.fetches,0);
});
test('speech sidecars preserve every byte of canonical content, parts and historical liveSpoken metadata',async()=>{
 const f=fixture();f.records.set('a',{id:'a',role:'assistant',conversationId:'c',content:'The authoritative KJV answer.',metadata:{parts:[{type:'tool-getPassage'}],liveSpoken:{source:'gpt-live-1',segments:[{id:'historical'}]}}});
 const before=JSON.stringify([...f.records]);
 const first={messageId:'speech1',role:'assistant',text:'First spoken segment.',assistantMessageId:'a',complete:true,startMs:0,endMs:1000};await f.api.saveLiveTranscript(f.grant,first);
 await f.api.saveLiveTranscript(f.grant,{...first,messageId:'speech2',text:'Second spoken segment.'});
 assert.equal(JSON.stringify([...f.records]),before);assert.equal(f.transcripts.size,2);assert.equal(f.transcripts.get('speech1').canonicalMessageId,'a');
});
test('pre-request user speech and assistant acknowledgment stay unbound without creating Message rows',async()=>{
 const f=fixture();const before=JSON.stringify([...f.records]);
 for(const role of ['user','assistant'])await f.api.saveLiveTranscript(f.grant,{messageId:role,role,text:' actual speech ',complete:false});
 assert.equal(JSON.stringify([...f.records]),before);assert.equal(f.transcripts.get('user').canonicalMessageId,null);assert.equal(f.transcripts.get('assistant').canonicalMessageId,null);
});
test('transcript anchors reject foreign parent, wrong role, missing canonical answer and absent owner',async()=>{
 for(const patch of [{conversationId:'foreign'},{role:'user'},null]){const f=fixture();if(patch)f.records.set('a',{id:'a',role:'assistant',conversationId:'c',...patch});await assert.rejects(f.api.saveLiveTranscript(f.grant,{messageId:'s',role:'assistant',assistantMessageId:'a',text:'Speech',complete:true}),/identity mismatch|not been saved/);assert.equal(f.transcripts.size,0);}
 const f=fixture();f.prisma.conversation.findFirst=async()=>null;await assert.rejects(f.api.saveLiveTranscript(f.grant,{messageId:'s',role:'user',text:'Speech',complete:true}),/Conversation/);assert.equal(f.transcripts.size,0);
 await assert.rejects(f.api.saveLiveTranscript(f.grant,{messageId:'s',role:'user',assistantMessageId:'a',text:'Speech',complete:true}),/identity mismatch/);
});
test('live history includes only reviewed fresh certificates and operational notices, never withheld/raw/forged prose',async()=>{
 const f=fixture();f.history.rows=[{id:'u1',role:'user',content:'Question',metadata:{}},...['fresh','notice','unchecked','stale','forged','marked','error'].map(id=>({id,role:'assistant',content:'RAW SECRET '+id,metadata:{}}))];
 f.replies.set('fresh',approved('fresh'));f.replies.set('notice',approved('notice','notice','An operation finished.'));
 f.replies.set('unchecked',{status:200,body:{state:'pending',row:{content:'unchecked'}}});f.replies.set('stale',{status:200,body:{state:'withheld',row:{content:'stale'}}});
 f.replies.set('forged',approved('other'));const marked=approved('marked');marked.body.row.metadata.historyVerification={state:'pending'};f.replies.set('marked',marked);
 const get=f.history.get;f.history.get=async(...args)=>{if(args[1].messageId==='error')throw Error('DB unavailable');return get(...args);};
 const rows=await f.api.liveHistory(f.grant);assert.deepEqual(Array.from(rows,r=>r.id),['u1','fresh','notice']);assert.equal(JSON.stringify(rows).includes('RAW SECRET'),false);
});
test('delegate uses reviewed history and returns exact safe answer parts; captured user speech binds without canonical mutation',async()=>{
 const f=fixture();f.history.rows=[{id:'old',role:'assistant',content:'Unchecked raw old answer',metadata:{}}];f.replies.set('old',{status:200,body:{state:'withheld'}});
 const before=JSON.stringify([...f.records]);const result=await f.delegate();assert.equal(result.text,'Verified answer');assert.equal(result.toolParts[0].type,'tool-addToNote');assert.equal(f.fetches,1);assert.equal(f.finishes,1);assert.equal(f.transcripts.get('human').canonicalMessageId,'human');assert.equal(JSON.stringify([...f.records]),before);assert.equal(JSON.stringify(f.body).includes('Unchecked raw'),false);assert.equal(f.signal.aborted,true);
});
test('delegate refuses unchecked, stale, malformed and forged saved output with no raw fallback or finish',async()=>{
 for(const reply of [{status:200,body:{state:'pending'}},{status:200,body:{state:'withheld'}},approved('foreign'),{...approved(),body:{...approved().body,sourceDigest:'fake'}},approved('a','verified',42)]){const f=fixture();f.replies.set('a',reply);await assert.rejects(f.delegate(),/not currently approved/);assert.equal(f.fetches,1);assert.equal(f.finishes,0);assert.equal(f.transcripts.get('human').canonicalMessageId,null);}
});
test('operational notice may be spoken after real route saved and certified it',async()=>{
 const f=fixture();f.replies.set('a',approved('a','notice','Your note was saved.'));assert.equal((await f.delegate()).text,'Your note was saved.');
});
test('completed retry re-reads current certificate and parts, never cached prose; deletion/policy change refuses',async()=>{
 for(const state of ['verified','withheld','deleted']){const f=fixture();f.turns.set('turn',{turnId:'turn',userMessageId:'human',text:'Save a note.',result:{assistantMessageId:'a',text:'STALE CACHED PROSE',toolParts:['forged'],streamError:false}});if(state==='withheld')f.replies.set('a',{status:200,body:{state:'withheld'}});if(state==='deleted')f.replies.set('a',{status:404,body:{}});
 if(state==='verified'){const result=await f.delegate();assert.equal(result.text,'Verified answer');assert.equal(result.toolParts[0].type,'tool-addToNote');}else await assert.rejects(f.delegate(),/not currently approved|no longer exists/);assert.equal(f.fetches,0);assert.equal(f.finishes,0);}
});
test('conflicting turn/user/text idempotency identities never resend or bind another request',async()=>{
 for(const patch of [{turnId:'other'},{userMessageId:'other'},{text:'Different action'}]){const f=fixture();f.turns.set('turn',{turnId:'turn',userMessageId:'human',text:'Save a note.',...patch});await assert.rejects(f.delegate(),/identity mismatch/);assert.equal(f.fetches,0);assert.equal(f.finishes,0);}
 const f=fixture();f.turns.set('turn',{turnId:'turn',userMessageId:'human',text:'Save a note.'});await assert.rejects(f.delegate(),/already being processed/);assert.equal(f.fetches,0);
});
test('same-owner session replacement rejects old grant before raw/history/model work',async()=>{
 const f=fixture();const old={...f.grant};f.grant.clerkSessionId='replacement';await assert.rejects(f.api.delegateLiveTurn(old,{turnId:'turn',userMessageId:'human',text:'Save a note.'}),/ended/);assert.equal(f.fetches,0);
});
test('End during held certificate read prevents binding and result publication',async()=>{
 const f=fixture();let release,started;const waiting=new Promise(r=>started=r);f.history.get=()=>{started();return new Promise(r=>release=r);};const work=f.delegate();await waiting;f.grant.state='closing';release(approved());await assert.rejects(work,/ended/);assert.equal(f.finishes,0);assert.equal(f.transcripts.get('human').canonicalMessageId,null);
});
test('whole 285s deadline rejects held authorization, and its late completion cannot start tools',async()=>{
 const f=fixture();let release,started;const waiting=new Promise(r=>started=r);f.clerk.sessions.getSession=()=>{started();return new Promise(r=>release=r);};const work=f.delegate();const rejected=assert.rejects(work,/timed out/);await waiting;f.advance(285001);await rejected;release({userId:'u',status:'active'});await new Promise(r=>setImmediate(r));assert.equal(f.fetches,0);
});
test('authorization/history time consumes fetch budget; too little confirmation margin prevents model call',async()=>{
 const f=fixture();f.clerk.sessions.getToken=async()=>{f.advance(274000);return{jwt:'test'};};await assert.rejects(f.delegate(),/not enough time/);assert.equal(f.fetches,0);
});
test('canonical binding requires saved exact owner/role/user text and captured speech identity',async()=>{
 for(const patch of [{conversationId:'foreign'},{role:'assistant'},{content:'Changed question'}]){const f=fixture();Object.assign(f.records.get('human'),patch);await assert.rejects(f.delegate(),/could not be confirmed saved/);assert.equal(f.finishes,0);}
 const f=fixture();f.ledger.getTranscript=()=>({role:'user',text:'Different request'});await assert.rejects(f.delegate(),/transcript could not be confirmed/);assert.equal(f.finishes,0);
});

test('whole deadline includes held response drain, with no late binding or completed cache',async()=>{
 const f=fixture();let stream;f.setTransport(async()=>new Response(new ReadableStream({start(controller){stream=controller;controller.enqueue(new TextEncoder().encode('data: {"type":"start","messageId":"a"}\n\n'));}})));
 const work=f.delegate();const rejected=assert.rejects(work,/timed out/);while(!stream)await new Promise(r=>setImmediate(r));f.advance(285001);await rejected;stream.close();await new Promise(r=>setImmediate(r));assert.equal(f.finishes,0);assert.equal(f.transcripts.get('human').canonicalMessageId,null);assert.equal(f.fetches,1);
});

test('relay delegates directly into the bounded authorization path under the 300s deployment cap',async()=>{
 const code=ts.transpileModule(readFileSync(new URL('../src/app/api/voice/live/relay/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const sessionId='00000000-0000-4000-8000-000000000001';let outerAuth=0,delegates=0;
 const mods={'zod':{z},'@clerk/nextjs/server':{auth:async()=>({userId:'u'})},'next/server':{NextResponse:{json:(body,init)=>Response.json(body,init)}},'@/lib/voice/live-http':{readLiveBody:req=>req.text()},'@/lib/voice/live-access':{canUseLiveVoice:async()=>true},'@/lib/voice/live-policy':{liveSecret:()=>'',validRelaySignature:()=>true},'@/lib/voice/live-runtime':{liveConfigured:()=>true,liveLedger:()=>({get:()=>({id:sessionId,userId:'u'})})},'@/lib/voice/live-backend':{authorizeLiveGrant:async()=>{outerAuth++;},delegateLiveTurn:async()=>{delegates++;return{assistantMessageId:'a',text:'safe'};},liveHistory:async()=>[]}};
 const exports={};vm.runInNewContext(code,{exports,require:name=>{if(!(name in mods))throw Error(name);return mods[name];},Date,JSON,Promise,Response,process:{env:{}},console});
 const send=op=>exports.POST(new Request('http://localhost/api/voice/live/relay',{method:'POST',headers:{'x-live-timestamp':String(Date.now()),'x-live-signature':'a'.repeat(64)},body:JSON.stringify({op,sessionId,...(op==='delegate'?{turnId:'00000000-0000-4000-8000-000000000002',userMessageId:'00000000-0000-4000-8000-000000000003',text:'Question'}:{})})}));
 assert.equal(exports.maxDuration,300);assert.equal((await send('delegate')).status,200);assert.equal(delegates,1);assert.equal(outerAuth,0);assert.equal((await send('authorize')).status,200);assert.equal(outerAuth,1);
});

test('281s approved-answer arrival cannot start a 5s SQLite bind or finish',async()=>{
 const f=fixture();const get=f.history.get;f.history.get=async(...args)=>{f.advance(281000);return get(...args);};let binds=0;f.ledger.bindTranscript=()=>{binds++;f.advance(5000);};await assert.rejects(f.delegate(),/not enough time/);assert.equal(binds,0);assert.equal(f.finishes,0);assert.equal(f.transcripts.get('human').canonicalMessageId,null);
});
test('time spent reading captured speech is included before reserving the bind write',async()=>{
 const f=fixture();const get=f.history.get;f.history.get=async(...args)=>{f.advance(276000);return get(...args);};const captured=f.ledger.getTranscript;f.ledger.getTranscript=(...args)=>{f.advance(5000);return captured(...args);};let binds=0;f.ledger.bindTranscript=()=>{binds++;};await assert.rejects(f.delegate(),/not enough time/);assert.equal(binds,0);assert.equal(f.finishes,0);
});
test('remaining grant lifetime must also cover SQLite mutation margin',async()=>{
 const f=fixture();f.grant.expiresAt=Date.now()+5000;await assert.rejects(f.delegate(),/not enough time/);assert.equal(f.turns.size,0);assert.equal(f.fetches,0);
});
test('deadline is rechecked after a synchronous current-grant read before any mutation',async()=>{
 const f=fixture();let reads=0;f.ledger.get=()=>{if(++reads===1)f.advance(286000);return f.grant;};await assert.rejects(f.delegate(),/timed out/);assert.equal(f.turns.size,0);assert.equal(f.fetches,0);
});

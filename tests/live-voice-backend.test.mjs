import assert from 'node:assert/strict';import test from 'node:test';import {readFileSync} from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
import { hasCurrentAiConsent } from '../src/lib/preferences-contract.ts';
const source=ts.transpileModule(readFileSync(new URL('../src/lib/voice/live-backend.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const bootstrapSource=ts.transpileModule(readFileSync(new URL('../src/app/api/voice/live/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function fixture(consent={aiConsentVersion:1,aiConsentAt:new Date()}){
 const grant={id:'g',userId:'u',clerkSessionId:'sid',conversationId:'c',expiresAt:Date.now()+60000,state:'active'};const records=new Map();let fetches=0;
 const ledger={get:()=>grant,claimTurn:()=>({claimed:true}),finishTurn:()=>{}};
 const clerk={sessions:{getSession:async()=>({userId:'u',status:'active'}),getToken:async()=>({jwt:'private-test-token'})}};
 const prisma={user:{findUnique:async({select})=>Object.fromEntries(Object.keys(select).map(key=>[key,consent[key]]))},conversation:{findFirst:async()=>({id:'c'}),update:async()=>({})},message:{findMany:async()=>[],findUnique:async({where})=>records.get(where.id),findFirst:async()=>({id:'a',content:'Verified answer',metadata:{parts:[]}}),upsert:async({where,create,update})=>{records.set(where.id,records.has(where.id)?{...records.get(where.id),...update}:create);}},$queryRaw:async()=>[], $transaction:async fn=>fn(prisma)};
 const mods={'@clerk/nextjs/server':{clerkClient:async()=>clerk},'@prisma/client':{Prisma:{}},'@/lib/prisma':{prisma},'@/lib/preferences-contract':{hasCurrentAiConsent},'@/lib/entitlements':{getUserPlan:async()=>'pro'},'./live-policy':{liveAppOrigin:()=> 'http://localhost:3144'},'./live-runtime':{liveLedger:()=>ledger}};
 const exports={};vm.runInNewContext(source,{exports,require:name=>{if(!(name in mods))throw Error(name);return mods[name];},Date,JSON,Promise,setTimeout,AbortSignal,TextDecoder,process:{env:{}},fetch:async()=>{fetches++;return new Response('data: {"type":"start","messageId":"a"}\n\ndata: [DONE]\n\n');}});
 return{api:exports,grant,clerk,records,get fetches(){return fetches;}};
}

function bootstrapFixture(consent){
 let reservations=0,selection;
 const ledger={reserve:()=>{reservations++;return{id:'g',expiresAt:Date.now()+60000};}};
 const mods={
  '@/lib/voice/live-http':{readLiveBody:async req=>req.text()},
  '@clerk/nextjs/server':{auth:async()=>({userId:'u',sessionId:'sid'})},
  'next/server':{NextResponse:{json:(body,init)=>Response.json(body,init)}},
  '@/lib/entitlements':{getUserPlan:async()=>'pro'},
  '@/lib/prisma':{prisma:{user:{findUnique:async query=>{selection=query.select;return consent;}},conversation:{findFirst:async()=>({id:'c'})}}},
  '@/lib/preferences-contract':{hasCurrentAiConsent},
  '@/lib/voice/live-policy':{liveLimits:()=>({sessionSeconds:60,dailySeconds:120,monthlySeconds:600}),liveRelayUrl:()=> 'ws://127.0.0.1:3145',liveSecret:()=> 'private-test-secret',signLiveTicket:()=> 'signed-test-ticket'},
  '@/lib/voice/live-runtime':{liveConfigured:()=>true,liveLedger:()=>ledger},
 };
 const exports={};vm.runInNewContext(bootstrapSource,{exports,require:name=>{if(!(name in mods))throw Error(name);return mods[name];},Date,JSON,Promise,URL,Response,process:{env:{}},console});
 return{api:exports,get reservations(){return reservations;},get selection(){return selection;}};
}

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
test('speech segments merge by identity and preserve canonical content, tools and existing user metadata',async()=>{
 const f=fixture();f.records.set('a',{id:'a',role:'assistant',conversationId:'c',content:'The authoritative KJV answer.',metadata:{parts:[{type:'tool-getPassage'}],readingTimezone:'America/Los_Angeles',inputMode:'live-voice'}});
 const first={messageId:'speech1',role:'assistant',text:'First spoken segment.',assistantMessageId:'a',complete:true,startMs:0,endMs:1000};await f.api.saveLiveTranscript(f.grant,first);
 await f.api.saveLiveTranscript(f.grant,{...first,messageId:'speech2',text:'Second spoken segment.',startMs:3000,endMs:4000});await f.api.saveLiveTranscript(f.grant,{...first,text:'First spoken segment corrected.'});
 const row=f.records.get('a');assert.equal(row.content,'The authoritative KJV answer.');assert.equal(row.metadata.readingTimezone,'America/Los_Angeles');assert.equal(row.metadata.inputMode,'live-voice');assert.equal(row.metadata.parts[0].type,'tool-getPassage');assert.equal(row.metadata.liveSpoken.segments.length,2);assert.equal(row.metadata.liveSpoken.segments.find(s=>s.id==='speech1').transcript,'First spoken segment corrected.');
});

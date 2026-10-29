import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {z} from 'zod';
import {relaySignature,validRelaySignature} from '../src/lib/voice/live-policy.ts';

const compile=path=>ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const source=compile('../src/lib/voice/live-access.ts');
const owner={id:'owner',primaryEmailAddressId:'primary',emailAddresses:[{id:'primary',emailAddress:'atmosphere9999@gmail.com',verification:{status:'verified'}}]};
function accessFixture(profile=owner,unavailable=false){
 const requested=[];const exports={};
 vm.runInNewContext(source,{exports,require:name=>{
  if(name==='server-only')return{};
  if(name==='@clerk/nextjs/server')return{clerkClient:async()=>({users:{getUser:async id=>{requested.push(id);if(unavailable)throw Error('Identity service unavailable');return profile;}}})};
  throw Error(name);
 }});
 return{api:exports,requested};
}

test('only the signed-in Clerk account with the verified owner primary email is allowed',async()=>{
 const f=accessFixture();assert.equal(f.api.isLiveVoiceOwner(owner,'owner'),true);assert.equal(await f.api.canUseLiveVoice('owner'),true);assert.deepEqual(f.requested,['owner']);
 assert.equal(f.api.isLiveVoiceOwner({...owner,emailAddresses:[{...owner.emailAddresses[0],emailAddress:'Atmosphere9999@Gmail.com'}]},'owner'),true);
});

test('other, unverified, secondary, missing and aliased addresses never grant owner access',()=>{
 const f=accessFixture();
 for(const profile of [
  null,{...owner,id:'another-account'},
  {...owner,primaryEmailAddressId:null},
  {...owner,emailAddresses:[]},
  {...owner,emailAddresses:[{...owner.emailAddresses[0],verification:{status:'unverified'}}]},
  {...owner,emailAddresses:[{...owner.emailAddresses[0],verification:null}]},
  {...owner,emailAddresses:[{...owner.emailAddresses[0],emailAddress:'someone-else@gmail.com'}]},
  {...owner,emailAddresses:[{...owner.emailAddresses[0],emailAddress:'atmosphere9999+other@gmail.com'}]},
  {...owner,emailAddresses:[{...owner.emailAddresses[0],emailAddress:'atmosphere.9999@gmail.com'}]},
  {...owner,primaryEmailAddressId:'other',emailAddresses:[...owner.emailAddresses,{id:'other',emailAddress:'someone-else@gmail.com',verification:{status:'verified'}}]},
 ])assert.equal(f.api.isLiveVoiceOwner(profile,'owner'),false);
 assert.equal(f.api.isLiveVoiceOwner(owner,''),false);
});

test('missing identity or an unavailable identity service fails closed',async()=>{
 const signedOut=accessFixture();assert.equal(await signedOut.api.canUseLiveVoice(''),false);assert.deepEqual(signedOut.requested,[]);
 assert.equal(await accessFixture(owner,true).api.canUseLiveVoice('owner'),false);
 assert.equal(await accessFixture(null).api.canUseLiveVoice('owner'),false);
});

function pageFixture(path,allowed){
 let renders=0;const exports={};
 const mods={
  '@clerk/nextjs/server':{auth:async()=>({userId:allowed?'owner':'other'})},
  'next/navigation':{notFound:()=>{throw Error('page_not_found');},redirect:path=>{throw Error('redirect:'+path);}},
  '@/lib/voice/live-access':{canUseLiveVoice:async()=>allowed},
  '@/components/voice/LiveVoiceTrial':{default:'voice-controls'},
  'react/jsx-runtime':{jsx:(type,props)=>{renders++;return{type,props};}},
 };
 const code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(code,{exports,require:name=>{if(!(name in mods))throw Error(name);return mods[name];}});
 return{page:exports.default,get renders(){return renders;}};
}

test('voice and legacy preview pages reject other accounts before rendering controls or redirecting',async()=>{
 for(const path of ['../src/app/voice/page.tsx','../src/app/voice-preview/page.tsx']){
  const f=pageFixture(path,false);await assert.rejects(f.page({searchParams:Promise.resolve({})}),/page_not_found/);assert.equal(f.renders,0);
 }
});

test('owner voice page carries the selected conversation and legacy page redirects to voice',async()=>{
 const f=pageFixture('../src/app/voice/page.tsx',true);const page=await f.page({searchParams:Promise.resolve({conversationId:'existing-chat'})});
 assert.equal(page.props.children.props.conversationId,'existing-chat');
 await assert.rejects(pageFixture('../src/app/voice-preview/page.tsx',true).page(),/redirect:\/voice/);
});

test('signed transcript RPC from another account cannot save even with a valid existing session grant',async()=>{
 const secret='test-only-voice-rpc-secret-longer-than-32-characters';let saved=0;
 const sessionId='73f174b2-b051-4aa5-9d15-c5e55b0d2c30';
 const body=JSON.stringify({op:'transcript',sessionId,messageId:'74f174b2-b051-4aa5-9d15-c5e55b0d2c31',role:'user',text:'Do not save this.',complete:true});
 const stamp=String(Date.now());
 const mods={
  '@clerk/nextjs/server':{auth:async()=>({userId:'other'})},'next/server':{NextResponse:{json:(body,init)=>Response.json(body,init)}},zod:{z},
  '@/lib/voice/live-http':{readLiveBody:async req=>req.text()},'@/lib/voice/live-access':{canUseLiveVoice:async()=>false},
  '@/lib/voice/live-policy':{liveSecret:()=>secret,validRelaySignature},
  '@/lib/voice/live-runtime':{liveConfigured:()=>true,liveLedger:()=>({get:()=>({id:sessionId,userId:'other',expiresAt:Date.now()+60000})})},
  '@/lib/voice/live-backend':{saveLiveTranscript:async()=>{saved++;}},
 };
 const exports={};vm.runInNewContext(compile('../src/app/api/voice/live/relay/route.ts'),{exports,require:name=>{if(!(name in mods))throw Error(name);return mods[name];},Date,JSON,Math,Response,process:{env:{}},console});
 const response=await exports.POST(new Request('http://localhost:3144/api/voice/live/relay',{method:'POST',headers:{'x-live-timestamp':stamp,'x-live-signature':relaySignature(body,stamp,secret)},body}));
 assert.equal(response.status,404);assert.equal(saved,0);
});

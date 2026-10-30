import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import * as rules from '../src/lib/onboarding-rules.ts';
const compiled=ts.transpileModule(readFileSync(new URL('../src/lib/onboarding-voice.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function fixture(options={}){
 const state={raw:'UNCHECKED OLDER ANSWER',checked:'This saved answer needs checking.',reads:0,exists:true,reserves:0,synthesis:0};
 const row=()=>state.exists?{id:'answer',role:'assistant',content:state.raw,metadata:{parts:[{type:'text',text:state.raw}]} }:null;
 const modules={'server-only':{},'node:crypto':{createHash},'@vercel/blob':{head:async()=>{if(options.cached===false)throw Error('not cached');return{};},put:async()=>({})},'@/lib/prisma':{prisma:{user:{findUnique:async()=>({onboardingConversationId:'welcome'}),updateMany:async query=>{state.reserves++;assert.deepEqual(query.where.aiConsentVersion,{gte:1});assert.deepEqual(query.where.aiConsentAt,{not:null});return{count:options.consent===false?0:1};}},message:{findFirst:async query=>{assert.equal(query.where.conversationId,'welcome');assert.equal(query.where.conversation.userId,'owner');return row();}}}},'@/lib/daily-cross-audio':{synthesizeSpeech:async()=>{state.synthesis++;return Buffer.from('test');}},'@/lib/daily-cross-audio-script':{isSpeechConfigured:()=>true},'@/lib/daily-cross-voices':{defaultNarrationVoiceId:()=> 'test-voice'},'@/lib/onboarding-rules':rules,'@/lib/ai/history/read-boundary.server':{readReviewedHistoryRow:async(owner,locator,source)=>{assert.equal(owner,'owner');assert.equal(locator.messageId,source.id);assert.equal(locator.parentId,'welcome');state.reads++;return{...source,content:state.checked};}}};
 const module={exports:{}};new Function('require','module','exports','process',compiled)(id=>{if(!(id in modules))throw Error('Unexpected dependency '+id);return modules[id];},module,module.exports,{env:{ONBOARDING_ELEVENLABS_DISABLED:options.disabled===false?'false':'true'}});
 return{state,api:module.exports};
}
const key=text=>createHash('sha256').update(`test-voice\neleven_flash_v2_5\n${text}`).digest('hex').slice(0,40);
test('older generated welcome replies speak only the owned safe projection',async()=>{
 const f=fixture();const result=await f.api.requestOnboardingVoice('owner',{messageId:'answer'});
 assert.equal(result.status,'device');assert.equal(result.text,f.state.checked);assert.equal(f.state.reads,1);assert.equal(JSON.stringify(result).includes('UNCHECKED'),false);
 f.state.raw=rules.SCRIPTED_LINES[0];const scripted=await f.api.requestOnboardingVoice('owner',{messageId:'answer'});assert.equal(scripted.text,rules.spokenText(f.state.raw));assert.equal(f.state.reads,1);
});
test('cached personal audio cannot replay unchecked or stale source bytes',async()=>{
 const f=fixture();assert.equal(await f.api.checkedOnboardingStreamPath('owner','mine-'+key(f.state.raw),'answer'),null);
 const checked='mine-'+key(f.state.checked);assert.equal(await f.api.checkedOnboardingStreamPath('owner',checked,'answer'),`onboarding-voice/owner/${key(f.state.checked)}.mp3`);
 assert.equal(await f.api.checkedOnboardingStreamPath('owner',checked,null),null);
 f.state.checked='A different checked answer.';assert.equal(await f.api.checkedOnboardingStreamPath('owner',checked,'answer'),null);
 f.state.exists=false;assert.equal(await f.api.checkedOnboardingStreamPath('owner','mine-'+key(f.state.checked),'answer'),null);
});
test('shared audio keys are confined to current literal scripted lines',async()=>{
 const f=fixture(),text=rules.SCRIPTED_LINES[0],scriptedKey=createHash('sha256').update(`test-voice\neleven_multilingual_v2\n${text}`).digest('hex').slice(0,40);
 assert.equal(await f.api.checkedOnboardingStreamPath('owner','shared-'+scriptedKey,null),`onboarding-voice/shared/${scriptedKey}.mp3`);
 assert.equal(await f.api.checkedOnboardingStreamPath('owner','shared-'+'a'.repeat(40),null),null);assert.equal(f.state.reads,0);
});

test('new personal narration requires consent at atomic reservation while cached/device speech remains available',async()=>{
 const off=fixture({disabled:false,cached:false,consent:false});const blocked=await off.api.requestOnboardingVoice('owner',{messageId:'answer'});
 assert.equal(blocked.status,'device');assert.equal(blocked.text,off.state.checked);assert.equal(off.state.reserves,1);assert.equal(off.state.synthesis,0);
 const allowed=fixture({disabled:false,cached:false,consent:true});assert.equal((await allowed.api.requestOnboardingVoice('owner',{messageId:'answer'})).status,'ready');assert.equal(allowed.state.synthesis,1);
 const cached=fixture({disabled:false,consent:false});assert.equal((await cached.api.requestOnboardingVoice('owner',{messageId:'answer'})).status,'ready');assert.equal(cached.state.reserves,0);assert.equal(cached.state.synthesis,0);
});

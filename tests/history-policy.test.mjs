import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {loadHistoryModule}from'./history-loader.mjs';
const {createHistoryPolicyLoader}=await loadHistoryModule('src/lib/ai/history/policy.ts');
const models=await loadHistoryModule('src/lib/ai/models.ts');
function transaction({plan='free',subscription=null,owner='u'}={}){const calls=[];return{calls,currentTime:async()=>new Date('2026-10-29T12:00:00Z'),readPolicySnapshot:async()=>{calls.push('db-read');return{user:{id:owner,plan,aiConsentVersion:1,aiConsentAt:new Date()},subscription};}};}
const config={usageEnabled:true,openrouterAvailable:false,proUserIds:[],serverCredentialUserIds:[]};
test('history identity binds the durable note conversion dependencies',async()=>{
 const {HISTORY_SOURCE_MANIFEST}=await loadHistoryModule('src/lib/ai/history/manifest.ts');
 for(const path of ['src/lib/notes-io.ts','src/lib/markdown.ts','src/lib/note-plain-text.mjs','src/lib/note-plain-text.d.mts']){
  const hash=createHash('sha256').update(readFileSync(new URL('../'+path,import.meta.url))).digest('hex');
  assert.equal(HISTORY_SOURCE_MANIFEST.implementation[path],hash,path+' must invalidate stale policy identity after a conversion change');
 }
});
test('policy uses DB-only snapshot, actual registry head and actual pricing',async()=>{for(const plan of ['free','pro']){const tx=transaction({plan}),p=await createHistoryPolicyLoader(config)(tx,'u');const definition=models.resolveDefinition(models.houseChatModelId(plan,{openrouter:false}));assert.equal(p.reviewerModelId,definition.id);assert.deepEqual(p.reviewer.pricing,definition.pricing);assert.deepEqual(tx.calls,['db-read']);assert.equal(p.entitlement.plan,plan);assert.equal(p.meter,'background-utility');}});
test('cached active subscription and both existing allowlists grant Pro without refresh',async()=>{for(const mode of ['subscription','pro-allowlist','owner-allowlist']){const tx=transaction({subscription:mode==='subscription'?{status:'active',periodEnd:new Date('2026-11-29Z'),provider:'google-play',purchaseToken:'NEVER IN POLICY'}:null});const p=await createHistoryPolicyLoader({...config,proUserIds:mode==='pro-allowlist'?['u']:[],serverCredentialUserIds:mode==='owner-allowlist'?['u']:[]})(tx,'u');assert.equal(p.entitlement.plan,'pro');assert.equal(JSON.stringify(p).includes('NEVER IN POLICY'),false);assert.deepEqual(tx.calls,['db-read']);}});
test('lapsed subscription uses existing stored-plan fallback, not a network renewal',async()=>{const tx=transaction({plan:'free',subscription:{status:'active',periodEnd:new Date('2026-10-28Z'),provider:'google-play'}});const p=await createHistoryPolicyLoader(config)(tx,'u');assert.equal(p.entitlement.plan,'free');assert.equal(p.entitlement.activeSubscription,false);assert.deepEqual(tx.calls,['db-read']);});
test('policy ownership mismatch is rejected and NKJV has no invented corpus identity',async()=>{await assert.rejects(createHistoryPolicyLoader(config)(transaction({owner:'other'}),'u'),e=>e.code==='not_found');const p=await createHistoryPolicyLoader(config)(transaction(),'u');assert.equal(p.supportedTranslations.includes('NKJV'),true);assert.equal(p.externalSourceIdentities.NKJV.kind,'remote-chapter');assert.match(p.externalSourceIdentities.NKJV.scope,/no complete remote corpus/);assert.equal('NKJV'in p.corpusIdentity,false);assert.equal(p.core.foundationDigest,'d94fb1749d77ce12b4fa429944bc8eefed974f227a51c0ec2226e3f38cfaa237');});

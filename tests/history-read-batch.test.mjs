import test from 'node:test';
import assert from 'node:assert/strict';
import {readHistoryBatch,createCanonicalReadCapture} from '../src/lib/ai/history/read-batch.mjs';
import {createHistoryReadSnapshot} from '../src/lib/ai/history/read-snapshot.mjs';
import {createHistoryService} from '../src/lib/ai/history/service.mjs';
import {createFreshHistoryProof} from '../src/lib/ai/history/fresh-proof.mjs';
import {CORE_VERSION,FIXED_NOTICES,canonicalJSON} from '../src/lib/ai/history/projection.mjs';
import {FakeRepository} from './history-fake-repository.mjs';
import {loadHistoryModule} from './history-loader.mjs';
const {historyRenderer:renderer}=await loadHistoryModule('src/lib/ai/history/renderer.ts');
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const copy=value=>structuredClone(value),owner='owner',parentId='parent',surface='chat';
const locator={surface,parentId,messageId:'a'};
const check=async text=>({ok:true,text,references:[]});
async function fixture(prepared=false){
 const db=new FakeRepository();db.addUser(owner);db.addParent(surface,parentId,owner);db.clock=()=>new Date('2026-10-30T02:00:00Z');
 const reviewer={id:'current-reviewer',provider:'openai',providerModelId:'synthetic-model',pricing:{input:1,output:2},supportsAttachments:true};
 const policy={core:{contractVersion:1,projectorVersion:CORE_VERSION,rendererDigest:renderer.digest,checkerVersion:'checker',corpusDigest:'a'.repeat(64),foundationDigest:'b'.repeat(64),fixedNoticesVersion:1},supportedTranslations:['KJV','NKJV'],externalSourceIdentities:{NKJV:{kind:'synthetic-source'}},reviewerModelId:reviewer.id};
 const question={id:'q',role:'user',content:'The exact saved question.',metadata:null,conversationId:parentId,createdAt:'2026-10-30T00:00:01.000Z',...(prepared?{hasAttachments:true}:{})};
 db.put(surface,parentId,question);
 const pass=async input=>{await input.authorizeInference();return{verified:true,canonicalPassed:true,semanticPassed:true,repaired:false,blocks:input.blocks,reviewerModelId:input.policy.reviewerModelId};};
 const options={renderer,loadCurrentPolicy:async()=>copy(policy),validateFreshReviewer:identity=>canonicalJSON(identity)===canonicalJSON(reviewer)};
 const seed=createHistoryService({...options,repository:db,verifyOnly:pass,verifyCanonical:check,loadCanonicalChapter:async()=>['Synthetic canonical words']});
 const draft={content:'An approved synthetic answer.',metadata:{translation:'NKJV',parts:[{type:'text',text:'An approved synthetic answer.'}]},actions:[]};
 if(prepared){
  const file={id:'file',userId:owner,messageId:'q',pathname:'private/file',filename:'file.png',mediaType:'image/png',size:100,etag:'etag',status:'READY',transcript:null,durationSeconds:null,previewUrl:'https://private.invalid/file'};db.attachments.set(file.id,copy(file));
  draft.preparedRequest=await seed.prepareRequest(owner,locator,{sources:[question],messages:[{id:'q',role:'user',parts:[{type:'file',url:file.previewUrl,filename:file.filename,mediaType:file.mediaType},{type:'text',text:question.content}]}],attachments:[file],mediaParts:[{type:'file',data:new URL(file.previewUrl),filename:file.filename,mediaType:file.mediaType}],reviewer,systemContext:'Complete synthetic request.',review:pass});
  const preparation=await seed.prepareFresh(owner,locator,draft);await seed.certifyFresh(owner,locator,createFreshHistoryProof(preparation.ticket,await seed.reviewFresh(preparation)));
 }else{
  db.put(surface,parentId,{id:'a',role:'assistant',...draft,conversationId:parentId,createdAt:'2026-10-30T00:00:02.000Z'});
  const before=await seed.get(owner,locator);assert.equal((await seed.recheck(owner,locator,before.body.sourceDigest)).status,200);
 }
 let snapshots=0,ordinaryInference=0;
 const loadSnapshot=async()=>{
  snapshots++;
  if(!db.users.has(owner)||db.parents.get(surface+':'+parentId)?.ownerId!==owner)return null;
  const records=[...db.reviews.values()];
  return createHistoryReadSnapshot({ownerId:owner,surface,parentId,parent:{id:parentId,userId:owner,title:'Current owned parent'},user:{id:owner,plan:'free',aiConsentVersion:1,aiConsentAt:new Date()},subscription:null,currentTime:db.clock(),rows:[...db.messages.values()].filter(v=>v.surface===surface&&v.parentId===parentId).map(v=>v.row).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id)),attachments:[...db.attachments.values()],reviews:records.sort((a,b)=>new Date(b.checkedAt)-new Date(a.checkedAt)||new Date(b.createdAt)-new Date(a.createdAt)),actionReviewIds:records.map(row=>row.id)},{hasCurrentAiConsent:()=>true});
 };
 const createService=(snapshot,canonical)=>createHistoryService({...options,repository:snapshot.repository,...canonical,verifyOnly:async()=>{ordinaryInference++;throw Error('Ordinary reads cannot infer');}});
 return{db,policy,loadSnapshot,createService,snapshots:()=>snapshots,inference:()=>ordinaryInference,read:settings=>readHistoryBatch({ownerId:owner,surface,parentId,loadSnapshot,createService,verifyCanonical:check,loadCanonicalChapter:async()=>['Synthetic canonical words'],...settings})};
}
test('two-phase approved read releases only cache-only results from a second owned snapshot',async()=>{
 const f=await fixture(),entered=deferred(),release=deferred();let calls=0,done=false;
 const pending=f.read({verifyCanonical:async text=>{assert.equal(f.db.depth.get(owner)??0,0);calls++;if(calls===1){entered.resolve();await release.promise;}return check(text);}}).then(result=>{done=true;return result;});
 await entered.promise;assert.equal(done,false);assert.equal(f.snapshots(),1);release.resolve();const batch=await pending;
 assert.equal(f.snapshots(),2);const before=calls;assert.equal((await batch.service.get(owner,locator)).body.state,'verified');assert.equal(calls,before,'Final replay must not fetch or invoke canonical checking');assert.equal(f.inference(),0);
});
for(const mutation of ['source','prefix','attachment','owner','delete-target','delete-parent','delete-owner','policy'])test(`mutation during canonical capture cannot release provisional approval: ${mutation}`,async()=>{
 const f=await fixture(mutation==='attachment'),entered=deferred(),release=deferred();let calls=0;
 const pending=f.read({verifyCanonical:async text=>{calls++;if(calls===1){entered.resolve();await release.promise;}return check(text);}});
 await entered.promise;
 if(mutation==='source'){const row=f.db.messages.get('a').row;row.content='Changed current source.';row.metadata.parts[0].text=row.content;}
 if(mutation==='prefix')f.db.messages.get('q').row.content='Changed current question.';
 if(mutation==='attachment')f.db.attachments.get('file').etag='changed-bytes';
 if(mutation==='owner')f.db.parents.get(surface+':'+parentId).ownerId='foreign';
 if(mutation==='delete-target')f.db.deleteMessage('a');
 if(mutation==='delete-parent')f.db.deleteParent(surface,parentId);
 if(mutation==='delete-owner')f.db.deleteUser(owner);
 if(mutation==='policy')f.policy.core.checkerVersion='new-checker';
 release.resolve();const batch=await pending;assert.equal(f.snapshots(),2);assert.equal(f.inference(),0);
 if(['owner','delete-parent','delete-owner'].includes(mutation)){assert.equal(batch,null);return;}
 const before=calls,result=await batch.service.get(owner,locator);assert.equal(calls,before);
 if(mutation==='delete-target'){assert.equal(result.status,404);assert.equal(batch.rows.some(row=>row.id==='a'),false);}
 else{assert.equal(result.body.state,'withheld');assert.equal(result.body.row.content.includes('An approved synthetic answer.'),false);assert.match(result.body.sourceDigest,/^[a-f0-9]{64}$/);}
});
test('timed-out and late canonical work cannot populate the frozen cache or arm more fetches',async()=>{
 const f=await fixture(),entered=deferred(),release=deferred();let calls=0;
 const pending=f.read({captureMs:10,verifyCanonical:async text=>{calls++;entered.resolve();await release.promise;return check(text);}});
 await entered.promise;const batch=await pending;assert.equal(batch.externalCapture.timedOut,true);assert.equal(f.snapshots(),2);
 assert.equal((await batch.service.get(owner,locator)).body.state,'withheld');const before=calls;release.resolve();await tick();await tick();
 assert.equal((await batch.service.get(owner,locator)).body.state,'withheld');assert.equal(calls,before);assert.equal(f.inference(),0);
});
test('a missing fresh checkpoint never falls back to the provisional source',async()=>{
 const f=await fixture();let reads=0;await assert.rejects(f.read({requestMs:30,captureMs:10,freshReserveMs:1,loadSnapshot:async()=>++reads===1?f.loadSnapshot():new Promise(()=>{})}),/verification_timeout/);
 assert.equal(f.inference(),0);
});
for(const kind of ['fixed','unapproved','bundled'])test(`${kind} ordinary page keeps one-snapshot provider-free fastpath`,async()=>{
 const f=await fixture(),row=f.db.messages.get('a').row;
 if(kind==='fixed'){row.content=Object.values(FIXED_NOTICES)[0];row.metadata.parts=[{type:'text',text:row.content}];}
 if(kind==='unapproved')f.db.reviews.clear();
 if(kind==='bundled')row.metadata.translation='KJV';
 const batch=await f.read({verifyCanonical:async()=>{throw Error('Fastpath must not fetch canonical');},loadCanonicalChapter:async()=>{throw Error('Fastpath must not fetch chapter');}});
 assert.equal(f.snapshots(),1);assert.equal(batch.externalCapture,null);assert.equal(f.inference(),0);
});
test('canonical dedupe uses exact text+edition and chapter coordinates, returns isolated values',async()=>{
 let texts=0,words=0;const capture=createCanonicalReadCapture({verifyCanonical:async text=>{texts++;return check(text);},loadCanonicalChapter:async()=>{words++;return['Words'];}});
 const [a,b]=await Promise.all([capture.live.verifyCanonical('same',{translation:'NKJV'}),capture.live.verifyCanonical('same',{translation:'NKJV'})]);assert.equal(texts,1);a.text='Caller mutation';assert.equal(b.text,'same');
 await capture.live.verifyCanonical('same',{translation:'KJV'});await capture.live.verifyCanonical('same ',{translation:'NKJV'});assert.equal(texts,3);
 await Promise.all([capture.live.loadCanonicalChapter('NKJV',43,3),capture.live.loadCanonicalChapter('NKJV',43,3)]);assert.equal(words,1);
 const frozen=capture.freeze();const read=await frozen.loadCanonicalChapter('NKJV',43,3);read[0]='Mutated';assert.deepEqual(await frozen.loadCanonicalChapter('NKJV',43,3),['Words']);await assert.rejects(frozen.loadCanonicalChapter('NKJV',43,4));await assert.rejects(capture.live.verifyCanonical('new',{translation:'NKJV'}));assert.equal(texts,3);assert.equal(words,1);
});
test('late chapters and inconsistent chapter versions cannot authorize cache-only replay',async()=>{
 const release=deferred();let calls=0;const capture=createCanonicalReadCapture({verifyCanonical:async text=>({ok:true,text,references:[{verses:[{order:43,chapter:3,verse:1,text:'Old words'}]}]}),loadCanonicalChapter:async()=>{calls++;return release.promise;}});
 await capture.live.verifyCanonical('quote',{translation:'NKJV'});const pending=capture.live.loadCanonicalChapter('NKJV',43,3);await tick();const frozen=capture.freeze();release.resolve(['Old words']);await pending;await assert.rejects(frozen.verifyCanonical('quote',{translation:'NKJV'}));await assert.rejects(frozen.loadCanonicalChapter('NKJV',43,3));assert.equal(calls,1);
 const mismatch=createCanonicalReadCapture({verifyCanonical:async text=>({ok:true,text,references:[{verses:[{order:43,chapter:3,verse:1,text:'Old words'}]}]}),loadCanonicalChapter:async()=>['New words']});await mismatch.live.verifyCanonical('quote',{translation:'NKJV'});await mismatch.live.loadCanonicalChapter('NKJV',43,3);await assert.rejects(mismatch.freeze().verifyCanonical('quote',{translation:'NKJV'}));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createHistoryService} from '../src/lib/ai/history/service.mjs';
import {createFreshHistoryProof} from '../src/lib/ai/history/fresh-proof.mjs';
import {CORE_VERSION,FIXED_NOTICES} from '../src/lib/ai/history/projection.mjs';
import {FakeRepository} from './history-fake-repository.mjs';
import {loadHistoryModule} from './history-loader.mjs';
const {historyRenderer:renderer}=await loadHistoryModule('src/lib/ai/history/renderer.ts');
const locator={surface:'chat',parentId:'conversation',messageId:'answer'};
function fixture({externalMs,tooMany=false,hang=false}={}){
 const db=new FakeRepository();db.addUser('owner');db.addParent('chat','conversation','owner');db.clock=()=>new Date('2026-10-30T00:00:03Z');
 db.put('chat','conversation',{id:'question',role:'user',content:'Explain this passage.',metadata:null,createdAt:'2026-10-30T00:00:01.000Z'});
 const identity={kind:'remote-chapter',edition:'NKJV',endpoint:'https://bolls.life/get-chapter/NKJV/{order}/{chapter}/',scope:'Exact requested whole-chapter byte hashes only; not a bundled corpus'};
 const policy={core:{contractVersion:1,projectorVersion:CORE_VERSION,rendererDigest:renderer.digest,checkerVersion:'checker',corpusDigest:'a'.repeat(64),foundationDigest:'b'.repeat(64),fixedNoticesVersion:1},supportedTranslations:['KJV','NKJV'],externalSourceIdentities:{NKJV:identity},reviewerModelId:'approved'};
 let words=['Remote canonical chapter version one.'],unavailable=false,canonicalCalls=0,chapterCalls=0,reviews=0;
 const service=createHistoryService({repository:db,renderer,loadCurrentPolicy:async()=>structuredClone(policy),externalMs,
  verifyCanonical:async(text)=>{assert.equal(db.depth.get('owner'),0);canonicalCalls++;return{ok:true,text,references:text.includes('John 3:16')?[{reference:'John 3:16',canonicalText:words[0],verses:Array.from({length:tooMany?25:1},(_,i)=>({order:43,chapter:tooMany?i+1:3,verse:16,text:words[0]}))}]:[]};},
  loadCanonicalChapter:async()=>{assert.equal(db.depth.get('owner'),0);chapterCalls++;if(hang)return new Promise(()=>{});if(unavailable)throw Error('Controlled remote outage');return structuredClone(words);},
  verifyOnly:async input=>{assert.equal(db.depth.get('owner'),0);await input.authorizeInference();reviews++;assert.equal(input.policy.externalEvidence.translation,'NKJV');assert.equal(input.policy.externalEvidence.sourceIdentity.endpoint,identity.endpoint);return{verified:true,canonicalPassed:true,semanticPassed:true,repaired:false,blocks:input.blocks,reviewerModelId:'approved'};},
 });
 const draft={content:'Consider John 3:16.',metadata:{translation:'NKJV',parts:[{type:'text',text:'Consider John 3:16.'}]},actions:[]};
 return{db,service,draft,identity,change:()=>words=['Remote canonical chapter version two.'],outage:()=>unavailable=true,counts:()=>({canonicalCalls,chapterCalls,reviews}),async save(){const prepared=await service.prepareFresh('owner',locator,draft);const approval=await service.reviewFresh(prepared);return service.certifyFresh('owner',locator,createFreshHistoryProof(prepared.ticket,approval));}};
}

test('NKJV fresh and GET bind exact requested whole-chapter bytes outside DB and never claim a corpus sweep',async()=>{
 const f=fixture();const saved=await f.save();assert.equal(saved.state,'verified');
 assert.equal((await f.service.get('owner',locator)).body.state,'verified');assert.equal(f.counts().reviews,1);
 const record=[...f.db.reviews.values()][0];assert.equal(record.state,'verified');
 f.change();const stale=await f.service.get('owner',locator);assert.equal(stale.body.state,'withheld');assert.equal(stale.body.row.content.includes(f.draft.content),false);assert.equal(f.counts().reviews,1);
 const checked=await f.service.recheck('owner',locator,stale.body.sourceDigest);assert.equal(checked.status,200);assert.equal(f.counts().reviews,2);assert.equal((await f.service.get('owner',locator)).body.state,'verified');
 assert.equal(f.identity.kind,'remote-chapter');assert.match(f.identity.scope,/not a bundled corpus/);
});

test('NKJV remote outage withholds without model work or raw text and leaves original downloadable',async()=>{
 const f=fixture();await f.save();f.outage();const result=await f.service.get('owner',locator);
 assert.equal(result.status,200);assert.equal(result.body.state,'withheld');assert.equal(result.body.row.content.includes(f.draft.content),false);assert.equal(f.counts().reviews,1);
 assert.ok((await f.service.download('owner',locator)).body.includes(f.draft.content));
});

test('NKJV source change between final review and commit prevents provisional/source writes',async()=>{
 const f=fixture();const prepared=await f.service.prepareFresh('owner',locator,f.draft);const approval=await f.service.reviewFresh(prepared);f.change();
 await assert.rejects(f.service.certifyFresh('owner',locator,createFreshHistoryProof(prepared.ticket,approval)),e=>e.code==='source_changed');
 assert.equal(f.db.messages.has('answer'),false);assert.equal(f.db.reviews.size,0);
});

test('exact NKJV fixed notice needs no canonical fetch, model or existing sidecar',async()=>{
 const f=fixture();f.outage();f.draft.content=FIXED_NOTICES.unavailableEnglish;f.draft.metadata.parts=[{type:'text',text:f.draft.content}];
 const prepared=await f.service.prepareFresh('owner',locator,f.draft);assert.equal(prepared.noticeOnly,true);
 await f.service.certifyFresh('owner',locator,createFreshHistoryProof(prepared.ticket,null));
 assert.equal((await f.service.get('owner',locator)).body.state,'notice');assert.deepEqual(f.counts(),{canonicalCalls:0,chapterCalls:0,reviews:0});
});

test('remote chapter count and whole-capture deadline fail closed before inference',async()=>{
 const many=fixture({tooMany:true});await assert.rejects(many.service.prepareFresh('owner',locator,many.draft),e=>e.code==='context_limit');assert.equal(many.counts().chapterCalls,0);assert.equal(many.counts().reviews,0);
 const slow=fixture({hang:true,externalMs:5});const hold=setTimeout(()=>{},1000);try{await assert.rejects(slow.service.prepareFresh('owner',locator,slow.draft),e=>e.code==='verification_timeout');}finally{clearTimeout(hold);}assert.equal(slow.counts().reviews,0);assert.equal(slow.db.messages.has('answer'),false);
});

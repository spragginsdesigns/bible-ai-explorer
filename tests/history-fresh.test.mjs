import test from 'node:test';
import assert from 'node:assert/strict';
import {createHistoryService} from '../src/lib/ai/history/service.mjs';
import {createFreshHistoryProof} from '../src/lib/ai/history/fresh-proof.mjs';
import {CORE_VERSION,FIXED_NOTICES} from '../src/lib/ai/history/projection.mjs';
import {FakeRepository} from './history-fake-repository.mjs';
import {loadHistoryModule} from './history-loader.mjs';

const {historyRenderer:renderer}=await loadHistoryModule('src/lib/ai/history/renderer.ts');
const locator={surface:'chat',parentId:'conversation',messageId:'assistant'};
function fixture(){
 const db=new FakeRepository();db.addUser('owner');db.addParent('chat','conversation','owner');
 db.clock=()=>new Date('2026-10-30T00:00:03.000Z');
 db.put('chat','conversation',{id:'question',role:'user',content:'A private question used only transiently.',metadata:null,conversationId:'conversation',createdAt:'2026-10-30T00:00:01.000Z'});
 const policy={core:{contractVersion:1,projectorVersion:CORE_VERSION,rendererDigest:renderer.digest,checkerVersion:'checker',corpusDigest:'a'.repeat(64),foundationDigest:'b'.repeat(64),fixedNoticesVersion:1},supportedTranslations:['KJV','BSB','ASV','RV1909','LUT1912'],reviewerModelId:'approved-reviewer'};
 let calls=0;
 const service=createHistoryService({repository:db,renderer,loadCurrentPolicy:async()=>structuredClone(policy),
  verifyOnly:async input=>{assert.equal(db.depth.get('owner'),0);await input.authorizeInference();calls++;return{verified:true,canonicalPassed:true,semanticPassed:true,repaired:false,blocks:input.blocks,reviewerModelId:'approved-reviewer'};},
  verifyCanonical:async()=>({ok:true,references:[{canonicalText:'Exact canonical text.'}]}),
 });
 const draft={content:'I can keep studying Scripture.',metadata:{translation:'KJV',parts:[{type:'text',text:'I can keep studying Scripture.'}]},actions:[]};
 return{db,policy,service,draft,calls:()=>calls,async proof(){const prepared=await service.prepareFresh('owner',locator,draft);return{prepared,proof:createFreshHistoryProof(prepared.ticket,prepared.noticeOnly?null:await service.reviewFresh(prepared))};}};
}

test('fresh preparation makes no source/sidecar/provider write and final commit matches readback',async()=>{
 const f=fixture();const prepared=await f.service.prepareFresh('owner',locator,f.draft);
 assert.equal(f.db.messages.has('assistant'),false);assert.equal(f.db.reviews.size,0);assert.equal(f.calls(),0);
 const approval=await f.service.reviewFresh(prepared);assert.equal(f.calls(),1);
 const proof=createFreshHistoryProof(prepared.ticket,approval);
 const saved=await f.service.certifyFresh('owner',locator,proof);
 assert.equal(saved.state,'verified');assert.equal(saved.row.content,f.draft.content);assert.equal(f.calls(),1);
 const read=await f.service.get('owner',locator);assert.equal(read.body.state,'verified');assert.deepEqual(read.body.row,saved.row);assert.equal(f.calls(),1);
 assert.equal(JSON.stringify([...f.db.reviews.values()]).includes('A private question'),false);
});

test('JSON certificates, omitted or rewritten final fields and wrong reviewer never mint fresh proof',async()=>{
 const f=fixture();await assert.rejects(f.service.certifyFresh('owner',locator,{}));
 const prepared=await f.service.prepareFresh('owner',locator,f.draft);const approval=await f.service.reviewFresh(prepared);
 for(const changed of [{...approval,blocks:[]},{...approval,blocks:approval.blocks.map(b=>({...b,text:'Different final bytes'}))},{...approval,reviewerModelId:'another-model'},{...approval,semanticPassed:false},{...approval,canonicalPassed:false},{...approval,verified:false}])assert.throws(()=>createFreshHistoryProof(prepared.ticket,changed));
 assert.throws(()=>createFreshHistoryProof({},approval));assert.throws(()=>createFreshHistoryProof(prepared.ticket,null));
 assert.equal(f.db.messages.has('assistant'),false);
});

test('fresh source/prefix/policy/consent changes cannot save or certify a stale answer',async()=>{
 for(const kind of ['prefix','policy','consent','source','owner']){
  const f=fixture();const {proof}=await f.proof();
  if(kind==='prefix')f.db.messages.get('question').row.content='Corrected question';
  if(kind==='policy')f.policy.core.checkerVersion='changed-checker';
  if(kind==='consent')f.db.users.get('owner').consent=false;
  if(kind==='source')f.db.put('chat','conversation',{id:'assistant',role:'assistant',content:'A newer saved answer.',metadata:{translation:'KJV',parts:[{type:'text',text:'A newer saved answer.'}]},createdAt:'2026-10-30T00:00:02.000Z'});
  await assert.rejects(f.service.certifyFresh(kind==='owner'?'foreign':'owner',locator,proof));
  assert.equal(f.db.reviews.size,0);assert.equal(f.db.messages.has('assistant'),kind==='source');
 }
});

test('same-ID overwrite preserves the original target and never archives its private prefix',async()=>{
 const f=fixture();f.db.put('chat','conversation',{id:'assistant',role:'assistant',content:'Original saved answer.',metadata:{translation:'KJV',parts:[{type:'text',text:'Original saved answer.'}]},createdAt:'2026-10-30T00:00:02.000Z'});
 const {proof}=await f.proof();await f.service.certifyFresh('owner',locator,proof);
 const snapshots=[...f.db.reviews.values()].map(r=>r.sourceSnapshot.row.content);
 assert.ok(snapshots.includes('Original saved answer.'));assert.ok(snapshots.includes(f.draft.content));
 assert.equal(JSON.stringify([...f.db.reviews.values()]).includes('A private question'),false);
 const original=await f.service.download('owner',locator);assert.ok(original.body.includes('Original saved answer.'));
});

test('actual server tool result attestations preserve truthful fresh receipts on later GET',async()=>{
 const f=fixture(),output={noteId:'owned-note',noteTitle:'My study',created:true,appendedHtml:'Owned saved content'};
 f.draft.metadata.parts.push({type:'tool-addToNote',toolCallId:'save',state:'output-available',input:{},output});
 f.draft.actions=[{tool:'addToNote',toolCallId:'save',success:true,output:structuredClone(output)}];
 const {proof}=await f.proof();const saved=await f.service.certifyFresh('owner',locator,proof);
 assert.equal(saved.state,'verified');assert.equal(saved.row.metadata.parts[1].output.noteId,'owned-note');assert.equal('appendedHtml'in saved.row.metadata.parts[1].output,false);
 assert.deepEqual((await f.service.get('owner',locator)).body.row,saved.row);
 assert.equal(f.calls(),1);assert.ok([...f.db.reviews.values()][0].freshEvidence.actions[0].outputDigest);
});

test('missing, changed or duplicate execution attestations never approve a receipt',async()=>{
 for(const kind of ['missing','changed','duplicate']){
  const f=fixture(),output={noteId:'owned-note',noteTitle:'My study',created:true};
  f.draft.metadata.parts.push({type:'tool-addToNote',toolCallId:'save',state:'output-available',output});
  const event={tool:'addToNote',toolCallId:'save',success:true,output:kind==='changed'?{...output,noteId:'different-note'}:output};
  f.draft.actions=kind==='missing'?[]:kind==='duplicate'?[event,event]:[event];
  await assert.rejects(f.service.prepareFresh('owner',locator,f.draft),e=>e.code==='action_proof_missing');
  assert.equal(f.calls(),0);assert.equal(f.db.messages.has('assistant'),false);
 }
});

test('only exact fixed notice uses provider-free fresh proof; notice plus extras still needs full review',async()=>{
 const f=fixture();f.db.users.get('owner').consent=false;f.draft.content=FIXED_NOTICES.unavailableEnglish;f.draft.metadata.parts=[{type:'text',text:f.draft.content}];
 const prepared=await f.service.prepareFresh('owner',locator,f.draft);assert.equal(prepared.noticeOnly,true);
 await f.service.certifyFresh('owner',locator,createFreshHistoryProof(prepared.ticket,null));assert.equal(f.calls(),0);
 assert.equal((await f.service.get('owner',locator)).body.state,'notice');
 const legacy=fixture();legacy.db.put('chat','conversation',{id:'assistant',role:'assistant',content:f.draft.content,metadata:structuredClone(f.draft.metadata),createdAt:'2026-10-30T00:00:02.000Z'});
 assert.equal((await legacy.service.get('owner',locator)).body.state,'notice');assert.equal(legacy.db.reviews.size,0);assert.equal(legacy.calls(),0);
 f.draft.metadata.followUps=['Unchecked extra question'];await assert.rejects(f.service.prepareFresh('owner',locator,f.draft));
});

test('fresh final canonical card mismatch cannot be persisted even after optimistic semantic approval',async()=>{
 const f=fixture();f.draft.metadata.parts.push({type:'tool-getPassage',toolCallId:'passage',state:'output-available',output:{verses:[{reference:'John 3:16',text:'Changed canonical text.',similarity:1}]}});
 f.draft.actions=[{tool:'getPassage',toolCallId:'passage',success:true,output:structuredClone(f.draft.metadata.parts[1].output)}];
 const {proof}=await f.proof();await assert.rejects(f.service.certifyFresh('owner',locator,proof),e=>e.code==='canonical_rejected');
 assert.equal(f.db.messages.has('assistant'),false);assert.equal(f.db.reviews.size,0);
});

test('target and prefix user feedback do not invalidate a certified AI envelope or call inference',async()=>{
 const f=fixture();const {proof}=await f.proof();const saved=await f.service.certifyFresh('owner',locator,proof);
 const target=f.db.messages.get('assistant').row;
 Object.assign(target,{feedback:'up',feedbackReason:'Useful',feedbackAt:'2026-10-30T01:00:00Z',feedbackTags:['helpful'],feedbackReviewedAt:'2026-10-30T02:00:00Z',updatedAt:'2026-10-30T02:00:00Z'});
 Object.assign(f.db.messages.get('question').row,{feedback:'down',feedbackReason:'User-owned rating',updatedAt:'2026-10-30T02:00:00Z'});
 const read=await f.service.get('owner',locator);
 assert.equal(read.body.state,'verified');assert.equal(read.body.sourceDigest,saved.sourceDigest);assert.deepEqual(read.body.row,saved.row);assert.equal(f.calls(),1);
 assert.equal(target.feedback,'up');assert.equal([...f.db.reviews.values()].length,1);
 const snapshot=[...f.db.reviews.values()][0].sourceSnapshot.row;
 assert.deepEqual(Object.keys(snapshot).sort(),['content','createdAt','id','metadata','role']);
 target.metadata.parts[0].text='Changed AI source';target.content='Changed AI source';
 assert.equal((await f.service.get('owner',locator)).body.state,'withheld');assert.equal(f.calls(),1);
});

test('current exact getPassage and original-language outputs are classified without accepting unknown siblings',async()=>{
 for(const tool of ['getPassage','getOriginalText','lookupStrongs','readNote']){
  const f=fixture();
  const outputs={getPassage:{reference:'John 3:16',verses:[{reference:'John 3:16',text:'Exact canonical text.',similarity:1}],contextVerses:[],coverage:{complete:true},truncated:false,formatted:'Ignored duplicate formatting'},getOriginalText:{reference:'John 3:16',language:'Greek',textName:'SBLGNT',words:[],requestedReference:'John 3:16',sourceVersification:'source',sourceReferences:[],sourceIdentifiers:[],formatted:'Exact owned original evidence'},lookupStrongs:{number:'G25',lemma:'agapao',translit:'agapao',def:'love',kjv:'love'},readNote:{noteId:'owned-note',title:'Owned title',htmlContent:'<p>Owned private context</p>',truncated:false,wordCount:3,tags:[],folder:null,pinned:false,aliases:[],properties:{},updatedAt:'2026-10-30T00:00:00Z'}};
  const output=outputs[tool];f.draft.metadata.parts.push({type:'tool-'+tool,toolCallId:'actual',state:'output-available',output});
  f.draft.actions=[{tool,toolCallId:'actual',success:true,output:structuredClone(output)}];
  const {proof}=await f.proof();const saved=await f.service.certifyFresh('owner',locator,proof);assert.equal(saved.state,'verified');
  const projected=saved.row.metadata.parts.find(part=>part.type==='tool-'+tool);
  if(tool==='getPassage'){assert.equal(projected.output.verses[0].text,'Exact canonical text.');assert.equal('formatted'in projected.output,false);}
  else assert.equal(projected,undefined);
  assert.equal((await f.service.get('owner',locator)).body.state,'verified');assert.equal(f.calls(),1);
  output.unclassifiedSibling='Reject me';f.draft.actions[0].output=structuredClone(output);
  await assert.rejects(f.service.prepareFresh('owner',locator,f.draft),error=>error.code==='projection_refused');
 }
});

test('setDailyCross canonical text has the same exact canonical preflight as verse cards',async()=>{
 const f=fixture(),output={reference:'John 3:16',text:'Changed canonical text.',reason:'Study today',previousReference:null};
 f.draft.metadata.parts.push({type:'tool-setDailyCross',toolCallId:'cross',state:'output-available',output});
 f.draft.actions=[{tool:'setDailyCross',toolCallId:'cross',success:true,output:structuredClone(output)}];
 const {proof}=await f.proof();await assert.rejects(f.service.certifyFresh('owner',locator,proof),error=>error.code==='canonical_rejected');
 assert.equal(f.db.messages.has('assistant'),false);
});

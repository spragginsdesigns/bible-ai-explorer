import test from 'node:test';
import {convertToModelMessages} from 'ai';
import assert from 'node:assert/strict';
import {createHistoryService} from '../src/lib/ai/history/service.mjs';
import {createFreshHistoryProof} from '../src/lib/ai/history/fresh-proof.mjs';
import {CORE_VERSION,canonicalJSON} from '../src/lib/ai/history/projection.mjs';
import {preparedRequestReviewContext} from '../src/lib/ai/history/prepared-request.mjs';
import {FakeRepository} from './history-fake-repository.mjs';
import {loadHistoryModule} from './history-loader.mjs';
const {historyRenderer:renderer}=await loadHistoryModule('src/lib/ai/history/renderer.ts');
const locator={surface:'chat',parentId:'conversation',messageId:'answer'};
function fixture({media=[],audio=false,long=false,translation="KJV",allowLegacy=false}={}){
 const db=new FakeRepository();db.addUser('owner');db.addParent('chat','conversation','owner');db.clock=()=>new Date('2026-10-30T00:00:03Z');
 if(long)for(let i=0;i<100;i++)db.put('chat','conversation',{id:'outside-'+i,role:i%2?'assistant':'user',content:'PRIVATE OUTSIDE REQUEST '+i,metadata:null,createdAt:new Date(Date.parse('2026-10-29T23:50:00Z')+i*1000).toISOString()});
 const user={id:'question',role:'user',content:'Explain the supplied material.',metadata:null,createdAt:'2026-10-30T00:00:01.000Z',...(media.length||audio?{hasAttachments:true}:{})};db.put('chat','conversation',user);
 const reviewer={id:'actual-current-reviewer',provider:'openai',providerModelId:'actual-model',pricing:{input:1,output:2},supportsAttachments:true};
 const policy={core:{contractVersion:1,projectorVersion:CORE_VERSION,rendererDigest:renderer.digest,checkerVersion:'checker',corpusDigest:'a'.repeat(64),foundationDigest:'b'.repeat(64),fixedNoticesVersion:1},supportedTranslations:['KJV','NKJV'],externalSourceIdentities:{NKJV:{kind:'remote-chapter',edition:'NKJV',endpoint:'https://bolls.life/get-chapter/NKJV/{order}/{chapter}/',scope:'Exact requested chapters only'}},reviewerModelId:'different-house-head'};
 const attachments=[...media,...(audio?['audio/ogg']:[])].map((type,i)=>({id:'owned-'+i,userId:'owner',messageId:'question',pathname:'private/never-archived-'+i,filename:'private-file-'+i,mediaType:type,size:123,etag:'immutable-etag-'+i,status:'READY',transcript:type.startsWith('audio/')?'COMPLETE PRIVATE AUDIO TRANSCRIPT':null,durationSeconds:type.startsWith('audio/')?12:null,previewUrl:'https://private.invalid/owned-'+i+'?private-presigned-secret'}));
 attachments.forEach(row=>db.attachments.set(row.id,structuredClone(row)));
 let reviews=0,legacy=0,externalWords=["Remote version one"];const seen=[];
 const service=createHistoryService({repository:db,renderer,loadCurrentPolicy:async()=>structuredClone(policy),validateFreshReviewer:identity=>canonicalJSON(identity)===canonicalJSON(reviewer),verifyCanonical:async text=>({ok:true,text,references:translation==='NKJV'&&text.includes('Romans 8:28')?[{canonicalText:externalWords[0],verses:[{order:45,chapter:8,verse:28,text:externalWords[0]}]}]:[]}),loadCanonicalChapter:async()=>structuredClone(externalWords),verifyOnly:async input=>{legacy++;if(!allowLegacy)throw Error('Must use actual current reviewer');await input.authorizeInference();return{verified:true,canonicalPassed:true,semanticPassed:true,repaired:false,blocks:input.blocks,reviewerModelId:input.policy.reviewerModelId};}});
 const messages=[{id:'question',role:'user',parts:[...attachments.filter(row=>!row.mediaType.startsWith('audio/')).map(row=>({type:'file',mediaType:row.mediaType,filename:row.filename,url:row.previewUrl})),...(audio?[{type:'text',text:'COMPLETE PRIVATE AUDIO TRANSCRIPT'}]:[]),{type:'text',text:user.content}]}];
 const input={messages,sources:[user],attachments,systemContext:'Complete actual server request context.',reviewer,mediaParts:attachments.filter(row=>!row.mediaType.startsWith('audio/')).map(row=>({type:'file',mediaType:row.mediaType,filename:row.filename,data:new URL(row.previewUrl)})),review:async value=>{assert.equal(db.depth.get('owner'),0);await value.authorizeInference();reviews++;seen.push(value);return{verified:true,canonicalPassed:true,semanticPassed:true,repaired:false,blocks:value.blocks,reviewerModelId:reviewer.id};}};
 const draft={content:'A checked answer from the complete submitted request.',metadata:{translation,parts:[{type:'text',text:'A checked answer from the complete submitted request.'}]},actions:[]};
 return{db,service,reviewer,input,draft,seen,changeExternal:()=>externalWords=["Remote version two"],calls:()=>({reviews,legacy}),async prepare(){const converted=await convertToModelMessages(input.messages);input.mediaParts=converted.flatMap(message=>message.role==='user'&&Array.isArray(message.content)?message.content.filter(part=>part.type==='file'||part.type==='image'):[]);draft.preparedRequest=await service.prepareRequest('owner',locator,input);return service.prepareFresh('owner',locator,draft);},async save(){const prepared=await this.prepare();return service.certifyFresh('owner',locator,createFreshHistoryProof(prepared.ticket,await service.reviewFresh(prepared)));}};
}

test('fresh long chat binds the complete actual request window, never a clipped lifetime prefix',async()=>{
 const f=fixture({long:true});const saved=await f.save();assert.equal(saved.state,'verified');assert.equal((await f.service.get('owner',locator)).body.state,'verified');assert.deepEqual(f.calls(),{reviews:1,legacy:0});
 const record=[...f.db.reviews.values()][0];assert.equal(record.freshEvidence.prepared.scope,'complete-server-prepared-request');assert.deepEqual(record.freshEvidence.prepared.rows.map(row=>row.id),['question']);
 assert.equal(JSON.stringify(record).includes('PRIVATE OUTSIDE REQUEST'),false);assert.equal(JSON.stringify(record).includes('Complete actual server request context.'),false);
 f.db.messages.get('outside-0').row.content='Changed outside the actual request';assert.equal((await f.service.get('owner',locator)).body.state,'verified');
 f.db.messages.get('question').row.content='Changed inside the actual request';assert.equal((await f.service.get('owner',locator)).body.state,'withheld');assert.equal(f.calls().reviews,1);
});

for(const type of ['image/png','application/pdf'])test(`fresh ${type} review receives actual typed owned media and safe GET stays provider-free`,async()=>{
 const f=fixture({media:[type],long:true});await f.save();assert.equal(f.seen[0].mediaParts[0].mediaType,type);assert.equal(f.seen[0].mediaParts[0].data.type,'url');assert.equal(String(f.seen[0].mediaParts[0].data.url),f.input.attachments[0].previewUrl);assert.ok(f.seen[0].context.includes('Complete actual server request context.'));
 const state=await f.service.get('owner',locator);assert.equal(state.body.state,'verified');assert.deepEqual(f.calls(),{reviews:1,legacy:0});
 const record=JSON.stringify([...f.db.reviews.values()]);for(const secret of ['private-presigned-secret','private-file-','private/never-archived'])assert.equal(record.includes(secret),false);
 f.db.attachments.get('owned-0').etag='changed-bytes-etag';assert.equal((await f.service.get('owner',locator)).body.state,'withheld');assert.equal(f.calls().reviews,1);
});

test('stored audio transcript is complete reviewer text and its source hash invalidates without new transcription',async()=>{
 const f=fixture({audio:true});await f.save();assert.equal(f.seen[0].mediaParts.length,0);assert.ok(f.seen[0].question.includes('COMPLETE PRIVATE AUDIO TRANSCRIPT'));assert.ok(f.seen[0].context.includes('COMPLETE PRIVATE AUDIO TRANSCRIPT'));
 assert.equal(JSON.stringify([...f.db.reviews.values()]).includes('COMPLETE PRIVATE AUDIO TRANSCRIPT'),false);
 assert.equal((await f.service.get('owner',locator)).body.state,'verified');f.db.attachments.get('owned-0').transcript='Changed transcript';assert.equal((await f.service.get('owner',locator)).body.state,'withheld');assert.equal(f.calls().reviews,1);
});

test('prepared row, attachment and reviewer changes fence final commit and never mint a provisional source',async()=>{
 for(const kind of ['source','etag','owner','status','message','registry']){
  const f=fixture({media:['image/png']});const prepared=await f.prepare(),approval=await f.service.reviewFresh(prepared);
  if(kind==='source')f.db.messages.get('question').row.content='Changed';
  if(kind==='etag')f.db.attachments.get('owned-0').etag='different';
  if(kind==='owner')f.db.attachments.get('owned-0').userId='foreign';
  if(kind==='status')f.db.attachments.get('owned-0').status='PENDING';
  if(kind==='message')f.db.attachments.get('owned-0').messageId='foreign-message';
  if(kind==='registry')f.reviewer.providerModelId='new-model';
  await assert.rejects(f.service.certifyFresh('owner',locator,createFreshHistoryProof(prepared.ticket,approval)));
  assert.equal(f.db.messages.has('answer'),false);assert.equal(f.db.reviews.size,0);
 }
});

test('forged ticket, foreign media URL, incomplete request and overlong transcript fail before inference',async()=>{
 const forged=fixture();forged.draft.preparedRequest={};await assert.rejects(forged.service.prepareFresh('owner',locator,forged.draft));
 for(const kind of ['url','missing','too-long','no-user']){
  const f=fixture({media:['image/png']});
  if(kind==='url')f.input.mediaParts[0].data=new URL('https://unowned.invalid');
  if(kind==='missing')f.db.messages.delete('question');
  if(kind==='too-long')f.input.messages[0].parts.push({type:'text',text:'x'.repeat(64001)});
  if(kind==='no-user')f.input.messages[0].role='assistant';
  await assert.rejects(f.service.prepareRequest('owner',locator,f.input));assert.equal(f.calls().reviews,0);
 }
});

test('original primary-review accessor uses the same complete ticket source and rejects JSON substitutes',async()=>{
 const f=fixture({audio:true});const ticket=await f.service.prepareRequest('owner',locator,f.input);const context=preparedRequestReviewContext(ticket);assert.ok(context.context.includes('COMPLETE PRIVATE AUDIO TRANSCRIPT'));assert.throws(()=>preparedRequestReviewContext({}));
});

test('capture rejects duplicated/retyped media and snapshots typed URLs before later SDK mutation',async()=>{
 for(const kind of ['duplicate','type']){
  const f=fixture({media:['image/png','application/pdf']});
  if(kind==='duplicate')f.input.mediaParts[1]=f.input.mediaParts[0];
  if(kind==='type')f.input.mediaParts[0].mediaType='application/pdf';
  await assert.rejects(f.service.prepareRequest('owner',locator,f.input));assert.equal(f.calls().reviews,0);
 }
 const f=fixture({media:['image/png']});const original=f.input.attachments[0].previewUrl;
 f.draft.preparedRequest=await f.service.prepareRequest('owner',locator,f.input);
 f.input.mediaParts[0].data=new URL('https://unowned.invalid/after-capture');
 const prepared=await f.service.prepareFresh('owner',locator,f.draft);await f.service.reviewFresh(prepared);
 assert.equal(String(f.seen[0].mediaParts[0].data.url),original);
});

test('prepared current-context certification retains actual action proof on later safe GET',async()=>{
 const f=fixture({long:true}),output={noteId:'actual-owned-note',noteTitle:'Actual saved title',created:true,appendedHtml:'<p>Actual saved body</p>'};
 f.draft.metadata.parts.push({type:'tool-addToNote',toolCallId:'save',state:'output-available',input:{},output});
 f.draft.actions=[{tool:'addToNote',toolCallId:'save',success:true,output:structuredClone(output)}];
 const saved=await f.save();assert.equal(saved.state,'verified');
 const read=await f.service.get('owner',locator);assert.equal(read.body.state,'verified');assert.deepEqual(read.body.row,saved.row);assert.equal(f.calls().reviews,1);
 const receipt=read.body.row.metadata.parts.find(part=>part.type==='tool-addToNote');assert.equal(receipt.output.noteId,'actual-owned-note');assert.equal('appendedHtml'in receipt.output,false);
});


test('prepared NKJV GET rechecks every captured question/system chapter without retaining hidden prompt text',async()=>{
 const f=fixture({translation:'NKJV'});f.input.systemContext='Consider Romans 8:28 in the complete server-prepared context.';
 await f.save();const record=[...f.db.reviews.values()][0];assert.equal(record.freshEvidence.external.evidence.chapters.length,1);
 assert.equal(JSON.stringify(record).includes('Consider Romans 8:28'),false);
 assert.equal((await f.service.get('owner',locator)).body.state,'verified');assert.equal(f.calls().reviews,1);
 f.changeExternal();assert.equal((await f.service.get('owner',locator)).body.state,'withheld');assert.equal(f.calls().reviews,1);
});

test('registry retirement withholds with a current digest for explicit recheck, never a read error or raw fallback',async()=>{
 const f=fixture();const saved=await f.save();f.reviewer.providerModelId='retired-or-changed';
 const state=await f.service.get('owner',locator);assert.equal(state.status,200);assert.equal(state.body.state,'withheld');assert.equal(state.body.sourceDigest,saved.sourceDigest);assert.equal(state.body.row.metadata.historyVerification.code,'policy_changed');assert.equal(state.body.row.content.includes(f.draft.content),false);assert.equal(f.calls().reviews,1);
});


test('a later successful explicit recheck supersedes an older retired prepared reviewer certificate',async()=>{
 const f=fixture({allowLegacy:true});const saved=await f.save();f.reviewer.providerModelId='retired-or-changed';f.db.clock=()=>new Date('2026-10-30T00:00:04Z');
 assert.equal((await f.service.get('owner',locator)).body.state,'withheld');
 const checked=await f.service.recheck('owner',locator,saved.sourceDigest);assert.equal(checked.status,200);assert.equal(checked.body.code,'verified');
 const read=await f.service.get('owner',locator);assert.equal(read.body.state,'verified');assert.equal(read.body.row.content,f.draft.content);assert.deepEqual(f.calls(),{reviews:1,legacy:1});
});

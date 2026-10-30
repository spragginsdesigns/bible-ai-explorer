import test from 'node:test';
import assert from 'node:assert/strict';
import {createHistoryReadSnapshot,createSnapshotHistoryReader,loadHistoryReadSnapshot} from '../src/lib/ai/history/read-snapshot.mjs';
import {createHistoryService} from '../src/lib/ai/history/service.mjs';
import {createFreshHistoryProof} from '../src/lib/ai/history/fresh-proof.mjs';
import {CORE_VERSION,FIXED_NOTICES,canonicalJSON} from '../src/lib/ai/history/projection.mjs';
import {FakeRepository} from './history-fake-repository.mjs';
import {loadHistoryModule} from './history-loader.mjs';
const {historyRenderer:renderer}=await loadHistoryModule('src/lib/ai/history/renderer.ts');
const {reviewedHistoryRow}=await loadHistoryModule('src/lib/ai/history/read-boundary.ts');
const copy=value=>structuredClone(value),wait=()=>new Promise(resolve=>setTimeout(resolve,0));
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
function fixture(surface='chat'){
 const db=new FakeRepository();db.addUser('owner');db.addUser('foreign');db.addParent(surface,'parent','owner');
 let clock=new Date('2026-10-30T01:00:00Z'),calls=0;db.clock=()=>new Date(clock);
 const reviewer={id:'prepared-head',provider:'openai',providerModelId:'actual-model',pricing:{input:1,output:2},supportsAttachments:true};
 const policy={core:{contractVersion:1,projectorVersion:CORE_VERSION,rendererDigest:renderer.digest,checkerVersion:'current-checker',corpusDigest:'a'.repeat(64),foundationDigest:'b'.repeat(64),fixedNoticesVersion:1},supportedTranslations:['KJV','NKJV'],reviewerModelId:'legacy-head'};
 const options={renderer,loadCurrentPolicy:async()=>copy(policy),validateFreshReviewer:identity=>canonicalJSON(identity)===canonicalJSON(reviewer),verifyCanonical:async()=>({ok:true,references:[]}),verifyOnly:async input=>{calls++;await input.authorizeInference();return{verified:true,canonicalPassed:true,semanticPassed:true,repaired:false,blocks:input.blocks,reviewerModelId:input.policy.reviewerModelId};}};
 const service=createHistoryService({repository:db,...options});
 const locate=id=>({surface,parentId:'parent',messageId:id});
 const put=(id,role,content,at,metadata)=>{const row={id,role,content,metadata:metadata??(role==='assistant'?{translation:'KJV',parts:[{type:'text',text:content}]}:null),createdAt:new Date(at).toISOString(),[surface==='chat'?'conversationId':'noteId']:'parent',...(surface==='chat'?{feedback:null,feedbackTags:[]}: {})};db.put(surface,'parent',row);return row;};
 const snapshot=()=>{
  const records=[...db.reviews.values()];
  const ordered=records.sort((a,b)=>new Date(b.checkedAt)-new Date(a.checkedAt)||new Date(b.createdAt)-new Date(a.createdAt)||b.id.localeCompare(a.id));
  const actionReviewIds=[...records].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).map(record=>record.id);
  return createHistoryReadSnapshot({ownerId:'owner',surface,parentId:'parent',parent:{id:'parent',userId:'owner',title:'Owned'},user:{id:'owner',plan:'free',aiConsentVersion:1,aiConsentAt:new Date()},subscription:null,currentTime:clock,
   rows:[...db.messages.values()].filter(v=>v.surface===surface&&v.parentId==='parent').map(v=>copy(v.row)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id)),attachments:[...db.attachments.values()],reviews:ordered,actionReviewIds},{hasCurrentAiConsent:()=>true});
 };
 const local=s=>createHistoryService({...options,repository:s.repository,verifyOnly:async()=>{throw Error('Read attempted inference');},verifyCanonical:undefined,loadCanonicalChapter:undefined});
 const parity=async id=>{const s=snapshot(),before=calls,result=await local(s).get('owner',locate(id));assert.deepEqual(result,await service.get('owner',locate(id)));assert.equal(calls,before);return result;};
 const recheck=async id=>service.recheck('owner',locate(id),(await service.get('owner',locate(id))).body.sourceDigest);
 return{db,service,policy,reviewer,options,locate,put,snapshot,local,parity,recheck,calls:()=>calls,advance:()=>{clock=new Date(clock.getTime()+1000);}};
}
for(const surface of ['chat','note'])test(`snapshot exact legacy/verified/pending/notice/feedback parity for ${surface}`,async()=>{
 const f=fixture(surface);f.put('q','user','Explain the passage.',Date.parse('2026-10-30T00:00:01Z'));const a=f.put('a','assistant','A bounded checked answer.',Date.parse('2026-10-30T00:00:02Z'));
 assert.equal((await f.parity('a')).body.state,'withheld');await f.recheck('a');assert.equal((await f.parity('a')).body.state,'verified');
 f.db.messages.get('a').row.feedback='down';const s=f.snapshot(),safe=await reviewedHistoryRow(f.local(s),'owner',f.locate('a'),s.rows.find(row=>row.id==='a'));assert.equal(safe.feedback,'down');assert.deepEqual(safe.attachments,[]);
 const record=[...f.db.reviews.values()][0];record.state='pending';record.expiresAt=new Date('2026-10-31T00:00:00Z');assert.equal((await f.parity('a')).body.state,'pending');
 record.expiresAt=new Date('2026-10-29T00:00:00Z');assert.equal((await f.parity('a')).body.state,'withheld');
 const notice=Object.values(FIXED_NOTICES)[0];f.put('notice','assistant',notice,Date.parse('2026-10-30T00:00:03Z'));assert.equal((await f.parity('notice')).body.state,'notice');
 assert.equal(a.content,'A bounded checked answer.');
});
test('legacy complete-prefix80 guard is unchanged at80 and beyond',async()=>{
 for(const count of [80,81,120]){
  const f=fixture();for(let i=0;i<count;i++)f.put('row-'+i,i%2?'assistant':'user','Synthetic '+i,Date.parse('2026-10-29T00:00:00Z')+i*1000);
  const last=count%2?count-2:count-1;const result=await f.parity('row-'+last);assert.equal(result.body.state,'withheld');
  if(last>=80)assert.equal(result.body.row.metadata.historyVerification.code,'context_incomplete');
 }
});
async function preparedFixture(surface='chat',count=24,media=false,long=true){
 const f=fixture(surface),source=[];
 if(long)for(let i=0;i<100;i++)f.put('outside-'+i,i%2?'assistant':'user','Outside prepared window '+i,Date.parse('2026-10-28T00:00:00Z')+i*1000);
 for(let i=0;i<count;i++)source.push(f.put('prepared-'+i,i%2?'user':'assistant','Selected prepared source '+i,Date.parse('2026-10-29T00:00:00Z')+i*1000));
 const last=source.at(-1),attachments=media?[{id:'file',userId:'owner',messageId:last.id,pathname:'private/owned',filename:'owned.png',mediaType:'image/png',size:100,etag:'etag-one',status:'READY',transcript:null,durationSeconds:null,previewUrl:'https://private.invalid/owned'}]:[];
 attachments.forEach(row=>f.db.attachments.set(row.id,copy(row)));
 const input={sources:source,messages:source.map(row=>({id:row.id,role:row.role,parts:[...(row.id===last.id?attachments.map(file=>({type:'file',url:file.previewUrl,mediaType:file.mediaType,filename:file.filename})):[]),{type:'text',text:row.content}]})),attachments,mediaParts:attachments.map(file=>({type:'file',data:new URL(file.previewUrl),mediaType:file.mediaType,filename:file.filename})),systemContext:'Complete actual system context.',reviewer:f.reviewer,review:async value=>{await value.authorizeInference();return{verified:true,canonicalPassed:true,semanticPassed:true,repaired:false,blocks:value.blocks,reviewerModelId:f.reviewer.id};}};
 const draft={content:'A prepared checked answer.',metadata:{translation:'KJV',parts:[{type:'text',text:'A prepared checked answer.'}]},actions:[],preparedRequest:await f.service.prepareRequest('owner',f.locate('answer'),input)};
 const preparation=await f.service.prepareFresh('owner',f.locate('answer'),draft);await f.service.certifyFresh('owner',f.locate('answer'),createFreshHistoryProof(preparation.ticket,await f.service.reviewFresh(preparation)));
 return f;
}
for(const [surface,count]of[['chat',24],['note',16]])test(`fresh ${surface} prepared${count} window survives long lifetime prefix and invalidates selected dependencies`,async()=>{
 const f=await preparedFixture(surface,count);assert.equal((await f.parity('answer')).body.state,'verified');
 f.db.messages.get('outside-0').row.content='Changed outside selected request';assert.equal((await f.parity('answer')).body.state,'verified');
 f.db.messages.get('prepared-0').row.content='Changed selected source';assert.equal((await f.parity('answer')).body.state,'withheld');
});
for(const mutation of ['etag','status','owner','message','delete'])test(`prepared attachment ${mutation} invalidates snapshot proof exactly like live GET`,async()=>{
 const f=await preparedFixture('chat',24,true);
 assert.equal((await f.parity('answer')).body.state,'verified');const row=f.db.attachments.get('file');
 if(mutation==='etag')row.etag='different';if(mutation==='status')row.status='PENDING';if(mutation==='owner')row.userId='foreign';if(mutation==='message')row.messageId='other';if(mutation==='delete')f.db.attachments.delete('file');
 assert.equal((await f.parity('answer')).body.state,'withheld');
});
test('latest successful legacy recheck supersedes retired prepared certificate in batch',async()=>{
 const f=await preparedFixture('chat',2,false,false);assert.equal((await f.parity('answer')).body.state,'verified');
 f.reviewer.providerModelId='retired';assert.equal((await f.parity('answer')).body.state,'withheld');f.advance();assert.equal((await f.recheck('answer')).status,200);
 assert.equal((await f.parity('answer')).body.state,'verified');
});
test('snapshot is immutable per request; next snapshots revalidate mutation/deletion/foreign ownership',async()=>{
 const f=fixture();f.put('q','user','Question.',Date.parse('2026-10-30T00:00:01Z'));f.put('a','assistant','Verified current.',Date.parse('2026-10-30T00:00:02Z'));await f.recheck('a');
 const snapshot=f.snapshot(),local=f.local(snapshot);snapshot.rows.find(row=>row.id==='a').content='Caller mutation';
 f.db.messages.get('a').row.content='New persisted source';assert.equal((await local.get('owner',f.locate('a'))).body.row.content,'Verified current.');assert.equal((await f.parity('a')).body.state,'withheld');
 f.db.deleteMessage('a');assert.equal((await f.parity('a')).status,404);assert.equal((await local.get('foreign',f.locate('a'))).status,404);assert.equal((await local.get('owner',{...f.locate('a'),parentId:'foreign'})).status,404);
 for(const method of ['createReview','finishLease','saveFreshTarget','expireLeases'])await assert.rejects(snapshot.repository.withOwnerLock('owner',tx=>tx[method]()),/verification_unavailable/);
});
test('snapshot preserves database latest-approved ID order rather than JS locale sorting',async()=>{
 const f=await preparedFixture('chat',2,false,false),snapshot=f.snapshot();
 const data=await snapshot.repository.withOwnerLock('owner',async tx=>({target:await tx.loadOwnedTarget(f.locate('answer')),policy:await tx.readPolicySnapshot()}));
 const old=copy([...f.db.reviews.values()][0]),legacy={...copy(old),id:'_legacy-first',freshEvidence:null},prepared={...copy(old),id:'Zprepared-second'};
 const special=createHistoryReadSnapshot({ownerId:'owner',surface:'chat',parentId:'parent',parent:{id:'parent',userId:'owner'},...data.policy,currentTime:new Date(),rows:[...f.db.messages.values()].map(v=>v.row),attachments:[],reviews:[legacy,prepared],actionReviewIds:[legacy.id,prepared.id]},{hasCurrentAiConsent:()=>true});
 assert.equal(await special.repository.withOwnerLock('owner',tx=>tx.loadPreparedReview(f.locate('answer'))),null);
});
test('all-legacy NKJV and fixed notices need no live reads; approved external candidates are bounded2',async()=>{
 const f=fixture();f.put('q','user','Question.',Date.parse('2026-10-30T00:00:01Z'));for(let i=0;i<40;i++)f.put('a-'+i,'assistant','Unapproved NKJV answer '+i,Date.parse('2026-10-30T00:00:02Z')+i*1000,{translation:'NKJV',parts:[{type:'text',text:'Unapproved NKJV answer '+i}]});
 const snapshot=f.snapshot();let live=0;const reader=createSnapshotHistoryReader(snapshot,f.local(snapshot),{get:async()=>{live++;throw Error('Must not read live');}});
 for(let i=0;i<40;i++){const result=await reader.get('owner',f.locate('a-'+i));assert.equal(result.body.state,'withheld');assert.match(result.body.sourceDigest,/^[a-f0-9]{64}$/);}assert.equal(live,0);
 const notice=Object.values(FIXED_NOTICES)[0];f.put('fixed','assistant',notice,Date.parse('2026-10-30T00:10:00Z'),{translation:'NKJV',parts:[{type:'text',text:notice}]});const fixed=f.snapshot();assert.equal((await createSnapshotHistoryReader(fixed,f.local(fixed),{get:async()=>{throw Error('Fixed notice must not fetch canonical');}}).get('owner',f.locate('fixed'))).body.state,'notice');
 const held=deferred();let active=0,peak=0,started=0;
 const limited=createSnapshotHistoryReader({requiresLiveRead:()=>true},{get:async()=>({status:200,body:{state:'withheld'}})},{get:async()=>{started++;active++;peak=Math.max(peak,active);await held.promise;active--;return{status:200,body:{state:'verified'}};}});
 const pending=Array.from({length:7},()=>limited.get('owner',f.locate('a-0')));await wait();assert.equal(started,2);held.resolve();await Promise.all(pending);assert.equal(peak,2);
});
test('loader scopes every DB read and preserves both PostgreSQL review selector orders in one read-only transaction',async()=>{
 const f=fixture();f.put('q','user','Question.',Date.parse('2026-10-30T00:00:01Z'));f.put('a','assistant','Checked answer.',Date.parse('2026-10-30T00:00:02Z'));await f.recheck('a');
 const calls=[];const records=[...f.db.reviews.values()];
 const db={
  $executeRaw:async sql=>{assert.match(sql.join(''),/SET TRANSACTION READ ONLY/);calls.push('read-only');},
  $queryRaw:async()=>[{currentTime:new Date('2026-10-30T01:00:00Z')}],
  user:{findUnique:async args=>{assert.equal(args.where.id,'owner');return{id:'owner',plan:'free',aiConsentAt:new Date(),aiConsentVersion:1};}},
  conversation:{findFirst:async args=>{assert.deepEqual(args.where,{id:'parent',userId:'owner'});return{id:'parent',userId:'owner'};}},
  message:{findMany:async args=>{assert.deepEqual(args.where,{conversationId:'parent',conversation:{userId:'owner'}});assert.deepEqual(args.orderBy,[{createdAt:'asc'},{id:'asc'}]);return[...f.db.messages.values()].map(value=>value.row);}},
  chatAttachment:{findMany:async args=>{assert.deepEqual(args.where,{message:{conversationId:'parent',conversation:{userId:'owner'}}});return[];}},
  aiAnswerReview:{findMany:async args=>{assert.equal(args.where.ownerId,'owner');assert.deepEqual(args.where.mainMessageId,{in:['a']});calls.push(args);return args.select?records.map(row=>({id:row.id})):records;}},
 };
 let transactions=0;const prisma={$transaction:async(callback,settings)=>{transactions++;assert.deepEqual(settings,{isolationLevel:'RepeatableRead',maxWait:5000,timeout:10000});return callback(db);}};
 const snapshot=await loadHistoryReadSnapshot(prisma,'owner',{surface:'chat',parentId:'parent'},{hasCurrentAiConsent:()=>true,readSubscription:async(owner,client)=>{assert.equal(owner,'owner');assert.equal(client,db);return null;}});
 assert.equal(transactions,1);assert.equal(calls[0],'read-only');assert.deepEqual(calls[1].orderBy,[{checkedAt:{sort:'desc',nulls:'last'}},{createdAt:'desc'},{id:'desc'}]);assert.deepEqual(calls[2].orderBy,{createdAt:'desc'});
 assert.equal((await f.local(snapshot).get('owner',f.locate('a'))).body.state,'verified');
 db.conversation.findFirst=async()=>null;db.message.findMany=()=>{throw Error('Foreign parent must not read rows');};assert.equal(await loadHistoryReadSnapshot(prisma,'owner',{surface:'chat',parentId:'foreign'},{readSubscription:()=>{throw Error('Foreign parent must not read billing');}}),null);
});
test('batch retains exact proven note-operation receipts without replay or raw appended bodies',async()=>{
 const f=fixture();f.put('q','user','Save this note.',Date.parse('2026-10-30T00:00:01Z'));
 const output={noteId:'owned-note',noteTitle:'Owned title',created:true,appendedHtml:'<p>Private canonical body</p>'};
 const draft={content:'The study was saved.',metadata:{translation:'KJV',parts:[{type:'text',text:'The study was saved.'},{type:'tool-addToNote',toolCallId:'saved-once',state:'output-available',input:{},output}]},actions:[{tool:'addToNote',toolCallId:'saved-once',success:true,output:copy(output)}]};
 const preparation=await f.service.prepareFresh('owner',f.locate('saved-answer'),draft);await f.service.certifyFresh('owner',f.locate('saved-answer'),createFreshHistoryProof(preparation.ticket,await f.service.reviewFresh(preparation)));
 const read=await f.parity('saved-answer');assert.equal(read.body.state,'verified');assert.equal(read.body.row.metadata.parts[1].output.noteId,'owned-note');assert.equal(JSON.stringify(read).includes('Private canonical body'),false);assert.equal('appendedHtml'in read.body.row.metadata.parts[1].output,false);
});

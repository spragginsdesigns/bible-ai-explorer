import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {readUIMessageStream,convertToModelMessages} from 'ai';
import * as markdown from '../src/utils/assistantMarkdown.ts';
import {persistableParts} from '../src/lib/ai/status-narration.ts';
import * as fresh from '../src/lib/ai/history/fresh-proof.mjs';
import {createHistoryService} from '../src/lib/ai/history/service.mjs';
import {CORE_VERSION,FIXED_NOTICES} from '../src/lib/ai/history/projection.mjs';
import {FakeRepository} from './history-fake-repository.mjs';
import {loadHistoryModule} from './history-loader.mjs';
const {historyRenderer:renderer}=await loadHistoryModule('src/lib/ai/history/renderer.ts');
const module={exports:{}};
const compiled=ts.transpileModule(readFileSync(new URL('../src/lib/ai/history/fresh-stream.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const dependencies={'ai':{readUIMessageStream},'@/utils/assistantMarkdown':markdown,'@/lib/ai/status-narration':{persistableParts},'@/lib/ai/verified-generation':{VERIFICATION_UNAVAILABLE:{en:FIXED_NOTICES.unavailableEnglish,es:FIXED_NOTICES.unavailableSpanish,de:FIXED_NOTICES.unavailableGerman}},'./fresh-proof.mjs':fresh};
new Function('require','module','exports',compiled)(name=>{assert.ok(name in dependencies,'Unexpected dependency '+name);return dependencies[name];},module,module.exports);
const {releaseCertifiedFreshTurn,releaseFreshRequestRefusal,textBlocksOf,withTextBlocks,FINAL_REVIEW_REVISIONS}=module.exports;
const locator={surface:'chat',parentId:'conversation',messageId:'answer'};
function fixture({reviewFail=false,verdict=null}={}){
 const db=new FakeRepository();db.addUser('owner');db.addParent('chat','conversation','owner');db.clock=()=>new Date('2026-10-30T00:00:03.000Z');
 db.put('chat','conversation',{id:'question',role:'user',content:'Save my study.',metadata:null,createdAt:'2026-10-30T00:00:01.000Z'});
 const policy={core:{contractVersion:1,projectorVersion:CORE_VERSION,rendererDigest:renderer.digest,checkerVersion:'checker',corpusDigest:'a'.repeat(64),foundationDigest:'b'.repeat(64),fixedNoticesVersion:1},supportedTranslations:['KJV','BSB','ASV','RV1909','LUT1912'],reviewerModelId:'approved-reviewer'};
 let calls=0;const approved=[];
 const service=createHistoryService({repository:db,renderer,loadCurrentPolicy:async()=>structuredClone(policy),validateFreshReviewer:identity=>identity.id==='approved-reviewer',verifyOnly:async input=>{assert.equal(db.depth.get('owner'),0);await input.authorizeInference();calls++;approved.push(input);if(reviewFail)throw Error('Controlled provider outage');if(verdict)return verdict(input,calls);return{verified:true,canonicalPassed:true,semanticPassed:true,repaired:false,blocks:input.blocks,reviewerModelId:'approved-reviewer'};},verifyCanonical:async()=>({ok:true,references:[{canonicalText:'Exact canonical source.'}]})});
 const written=[];const base={ownerId:'owner',locator,translation:'KJV',actions:[],service,write:chunk=>written.push(chunk)};
 return{db,service,written,base,approved,calls:()=>calls};
}
const prose=text=>[{type:'text-start',id:'prose'},{type:'text-delta',id:'prose',delta:text},{type:'text-end',id:'prose'}];
async function displayed(chunks){let last;for await(const message of readUIMessageStream({stream:new ReadableStream({start(c){c.enqueue({type:'start',messageId:'answer'});chunks.forEach(chunk=>c.enqueue(chunk));c.enqueue({type:'finish'});c.close();}}),terminateOnError:true}))last=message;return last;}

test('real SDK hydration commits before output and live/readback body, chips and cards agree',async()=>{
 const f=fixture();const original=f.service.certifyFresh;
 f.service.certifyFresh=async(...args)=>{assert.equal(f.written.length,0);return original(...args);};
 const chunks=[...prose('I can keep studying.\n[FOLLOWUP] What comes next?'),{type:'tool-input-available',toolCallId:'card',toolName:'presentChoices',input:{step:'other'}},{type:'tool-output-available',toolCallId:'card',output:{step:'other',question:'Continue reading?',options:['Yes','Later'],allowOther:false,skipLabel:'Skip',terms:[]}}];
 const result=await releaseCertifiedFreshTurn({...f.base,chunks});assert.equal(result.fallback,false);assert.equal(f.calls(),1);
 const live=await displayed(f.written),read=await f.service.get('owner',locator);
 assert.equal(markdown.stripFollowUpMarkers(markdown.joinAssistantTextParts(live.parts.filter(p=>p.type==='text').map(p=>p.text)),{streaming:false}).trim(),read.body.row.content);
 assert.deepEqual(read.body.row.metadata.followUps,['What comes next?']);assert.equal(live.parts.find(p=>p.type==='tool-presentChoices').output.question,'Continue reading?');
 assert.ok(f.approved[0].blocks.some(b=>b.text==='Continue reading?'));
});

test('final whole envelope includes late server cards and notices while operational progress never replays',async()=>{
 const f=fixture();const chunks=[{type:'data-progress',id:'progress',data:{unreviewed:'Hidden progress label'}},...prose('A checked answer.'),{type:'tool-input-available',toolCallId:'late',toolName:'showInApp',input:{}},{type:'tool-output-available',toolCallId:'late',output:{target:'tab.bible',caption:'Open the Bible'}},...prose(FIXED_NOTICES.timeIncomplete).map(c=>({...c,id:'notice'}))];
 await releaseCertifiedFreshTurn({...f.base,chunks});
 assert.ok(f.approved[0].blocks.some(b=>b.text==='Open the Bible'));assert.ok(f.approved[0].blocks.some(b=>b.text.includes(FIXED_NOTICES.timeIncomplete)));
 assert.equal(JSON.stringify(f.written).includes('Hidden progress label'),false);assert.equal(JSON.stringify(f.db.messages.get('answer')).includes('Hidden progress label'),false);
});

test('first prose withholding preserves actual committed note labels and live effects for final review',async()=>{
 const f=fixture(),output={noteId:'owned-note',noteTitle:'Actual saved note',created:true,matchedExisting:false,appendedHtml:'<p>Already committed content</p>'};
 const chunks=[...prose(FIXED_NOTICES.unavailableEnglish),{type:'tool-input-available',toolCallId:'save',toolName:'addToNote',input:{}},{type:'tool-output-available',toolCallId:'save',output:{...output,noteTitle:''}}];
 await releaseCertifiedFreshTurn({...f.base,chunks,actions:[{tool:'addToNote',toolCallId:'save',success:true,output}]});
 assert.ok(f.approved[0].blocks.some(b=>b.text==='Actual saved note'));
 assert.equal(f.written.find(c=>c.type==='tool-output-available').output.appendedHtml,output.appendedHtml);
 assert.equal((await f.service.get('owner',locator)).body.row.metadata.parts.find(p=>p.type==='tool-addToNote').output.noteTitle,'Actual saved note');
});

test('final provider outage preserves failed full envelope and deterministic owned note receipt without retry',async()=>{
 const f=fixture({reviewFail:true}),output={noteId:'owned-note',noteTitle:'Original actual title',created:true,matchedExisting:false,appendedHtml:'<p>Committed body</p>'};
 const raw='A full generated answer whose final review fails.';
 const chunks=[...prose(raw),{type:'tool-input-available',toolCallId:'save',toolName:'addToNote',input:{}},{type:'tool-output-available',toolCallId:'save',output}];
 const result=await releaseCertifiedFreshTurn({...f.base,chunks,actions:[{tool:'addToNote',toolCallId:'save',success:true,output}]});
 assert.equal(result.fallback,true);assert.equal(f.calls(),1);assert.equal(JSON.stringify(f.written).includes(raw),false);
 const receipt=f.written.find(c=>c.type==='tool-output-available');assert.equal(receipt.output.noteId,'owned-note');assert.equal(receipt.output.noteTitle,'Saved note');assert.equal(receipt.output.appendedHtml,output.appendedHtml);
 const read=await f.service.get('owner',locator);assert.equal(read.body.state,'notice');assert.equal(read.body.row.metadata.parts.find(p=>p.type==='tool-addToNote').output.noteId,'owned-note');
 const original=await f.service.download('owner',locator);assert.ok(original.body.includes(raw));assert.ok(original.body.includes('Original actual title'));
});

test('long answer transport references complete gate blocks instead of clipping/tripling source',async()=>{
 const f=fixture(),body='Complete source words. '.repeat(1000);
 const result=await releaseCertifiedFreshTurn({...f.base,chunks:prose(body)});
 assert.equal(result.fallback,false);assert.equal(f.approved[0].blocks.find(b=>b.id==='body').text,body.trim());
 assert.ok(f.approved[0].context.length<64000);assert.ok(f.approved[0].context.includes('checkedBlock'));
 assert.equal((await f.service.get('owner',locator)).body.row.content,body.trim());
});

test('an expired final-review window makes no inference and still saves the fixed notice before release',async()=>{
 const f=fixture(),controller=new AbortController();controller.abort();
 const result=await releaseCertifiedFreshTurn({...f.base,chunks:prose('Expired unchecked draft.'),signal:controller.signal});
 assert.equal(result.fallback,true);assert.equal(f.calls(),0);
 const read=await f.service.get('owner',locator);assert.equal(read.body.state,'notice');assert.equal(read.body.row.content,FIXED_NOTICES.unavailableEnglish);
 assert.equal(JSON.stringify(f.written).includes('Expired unchecked draft.'),false);
 assert.ok((await f.service.download('owner',locator)).body.includes('Expired unchecked draft.'));
});

for(const contextFailure of ['long-prefix','attachment','ambiguous'])for(const receipt of [false,true])test(`fixed fallback survives ${contextFailure} with receipt=${receipt}, without approving generated context`,async()=>{
 const f=fixture();
 if(contextFailure==='long-prefix')for(let index=0;index<81;index++)f.db.put('chat','conversation',{id:'older-'+index,role:index%2?'assistant':'user',content:'Older complete turn '+index,metadata:null,createdAt:new Date(Date.parse('2026-10-29T23:50:00Z')+index*1000).toISOString()});
 if(contextFailure==='attachment')f.db.messages.get('question').row.hasAttachments=true;
 if(contextFailure==='ambiguous')f.db.put('chat','conversation',{id:'same-time',role:'user',content:'An ambiguous earlier question.',metadata:null,createdAt:f.db.messages.get('question').row.createdAt});
 const raw='A generated answer that requires unavailable context.';
 const output={noteId:'actually-saved-note',noteTitle:'Actual original title',created:true,appendedHtml:'<p>Actual committed content</p>'};
 const chunks=prose(raw),actions=[];
 if(receipt){chunks.push({type:'tool-input-available',toolCallId:'save',toolName:'addToNote',input:{}},{type:'tool-output-available',toolCallId:'save',output});actions.push({tool:'addToNote',toolCallId:'save',success:true,output});}
 const result=await releaseCertifiedFreshTurn({...f.base,chunks,actions});assert.equal(result.fallback,true);assert.equal(f.calls(),0);
 const read=await f.service.get('owner',locator);assert.equal(read.body.state,'notice');assert.equal(read.body.row.content,FIXED_NOTICES.unavailableEnglish);
 assert.equal(JSON.stringify(f.written).includes(raw),false);assert.ok((await f.service.download('owner',locator)).body.includes(raw));
 if(receipt)assert.equal(read.body.row.metadata.parts.find(part=>part.type==='tool-addToNote').output.noteId,'actually-saved-note');
 const before=f.db.reviews.size;assert.equal((await f.service.get('owner',locator)).body.state,'notice');assert.equal(f.db.reviews.size,before);assert.equal(f.calls(),0);
});

test('fixed operational short path never accepts an added unchecked chip or unauthenticated receipt',async()=>{
 const f=fixture();f.db.messages.get('question').row.hasAttachments=true;
 for(const parts of [
  [{type:'text',text:FIXED_NOTICES.unavailableEnglish},{type:'tool-presentChoices',toolCallId:'extra',state:'output-available',output:{step:'other',question:'An unreviewed generated claim',options:['Yes','No'],allowOther:false,skipLabel:'Skip',terms:[]}}],
  [{type:'text',text:FIXED_NOTICES.unavailableEnglish},{type:'tool-addToNote',toolCallId:'forged',state:'output-available',output:{noteId:'unproved-note',noteTitle:'Saved note',created:true}}],
 ])await assert.rejects(f.service.prepareFresh('owner',locator,{content:FIXED_NOTICES.unavailableEnglish,metadata:{translation:'KJV',parts},actions:[]}));
 assert.equal(f.calls(),0);assert.equal(f.db.messages.has('answer'),false);
});

test('real SDK fresh release carries the complete prepared PDF request through long-chat certification/readback',async()=>{
 const f=fixture();for(let index=0;index<100;index++)f.db.put('chat','conversation',{id:'outside-'+index,role:'user',content:'Old outside request '+index,metadata:null,createdAt:new Date(Date.parse('2026-10-29T23:50:00Z')+index*1000).toISOString()});
 const source=f.db.messages.get('question').row;source.hasAttachments=true;
 const attachment={id:'owned-pdf',userId:'owner',messageId:'question',pathname:'private/pdf',filename:'study.pdf',mediaType:'application/pdf',size:123,etag:'actual-owned-etag',status:'READY',transcript:null,durationSeconds:null,previewUrl:'https://private.invalid/study.pdf?private-token'};f.db.attachments.set(attachment.id,structuredClone(attachment));
 const messages=[{id:'question',role:'user',parts:[{type:'file',mediaType:attachment.mediaType,filename:attachment.filename,url:attachment.previewUrl},{type:'text',text:source.content}]}];
 const converted=await convertToModelMessages(messages),mediaParts=converted[0].content.filter(part=>part.type==='file');let finalReviews=0;
 const preparedRequest=await f.service.prepareRequest('owner',locator,{messages,sources:[source],attachments:[attachment],systemContext:'Complete prepared context',mediaParts,reviewer:{id:'approved-reviewer',provider:'openai',providerModelId:'actual-current',pricing:{input:1,output:2},supportsAttachments:true},review:async input=>{await input.authorizeInference();finalReviews++;assert.equal(input.mediaParts[0].mediaType,'application/pdf');assert.ok(input.context.includes('Complete prepared context'));return{verified:true,canonicalPassed:true,semanticPassed:true,repaired:false,blocks:input.blocks,reviewerModelId:'approved-reviewer'};}});
 const result=await releaseCertifiedFreshTurn({...f.base,chunks:prose('A checked answer based on the supplied PDF.'),preparedRequest});
 assert.equal(result.fallback,false);assert.equal(finalReviews,1);assert.equal(f.calls(),0);
 const read=await f.service.get('owner',locator),live=await displayed(f.written);
 assert.equal(read.body.state,'verified');assert.equal(live.parts.find(part=>part.type==='text').text,read.body.row.content);assert.equal(finalReviews,1);
 assert.equal(JSON.stringify([...f.db.reviews.values()]).includes('private-token'),false);
});

test('refused complete request persists only the exact notice before any inference or tool execution',async()=>{
 const f=fixture();const result=await releaseFreshRequestRefusal(f.base);
 assert.equal(result.saved.state,'notice');assert.equal(f.calls(),0);
 assert.equal((await f.service.get('owner',locator)).body.row.content,FIXED_NOTICES.unavailableEnglish);
 assert.equal(f.written.some(chunk=>chunk.type.startsWith('tool-')),false);
});

// 2026-11-05: a final review that cleanly rejects an approved answer gets it
// repaired against its findings and reviewed again, instead of the notice.
const rejectWith=(issues,input)=>({verified:false,canonicalPassed:true,semanticPassed:false,repaired:false,blocks:input.blocks,reviewerModelId:'approved-reviewer',review:{pass:false,issues,requiredReferences:[]}});
const approve=input=>({verified:true,canonicalPassed:true,semanticPassed:true,repaired:false,blocks:input.blocks,reviewerModelId:'approved-reviewer'});

test('text block helpers swap only prose and keep tools, cards and order',()=>{
 const chunks=[{type:'text-start',id:'a'},{type:'text-delta',id:'a',delta:'One '},{type:'text-delta',id:'a',delta:'two.'},{type:'text-end',id:'a'},{type:'tool-input-available',toolCallId:'c',toolName:'presentChoices',input:{}},{type:'text-start',id:'b'},{type:'text-delta',id:'b',delta:'Three.'},{type:'text-end',id:'b'}];
 assert.deepEqual(textBlocksOf(chunks),[{id:'a',text:'One two.'},{id:'b',text:'Three.'}]);
 const swapped=withTextBlocks(chunks,[{id:'a',text:'Fixed.'},{id:'b',text:'Also fixed.'}]);
 assert.deepEqual(textBlocksOf(swapped),[{id:'a',text:'Fixed.'},{id:'b',text:'Also fixed.'}]);
 assert.deepEqual(swapped.filter(c=>c.type!=='text-delta'),chunks.filter(c=>c.type!=='text-delta'));
});

test('a final-review rejection is repaired with its findings and the revision must pass that same review',async()=>{
 const seen=[];
 const f=fixture({verdict:(input,call)=>call===1?rejectWith(['Does not address the doubt directly.'],input):approve(input)});
 const result=await releaseCertifiedFreshTurn({...f.base,chunks:prose('A first answer that drifts.'),revise:async(chunks,review)=>{seen.push(review.issues);return withTextBlocks(chunks,[{id:'prose',text:'A revised answer that addresses the doubt.'}]);}});
 assert.equal(result.fallback,false);assert.equal(f.calls(),2);
 assert.deepEqual(seen,[['Does not address the doubt directly.']]);
 assert.ok(f.approved[1].blocks.some(b=>b.text==='A revised answer that addresses the doubt.'));
 assert.equal((await f.service.get('owner',locator)).body.row.content,'A revised answer that addresses the doubt.');
 const written=JSON.stringify(f.written);assert.equal(written.includes('drifts'),false);assert.ok(written.includes('addresses the doubt'));
});

test('a revision that fails the pre-display gate withholds without another final review',async()=>{
 const f=fixture({verdict:input=>rejectWith(['Unsupported claim.'],input)});
 const result=await releaseCertifiedFreshTurn({...f.base,chunks:prose('Rejected answer.'),revise:async()=>null});
 assert.equal(result.fallback,true);assert.equal(f.calls(),1);
 assert.equal((await f.service.get('owner',locator)).body.row.content,FIXED_NOTICES.unavailableEnglish);
 assert.equal(JSON.stringify(f.written).includes('Rejected answer.'),false);
});

test('repair rounds are bounded and every rejected version stays unpublished',async()=>{
 let revisions=0;
 const f=fixture({verdict:input=>rejectWith(['Still not right.'],input)});
 const result=await releaseCertifiedFreshTurn({...f.base,chunks:prose('Version 0.'),revise:async chunks=>{revisions++;return withTextBlocks(chunks,[{id:'prose',text:'Version '+revisions+'.'}]);}});
 assert.equal(result.fallback,true);assert.equal(revisions,FINAL_REVIEW_REVISIONS);assert.equal(f.calls(),FINAL_REVIEW_REVISIONS+1);
 assert.equal(/Version d/.test(JSON.stringify(f.written)),false);
});

test('a provider outage in final review is not a rejection and is never revised',async()=>{
 let revisions=0;const f=fixture({reviewFail:true});
 const result=await releaseCertifiedFreshTurn({...f.base,chunks:prose('Outage answer.'),revise:async()=>{revisions++;return null;}});
 assert.equal(result.fallback,true);assert.equal(revisions,0);
});

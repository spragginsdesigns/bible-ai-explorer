import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {generateText,Output,convertToModelMessages,readUIMessageStream} from 'ai';
import {MockLanguageModelV4} from 'ai/test';
import {z} from 'zod';
import * as markdown from '../src/utils/assistantMarkdown.ts';
import * as guard from '../src/lib/ai/markdown-underscore-guard.ts';
import {doctrinalFoundation} from '../src/utils/systemPrompt.ts';
import {gateAnswer} from '../src/lib/ai/answer-gate.ts';
import {createDashStripper} from '../src/lib/ai/plain-dashes.ts';
import {persistableParts} from '../src/lib/ai/status-narration.ts';
import {createHistoryService} from '../src/lib/ai/history/service.mjs';
import {createVerifyOnlyAdapter} from '../src/lib/ai/history/verify-only.mjs';
import * as fresh from '../src/lib/ai/history/fresh-proof.mjs';
import {CORE_VERSION,canonicalJSON,projectHistory} from '../src/lib/ai/history/projection.mjs';
import {FakeRepository} from './history-fake-repository.mjs';
import {loadHistoryModule} from './history-loader.mjs';
const captureBytes=readFileSync(new URL('./fixtures/history/sdk-openai-responses-john-image.json',import.meta.url)),captured=JSON.parse(captureBytes),sourceRow=captured.row;
const hash=value=>createHash('sha256').update(value).digest('hex');
const {historyRenderer:renderer}=await loadHistoryModule('src/lib/ai/history/renderer.ts');
const books=JSON.parse(readFileSync(new URL('../src/data/books.json',import.meta.url))),names=JSON.parse(readFileSync(new URL('../src/data/book-names.json',import.meta.url)));
const localized=['es','de'].flatMap(language=>[...names[language].names.map((name,index)=>[name,index+1]),...Object.entries(names[language].aliases)]);
const getChapter=async(translation,order,chapter)=>{assert.equal(translation,'KJV');return JSON.parse(readFileSync(new URL('../src/data/kjv/'+books.find(book=>book.order===order).file,import.meta.url)))[chapter-1];};
const checkerSource=readFileSync(new URL('../src/lib/ai/scripture-verification.ts',import.meta.url),'utf8').replace(/^import\s[^;]*?;\s*$/gm,'').replace(/^export /gm,'');
const checkerFactory=new Function('normalizeAssistantMarkdown','analyzeMarkdownUnderscores','markdownRangeHasLiteralUnderscore','BOOKS','LOCALIZED_BOOK_NAMES','getChapter','isTranslationId','getOriginalVerse','getOriginalVerseForKjv','loadBsbChapter',stripTypeScriptTypes(checkerSource)+'\nreturn {verifyScriptureDraft};');
const forbidden=()=>{throw Error('No network, database or original-text source allowed in this KJV fixture');};
const {verifyScriptureDraft:verify}=checkerFactory(markdown.normalizeAssistantMarkdown,guard.analyzeMarkdownUnderscores,guard.markdownRangeHasLiteralUnderscore,books,localized,getChapter,value=>value==='KJV',forbidden,forbidden,forbidden);
const check=text=>verify(text,{translation:'KJV'});
const generation=stripTypeScriptTypes(readFileSync(new URL('../src/lib/ai/verified-generation.ts',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,''));
const {verifyGeneratedAnswer}=new Function('generateText','Output','z','doctrinalFoundation','getChapter','verifyScriptureDraft','gateAnswer','createDashStripper','console',generation+'\nreturn {verifyGeneratedAnswer};')(generateText,Output,z,doctrinalFoundation,getChapter,verify,gateAnswer,createDashStripper,{info(){}});
const compiled=ts.transpileModule(readFileSync(new URL('../src/lib/ai/history/fresh-stream.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const streamExports={},dependencies={'ai':{readUIMessageStream},'@/utils/assistantMarkdown':markdown,'@/lib/ai/status-narration':{persistableParts},'@/lib/ai/verified-generation':{VERIFICATION_UNAVAILABLE:{en:"I couldn't finish checking this answer against Scripture, so I've withheld it. Please try again."}},'./fresh-proof.mjs':fresh};
new Function('require','exports',compiled)(name=>{assert.ok(name in dependencies);return dependencies[name];},streamExports);
const core={contractVersion:1,projectorVersion:CORE_VERSION,rendererDigest:renderer.digest,checkerVersion:'real-checker-fixture',corpusDigest:'a'.repeat(64),foundationDigest:'b'.repeat(64),fixedNoticesVersion:1};
const project=row=>projectHistory({source:{surface:'chat',parentId:'parent',ownerId:'owner',row},context:{translation:'KJV',translationEvidence:'persisted',question:'Read the attached image and quote its KJV verse.',history:[],evidence:[]},policy:core},renderer);
const john=(await getChapter('KJV',43,3))[15],john17=(await getChapter('KJV',43,3))[16];
function chunks(parts){return parts.flatMap((part,index)=>{
 if(part.type==='step-start')return[{type:'start-step'}];
 if(part.type==='text')return[{type:'text-start',id:'text-'+index,providerMetadata:part.providerMetadata},{type:'text-delta',id:'text-'+index,delta:part.text},{type:'text-end',id:'text-'+index,providerMetadata:part.providerMetadata}];
 return[{type:'tool-input-available',toolName:part.type.slice(5),toolCallId:part.toolCallId,input:part.input,providerMetadata:part.callProviderMetadata},{type:'tool-output-available',toolCallId:part.toolCallId,output:part.output,providerMetadata:part.resultProviderMetadata}];
});}
function controlledModel(){
 return new MockLanguageModelV4({supportedUrls:{'image/*':[/^https:\/\/controlled\.invalid\//],'application/pdf':[/^https:\/\/controlled\.invalid\//]},doGenerate:async options=>{
  const user=options.prompt.find(message=>message.role==='user'),prompt=JSON.parse(user.content.find(part=>part.type==='text').text);
  const output={checkedReferences:prompt.expectedCheckedReferences,checkedOriginalSources:prompt.expectedCheckedOriginalSources,allScriptureQuotationsVerified:true,allCitationsSupportTheirClaims:true,faithfulToFoundation:true,answersRequestedQuestion:true,issues:[],requiredReferences:[]};
  return{content:[{type:'text',text:JSON.stringify(output)}],finishReason:{unified:'stop',raw:'stop'},usage:{inputTokens:{total:1},outputTokens:{total:1}},warnings:[]};
 }});
}
async function fixture(t,mediaType='image/png'){
 t.mock.method(globalThis,'fetch',forbidden);
 const db=new FakeRepository();db.addUser('owner');db.addParent('chat','parent','owner');db.clock=()=>new Date(sourceRow.createdAt);
 const locator={surface:'chat',parentId:'parent',messageId:sourceRow.id},question={id:'q',role:'user',content:'Read the attached material. Quote John 3:16 from the KJV and reproduce its footer.',metadata:null,createdAt:new Date(Date.parse(sourceRow.createdAt)-1000).toISOString(),hasAttachments:true};
 db.put('chat','parent',question);
 const attachment={id:'owned',userId:'owner',messageId:'q',pathname:'private/synthetic',filename:'synthetic-'+(mediaType==='application/pdf'?'document.pdf':'image.png'),mediaType,size:123,etag:'immutable-etag',status:'READY',previewUrl:'https://controlled.invalid/owned?synthetic-private-signature'};
 db.attachments.set(attachment.id,structuredClone(attachment));
 const messages=[{id:'q',role:'user',parts:[{type:'text',text:question.content},{type:'file',url:attachment.previewUrl,filename:attachment.filename,mediaType}]}];
 const converted=await convertToModelMessages(messages),mediaParts=converted[0].content.filter(part=>part.type==='file'||part.type==='image'),model=controlledModel(),definition={id:'controlled-current-reviewer',provider:'mock',providerModelId:'in-memory',pricing:{input:0,output:0},supportsAttachments:true};
 const review=createVerifyOnlyAdapter({houseChatModel:async()=>({definition}),resolveVerificationModel:async()=>model,providerOptionsForReview:()=>({}),verifyScriptureDraft:verify,verifyGeneratedAnswer});
 const policy={core,supportedTranslations:['KJV'],reviewerModelId:definition.id};
 const service=createHistoryService({repository:db,renderer,loadCurrentPolicy:async()=>structuredClone(policy),validateFreshReviewer:identity=>identity.id===definition.id,verifyCanonical:verify,verifyOnly:forbidden});
 const input={messages,sources:[question],attachments:[attachment],mediaParts,systemContext:'Complete synthetic owned current request.',reviewer:definition,review};
 const ticket=await service.prepareRequest('owner',locator,input);
 const actions=sourceRow.metadata.parts.filter(part=>part.type==='tool-getPassage').map(part=>({tool:'getPassage',toolCallId:part.toolCallId,success:true,output:structuredClone(part.output)}));
 return{db,locator,question,attachment,messages,mediaParts,model,service,input,ticket,actions,draft:{content:sourceRow.content,metadata:structuredClone(sourceRow.metadata),actions,preparedRequest:ticket}};
}

test('captured raw and projected display both pass real canonical checks without changing literal bytes or offsets',async()=>{
 const originalHash=hash(captureBytes),candidate=project(sourceRow);assert.equal(candidate.ok,true);assert.equal(candidate.display.content.length,sourceRow.content.length+1);
 for(const text of [sourceRow.content,candidate.display.content]){const result=await check(text);assert.equal(result.ok,true);assert.equal(result.text,text);assert.ok(result.quotes.some(quote=>quote.status==='verified'));for(const quote of result.quotes)for(const span of quote.citationSpans)assert.ok(text.slice(span.start,span.end).includes('John 3:16'));}
 for(const entry of candidate.review.canonicalSources){const checked=await check('[[SCRIPTURE:'+entry.reference+']]');assert.equal(checked.ok,true);assert.equal(checked.references[0].canonicalText,entry.text);}
 assert.equal(hash(readFileSync(new URL('./fixtures/history/sdk-openai-responses-john-image.json',import.meta.url))),originalHash);
});
for(const mediaType of ['image/png','application/pdf'])test('captured full envelope crosses actual SDK final '+mediaType+' reviewer, certifies exact raw archive and releases GET-identical text',async t=>{
 const f=await fixture(t,mediaType),emitted=[];
 const result=await streamExports.releaseCertifiedFreshTurn({ownerId:'owner',locator:f.locator,translation:'KJV',chunks:chunks(sourceRow.metadata.parts),metadata:{modelId:sourceRow.metadata.modelId},actions:f.actions,preparedRequest:f.ticket,service:f.service,write:chunk=>emitted.push(chunk)});
 assert.equal(result.fallback,false);assert.equal(result.saved.state,'verified');assert.equal(f.model.doGenerateCalls.length,1);
 const provider=f.model.doGenerateCalls[0].prompt.find(message=>message.role==='user').content,media=provider.find(part=>part.type==='file');assert.equal(media.mediaType,mediaType);assert.equal(String(media.data.url),f.attachment.previewUrl);
 const current=await f.service.get('owner',f.locator);assert.equal(current.body.state,'verified');assert.equal(current.body.row.content,result.saved.row.content);assert.equal(emitted.filter(chunk=>chunk.type==='text-delta').map(chunk=>chunk.delta).join(''),current.body.row.content);assert.equal(f.model.doGenerateCalls.length,1);
 const original=await f.service.download('owner',f.locator);assert.equal(original.status,200);const archived=JSON.parse(original.body).versions.find(version=>version.state==='verified').sourceSnapshot.row;assert.equal(archived.content,sourceRow.content);assert.deepEqual(archived.metadata,sourceRow.metadata);
 assert.equal(JSON.stringify([...f.db.reviews.values()]).includes('synthetic-private-signature'),false);
});
for(const [label,text] of [
 ['bold label','**John 3:16 (KJV)**\n\n> 16 '+john],
 ['heading label','# John 3:16 (KJV)\n\n> '+john],
 ['case-insensitive edition','**John 3:16 (kjv)**\n\n> '+john],
 ['CRLF label','John 3:16 (KJV)\r\n\r\n> '+john],
 ['closed code before label','~~~\nordinary example\n~~~\n\n**John 3:16 (KJV)**\n\n> '+john],
])test('only immediate standalone Markdown structure associates '+label,async()=>{const result=await check(text);assert.equal(result.ok,true);assert.equal(result.text,text);});
for(const [label,text] of [
 ['changed word','**John 3:16 (KJV)**\n\n> 16 '+john.replace('loved','hated')],
 ['mismatched NKJV edition','**John 3:16 (NKJV)**\n\n> '+john],
 ['mismatched ASV edition','**John 3:16 (ASV)**\n\n> '+john],
 ['missing whole range','**John 3:16-17 (KJV)**\n\n> 16 '+john],
 ['prose label','John 3:16 explains the Gospel.\n\n> '+john],
 ['intervening prose','**John 3:16 (KJV)**\nOrdinary prose.\n\n> '+john],
 ['two empty lines','**John 3:16 (KJV)**\n\n\n> '+john],
 ['inline quote','**John 3:16 (KJV)**\n\n"'+john+'"'],
 ['fenced quote','~~~\n**John 3:16 (KJV)**\n\n> '+john+'\n~~~'],
 ['HTML pre','<pre>\n**John 3:16 (KJV)**\n\n> '+john+'\n</pre>'],
 ['HTML code','<pre><code>\n**John 3:16 (KJV)**\n\n> '+john+'\n</code></pre>'],
 ['HTML comment','<!--\n**John 3:16 (KJV)**\n\n> '+john+'\n-->'],
 ['closed HTML prefix','<pre>example</pre>\n\n**John 3:16 (KJV)**\n\n> '+john],
 ['misleading closing-tag attribute','<pre title="</pre>">\n**John 3:16 (KJV)**\n\n> '+john+'\n</pre>'],
 ['misleading comment closing attribute','<!-- <span title="-->">\n**John 3:16 (KJV)**\n\n> '+john+'\n-->'],
 ['possible raw tag','<script data-example="</script>">\n**John 3:16 (KJV)**\n\n> '+john+'\n</script>'],

 ['wrong nearest label','**John 3:16 (KJV)**\n\n**John 3:17 (KJV)**\n\n> '+john],
 ['wrong forward label','**John 3:17 (KJV)**\n\n> '+john+'\nJohn 3:16'],
])test('standalone structure never approves '+label,async()=>{assert.equal((await check(text)).ok,false);});
test('a real range and nearest valid label remain literal; following references cannot lend a different verse',async()=>{
 assert.equal((await check('**John 3:16-17 (KJV)**\n\n> 16 '+john+'\n> 17 '+john17)).ok,true);
 assert.equal((await check('**John 3:17 (KJV)**\n\n**John 3:16 (KJV)**\n\n> '+john)).ok,true);
});
test('owned source, attachment and URL mutation guards still fence final certification without inference replay',async t=>{
 for(const kind of ['owner','etag','status','message','source']){
  const f=await fixture(t);const prepared=await f.service.prepareFresh('owner',f.locator,f.draft),approval=await f.service.reviewFresh(prepared);
  if(kind==='source')f.db.messages.get('q').row.content='Changed current request';else f.db.attachments.get('owned')[{owner:'userId',etag:'etag',status:'status',message:'messageId'}[kind]]=kind==='status'?'PENDING':'changed';
  await assert.rejects(f.service.certifyFresh('owner',f.locator,fresh.createFreshHistoryProof(prepared.ticket,approval)));assert.equal(f.db.messages.has(sourceRow.id),false);assert.equal(f.model.doGenerateCalls.length,1);
 }
 const f=await fixture(t);f.input.mediaParts[0].data={type:'url',url:new URL('https://controlled.invalid/unowned')};await assert.rejects(f.service.prepareRequest('owner',f.locator,f.input));assert.equal(f.model.doGenerateCalls.length,0);
});
test('post-capture URL mutation cannot change the exact authorized media reaching the actual SDK',async t=>{
 const f=await fixture(t),authorized=f.attachment.previewUrl;f.input.mediaParts[0].data.url.href='https://controlled.invalid/unowned-after-capture';
 const prepared=await f.service.prepareFresh('owner',f.locator,f.draft);await f.service.reviewFresh(prepared);
 const media=f.model.doGenerateCalls[0].prompt.find(message=>message.role==='user').content.find(part=>part.type==='file');assert.equal(String(media.data.url),authorized);assert.equal(f.model.doGenerateCalls.length,1);
});

test('captured literal corruption cannot reach actual SDK inference or certification',async t=>{
 const f=await fixture(t);f.draft.content=f.draft.content.replace('so loved','so hated');f.draft.metadata.parts.find(part=>part.type==='text').text=f.draft.content;
 const prepared=await f.service.prepareFresh('owner',f.locator,f.draft),approval=await f.service.reviewFresh(prepared);
 assert.equal(approval.verified,false);assert.equal(approval.canonicalPassed,false);assert.equal(f.model.doGenerateCalls.length,0);
 await assert.rejects(async()=>f.service.certifyFresh('owner',f.locator,fresh.createFreshHistoryProof(prepared.ticket,approval)));assert.equal(f.db.messages.has(sourceRow.id),false);
});
test('unknown captured transport field cannot reach actual SDK inference',async t=>{
 const f=await fixture(t);f.draft.metadata.parts.find(part=>part.type==='text').providerApproval=true;
 await assert.rejects(f.service.prepareFresh('owner',f.locator,f.draft));assert.equal(f.model.doGenerateCalls.length,0);assert.equal(f.db.messages.has(sourceRow.id),false);
});

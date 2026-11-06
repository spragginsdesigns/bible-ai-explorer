import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {generateText,Output} from 'ai';
import {MockLanguageModelV4} from 'ai/test';
import {z} from 'zod';
import ts from 'typescript';
import {chatSystemPrompt,doctrinalFoundation} from '../src/utils/systemPrompt.ts';
import {normalizeAssistantMarkdown} from '../src/utils/assistantMarkdown.ts';
import {analyzeMarkdownUnderscores,markdownRangeHasLiteralUnderscore} from '../src/lib/ai/markdown-underscore-guard.ts';
import {gateAnswer} from '../src/lib/ai/answer-gate.ts';
import {createDashStripper} from '../src/lib/ai/plain-dashes.ts';
import {traceTurn,classifyTurnError} from '../src/lib/ai/turn-trace.ts';
import {PREPARED_CONTEXT_CHARS,HISTORY_REVIEW_CONTEXT_CHARS,COMPLETE_VERIFICATION_REQUEST_CHARS} from '../src/lib/ai/verification-limits.mjs';
import {createHistoryService,HistoryError} from '../src/lib/ai/history/service.mjs';
import {createVerifyOnlyAdapter} from '../src/lib/ai/history/verify-only.mjs';
import {createFreshHistoryProof,readFreshPreparation} from '../src/lib/ai/history/fresh-proof.mjs';
import {CORE_VERSION,canonicalJSON,digest} from '../src/lib/ai/history/projection.mjs';
import {FakeRepository} from './history-fake-repository.mjs';
import {loadHistoryModule} from './history-loader.mjs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const plain=source=>stripTypeScriptTypes(source.replace(/^import\s[^;]*?;\s*$/gm,'').replace(/^export /gm,''));
const serviceSource=read('src/lib/ai/history/service.mjs'),start=serviceSource.indexOf('function reviewEnvelope('),end=serviceSource.indexOf('\nfunction blockedSnapshot(',start),envelopeSource=serviceSource.slice(start,end);
const reviewEnvelope=new Function('canonicalJSON',envelopeSource+'\nreturn reviewEnvelope;')(canonicalJSON);
// Exact pre-pooling function retained solely to replay the former byte budget.
const legacyEnvelopeSource=`function reviewEnvelope(context,candidate){
 const byText=new Map(candidate.review.blocks.map(block=>[block.text,block.path]));
 const pointers=value=>typeof value==='string'&&byText.has(value)?{checkedBlock:byText.get(value)}:Array.isArray(value)?value.map(pointers):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,pointers(item)])):value;
 const {blocks,...manifest}=candidate.review;
 return canonicalJSON({savedHistoryContext:context,display:pointers(candidate.display),manifest:{...pointers(manifest),blocks:blocks.map(({path,kind})=>({path,kind}))},blockPointers:'checkedBlock names an exact block ID/text supplied separately to this same review; no display field or source has been clipped.'});
}`;
const legacyEnvelope=new Function('canonicalJSON',legacyEnvelopeSource+'\nreturn reviewEnvelope;')(canonicalJSON);
const loadLegacy=async generous=>import('data:text/javascript;base64,'+Buffer.from(serviceSource.replace(envelopeSource,legacyEnvelopeSource).replace(generous?"import {HISTORY_REVIEW_CONTEXT_CHARS} from '../verification-limits.mjs';":'IMPOSSIBLE_IMPORT',generous?'const HISTORY_REVIEW_CONTEXT_CHARS=256_000;':'').replace(/from '(\.{1,2}\/[^']+)'/g,(_match,spec)=>'from '+JSON.stringify(new URL('../src/lib/ai/history/'+spec,import.meta.url).href))).toString('base64'));
const {createHistoryService:legacyService}=await loadLegacy(false),{createHistoryService:legacyBindingService}=await loadLegacy(true);

function materialize(envelope,blocks){
 const byId=new Map(blocks.map(block=>[block.id??block.path,block.text]));
 const object=value=>Object.fromEntries(Object.entries(value).map(([key,item])=>[key,decode(item)]));
 function decode(value){
  if(Array.isArray(value))return value.map(decode);
  if(value&&typeof value==='object'){
   const keys=Object.keys(value);
   if(keys.length===1&&keys[0]==='canonicalSourceLiteral')return object(value.canonicalSourceLiteral);
   if(keys.length===1&&keys[0]==='canonicalSourceTextAt'){assert.ok(Number.isInteger(value.canonicalSourceTextAt)&&value.canonicalSourceTextAt>=0&&value.canonicalSourceTextAt<envelope.canonicalTextTable.length);return envelope.canonicalTextTable[value.canonicalSourceTextAt];}
   if(keys.length===1&&keys[0]==='reviewTextAt'){assert.ok(Number.isInteger(value.reviewTextAt)&&value.reviewTextAt>=0&&value.reviewTextAt<envelope.reviewTextTable.length);return envelope.reviewTextTable[value.reviewTextAt];}
   if(keys.length===1&&keys[0]==='checkedBlock'){assert.ok(byId.has(value.checkedBlock));return byId.get(value.checkedBlock);}
   return object(value);
  }
  return value;
 }
 return{savedHistoryContext:decode(envelope.savedHistoryContext),display:decode(envelope.display),manifest:decode(envelope.manifest)};
}

test('exact canonical pool round-trips all paths, editions, raw operation proof, Unicode and literal pointer-shaped JSON without mutation',()=>{
 const words='Complete canonical words: "quoted" \\ 😀\nSecond line.';
 const context={question:'Private ordinary words stay unpooled.',history:[{content:words}],evidence:[{manifest:[{tool:'getPassage',toolCallId:'operation-one',outputDigest:'a'.repeat(64),output:{verses:[{reference:'John 3:16',translation:'KJV',text:words}],ordinal:3,complete:true}}]}],literal:{canonicalSourceTextAt:0},nested:{canonicalSourceLiteral:{canonicalSourceTextAt:1}},literalBlock:{checkedBlock:'body'}};
 const candidate={display:{content:'Exact answer.',metadata:{parts:[{type:'text',text:'Exact answer.'},{type:'tool-getPassage',toolCallId:'operation-one',output:{verses:[{reference:'John 3:16',translation:'KJV',text:words},{reference:'Juan 3:16',translation:'RV1909',text:words}]}}]}},review:{blocks:[{path:'body',kind:'generated',text:'Exact answer.'}],canonicalSources:[{path:'first',reference:'John 3:16',translation:'KJV',text:words},{path:'second',reference:'Juan 3:16',translation:'RV1909',text:words},{path:'third',reference:'John 3:17',translation:'KJV',text:words+' Different.'}],actions:[{tool:'getPassage',toolCallId:'operation-one',path:'second'}],requiresActionProof:true}};
 const before=canonicalJSON({context,candidate}),binding=digest({context,candidate}),encoded=JSON.parse(reviewEnvelope(context,candidate)),expanded=materialize(encoded,candidate.review.blocks);
 const {blocks,...manifest}=candidate.review;const expected={savedHistoryContext:context,display:candidate.display,manifest:{...manifest,blocks:blocks.map(({path,kind})=>({path,kind}))}};
 assert.equal(canonicalJSON(expanded),canonicalJSON(expected));assert.equal(canonicalJSON({context,candidate}),before);assert.equal(digest({context,candidate}),binding);
 assert.deepEqual(encoded.canonicalTextTable,[words,words+' Different.']);assert.equal(encoded.canonicalTextTable.includes(context.question),false);assert.equal(encoded.savedHistoryContext.question,context.question);
 assert.equal(encoded.display.metadata.parts[1].output.verses[0].text.canonicalSourceTextAt,0);assert.equal(encoded.manifest.canonicalSources[1].text.canonicalSourceTextAt,0);assert.equal(encoded.savedHistoryContext.evidence[0].manifest[0].output.verses[0].text.canonicalSourceTextAt,0);
 assert.deepEqual(encoded.display.content,{checkedBlock:'body'});assert.match(encoded.blockPointers,/zero-based index/);assert.match(encoded.blockPointers,/literal original object/);
});

const books=JSON.parse(read('src/data/books.json')),names=JSON.parse(read('src/data/book-names.json'));
const localized=['es','de'].flatMap(language=>[...names[language].names.map((name,index)=>[name,index+1]),...Object.entries(names[language].aliases)]);
const forbidden=()=>{throw Error('No network, private DB or real provider in canonical pooling proof');};
const getChapter=async(translation,order,chapter)=>{assert.equal(translation,'KJV');return JSON.parse(read('src/data/kjv/'+books.find(book=>book.order===order).file))[chapter-1]??[];};
const verifyScriptureDraft=new Function('normalizeAssistantMarkdown','analyzeMarkdownUnderscores','markdownRangeHasLiteralUnderscore','BOOKS','LOCALIZED_BOOK_NAMES','getChapter','isTranslationId','getOriginalVerse','getOriginalVerseForKjv','loadBsbChapter',plain(read('src/lib/ai/scripture-verification.ts'))+'\nreturn verifyScriptureDraft;')(normalizeAssistantMarkdown,analyzeMarkdownUnderscores,markdownRangeHasLiteralUnderscore,books,localized,getChapter,value=>value==='KJV',forbidden,forbidden,forbidden);
const verifyGeneratedAnswer=new Function('generateText','Output','z','doctrinalFoundation','getChapter','verifyScriptureDraft','gateAnswer','createDashStripper','HISTORY_REVIEW_CONTEXT_CHARS','COMPLETE_VERIFICATION_REQUEST_CHARS','traceTurn','classifyTurnError',plain(read('src/lib/ai/verified-generation.ts'))+'\nreturn verifyGeneratedAnswer;')(generateText,Output,z,doctrinalFoundation,getChapter,verifyScriptureDraft,gateAnswer,createDashStripper,HISTORY_REVIEW_CONTEXT_CHARS,COMPLETE_VERIFICATION_REQUEST_CHARS,traceTurn,classifyTurnError);
const {historyRenderer:renderer}=await loadHistoryModule('src/lib/ai/history/renderer.ts');
const passage=(await getChapter('KJV',40,6)).map((text,index)=>({reference:'Matthew 6:'+(index+1),translation:'KJV',text,similarity:1}));
const stable=chatSystemPrompt('KJV',{},'en'),source='Complete synthetic profile, memory and current request context. '.padEnd(66_523-stable.length,'v'),system=stable+source,question='Help me study this passage.',body='Let us study the supplied passage.',locator={surface:'chat',parentId:'conversation',messageId:'answer'};
function fixture({createService=createHistoryService,createAdapter=createVerifyOnlyAdapter,formatted='',quoteRepeat=0,reads=2,answer=body,toolOutput=null,systemText=system,sdkTransport=false}={}){
 const db=new FakeRepository();db.addUser('owner');db.addParent('chat','conversation','owner');db.clock=()=>new Date('2026-11-05T00:00:03Z');
 const requestParts=[{type:'text',text:question},...Array.from({length:quoteRepeat},()=>passage.map(verse=>({type:'text',text:verse.text}))).flat()];
 const user={id:'question',role:'user',content:requestParts.map(part=>part.text).join(''),metadata:null,createdAt:'2026-11-05T00:00:01Z'};db.put('chat','conversation',user);
 const reviewer={id:'controlled-reviewer',provider:'mock',providerModelId:'in-memory',pricing:{input:0,output:0},supportsAttachments:true},prompts=[],inputs=[];
 const model=new MockLanguageModelV4({doGenerate:async options=>{const prompt=JSON.parse(options.prompt.find(message=>message.role==='user').content.find(part=>part.type==='text').text);prompts.push(prompt);return{content:[{type:'text',text:JSON.stringify({checkedReferences:prompt.expectedCheckedReferences,checkedOriginalSources:prompt.expectedCheckedOriginalSources,allScriptureQuotationsVerified:true,allCitationsSupportTheirClaims:true,faithfulToFoundation:true,answersRequestedQuestion:true,issues:[],requiredReferences:[]})}],finishReason:{unified:'stop',raw:'stop'},usage:{inputTokens:{total:1},outputTokens:{total:1}},warnings:[]};}});
 const adapter=createAdapter({houseChatModel:async()=>({definition:reviewer}),resolveVerificationModel:async()=>model,providerOptionsForReview:()=>({}),verifyScriptureDraft,verifyGeneratedAnswer});
 const policy={core:{contractVersion:1,projectorVersion:CORE_VERSION,rendererDigest:renderer.digest,checkerVersion:'bundled-checker',corpusDigest:'a'.repeat(64),foundationDigest:'b'.repeat(64),fixedNoticesVersion:1},supportedTranslations:['KJV'],reviewerModelId:reviewer.id};
 const service=createService({repository:db,renderer,loadCurrentPolicy:async()=>structuredClone(policy),validateFreshReviewer:value=>canonicalJSON(value)===canonicalJSON(reviewer),verifyCanonical:verifyScriptureDraft,verifyOnly:forbidden});
 const outputs=Array.from({length:reads},()=>toolOutput?structuredClone(toolOutput):({reference:'Matthew 6',verses:structuredClone(passage),contextVerses:[],coverage:{complete:true},truncated:false,formatted}));
 const draft={content:answer,metadata:{translation:'KJV',parts:[...outputs.flatMap((output,index)=>[...(sdkTransport?[{type:'step-start'}]:[]),{type:'tool-getPassage',toolCallId:'operation-'+index,state:'output-available',input:{book:'Matthew',chapter:6},output,...(sdkTransport?{callProviderMetadata:{openai:{itemId:'synthetic-call-'+index}},resultProviderMetadata:{openai:{itemId:'synthetic-result-'+index}}}:{})}]),...(sdkTransport?[{type:'step-start'}]:[]),{type:'text',text:answer,...(sdkTransport?{state:'done',providerMetadata:{openai:{itemId:'synthetic-answer'}}}:{})}]},actions:outputs.map((output,index)=>({tool:'getPassage',toolCallId:'operation-'+index,success:true,output:structuredClone(output)}))};
 const input={messages:[{id:user.id,role:'user',parts:requestParts}],sources:[user],attachments:[],mediaParts:[],systemContext:systemText,sourceSystemContext:systemText.slice(stable.length),reviewer,review:async value=>{inputs.push(value);return adapter(value);}};
 return{db,service,draft,input,model,prompts,inputs,async prepare(){draft.preparedRequest=await service.prepareRequest('owner',locator,input);return service.prepareFresh('owner',locator,draft);}};
}

test('two owned full Matthew 6 reads with 66523 system cross the real final boundary losslessly without raising any cap',async t=>{
 t.mock.method(globalThis,'fetch',forbidden);t.mock.method(console,'info',()=>{});
 assert.equal(PREPARED_CONTEXT_CHARS,128_000);assert.equal(HISTORY_REVIEW_CONTEXT_CHARS,128_000);assert.equal(COMPLETE_VERIFICATION_REQUEST_CHARS,256_000);assert.equal(system.length,66_523);
 const unpadded=fixture(),first=await unpadded.prepare(),firstData=readFreshPreparation(first.ticket),fullContext=data=>({...data.built.context,preparedRequest:data.prepared.logical,preparedSystemContext:data.prepared.systemContext});
 t.diagnostic(JSON.stringify({twoReadBaselineChars:legacyEnvelope(fullContext(firstData),firstData.built.candidate).length,twoReadPooledChars:first.context.length}));
 // The plain two-read fixture need not overflow. Construct a legal duplicate-word
 // threshold with complete user-supplied passage text parts, then replay both services.
 let f,prepared,data,legacyChars,repeat=0;
 for(;repeat<=3;repeat++){
  f=fixture({quoteRepeat:repeat});prepared=await f.prepare();data=readFreshPreparation(prepared.ticket);legacyChars=legacyEnvelope(fullContext(data),data.built.candidate).length;
  if(legacyChars>HISTORY_REVIEW_CONTEXT_CHARS)break;
 }
 assert.ok(repeat<=3);assert.ok(legacyChars>HISTORY_REVIEW_CONTEXT_CHARS);assert.ok(prepared.context.length<HISTORY_REVIEW_CONTEXT_CHARS);assert.equal(f.model.doGenerateCalls.length,0);assert.ok(f.input.sources[0].content.length<=16_000);
 const before=fixture({createService:legacyService,quoteRepeat:repeat});await assert.rejects(before.prepare(),error=>error.code==='context_limit');assert.equal(before.model.doGenerateCalls.length,0);
 // A test-only generous legacy service permits comparing unchanged authority
 // bindings. It never reviews or calls a provider under that artificial budget.
 const comparison=fixture({createService:legacyBindingService,quoteRepeat:repeat}),old=await comparison.prepare();assert.deepEqual(readFreshPreparation(old.ticket).built.binding,data.built.binding);assert.equal(comparison.model.doGenerateCalls.length,0);
 const original=canonicalJSON({source:data.built.sourceSnapshot,context:data.built.context,display:data.built.display,review:data.built.review}),approval=await f.service.reviewFresh(prepared);assert.equal(approval.verified,true);assert.equal(f.model.doGenerateCalls.length,1);assert.deepEqual(approval.blocks,prepared.blocks);
 const encoded=JSON.parse(f.prompts[0].extraContext),expanded=materialize(encoded,prepared.blocks),{blocks,...manifest}=data.built.review;
 assert.equal(canonicalJSON(expanded),canonicalJSON({savedHistoryContext:fullContext(data),display:data.built.display,manifest:{...manifest,blocks:blocks.map(({path,kind})=>({path,kind}))}}));
 assert.equal(encoded.canonicalTextTable.length,passage.length);assert.equal(f.inputs[0].manifest.canonicalSources.length,passage.length*2);assert.ok(f.inputs[0].manifest.canonicalSources.every(item=>typeof item.text==='string'));
 const semanticEvidenceWords=new Set(f.prompts[0].canonical.contextEvidence.flatMap(ref=>ref.verses.map(item=>item.text)));
 t.diagnostic(JSON.stringify({contextEvidenceReferences:f.prompts[0].canonical.contextEvidence.length,canonicalVerseWordsPresent:passage.filter(verse=>semanticEvidenceWords.has(verse.text)).length}));
 for(const verse of passage)assert.ok(semanticEvidenceWords.has(verse.text));
 assert.equal(canonicalJSON({source:data.built.sourceSnapshot,context:data.built.context,display:data.built.display,review:data.built.review}),original);
 const saved=await f.service.certifyFresh('owner',locator,createFreshHistoryProof(prepared.ticket,approval));assert.equal(saved.state,'verified');for(const part of saved.row.metadata.parts.filter(part=>part.type==='tool-getPassage'))assert.deepEqual(part.output.verses,passage);assert.equal((await f.service.get('owner',locator)).body.state,'verified');assert.equal(f.model.doGenerateCalls.length,1);
 t.diagnostic(JSON.stringify({suppliedPassageRepeatCount:repeat,preparedSystemChars:system.length,legacyReviewChars:legacyChars,pooledReviewChars:prepared.context.length,canonicalTextCount:encoded.canonicalTextTable.length,canonicalSourceCount:f.inputs[0].manifest.canonicalSources.length}));
});

test('three independently checked Matthew 6 reads plus the whole rendered chapter count 34 distinct verses, not 136 occurrences',async t=>{
 t.mock.method(globalThis,'fetch',forbidden);const logs=[];t.mock.method(console,'info',(...args)=>logs.push(args));
 const expanded=await verifyScriptureDraft('[[SCRIPTURE:Matthew 6:1-34]]',{translation:'KJV'});assert.equal(expanded.ok,true);const answer=normalizeAssistantMarkdown(expanded.text,{streaming:false});assert.equal((await verifyScriptureDraft(answer,{translation:'KJV'})).text,answer);
 // Replay the former occurrence-based rejection in the actual adapter body.
 const adapterSource=read('src/lib/ai/history/verify-only.mjs');assert.ok(adapterSource.includes('if(coordinates.size+unknownCoordinates>120)'));
 const formerAdapter=new Function('HistoryError','HISTORY_REVIEW_CONTEXT_CHARS',plain(adapterSource.replace('if(coordinates.size+unknownCoordinates>120)','if(occurrences>120)'))+'\nreturn createVerifyOnlyAdapter;')(HistoryError,HISTORY_REVIEW_CONTEXT_CHARS);
 const before=fixture({createAdapter:formerAdapter,reads:3,answer}),old=await before.prepare();await assert.rejects(before.service.reviewFresh(old),error=>error.code==='context_limit');assert.equal(before.model.doGenerateCalls.length,0);assert.equal(before.db.messages.has('answer'),false);
 const f=fixture({reads:3,answer}),prepared=await f.prepare(),approval=await f.service.reviewFresh(prepared);assert.equal(approval.verified,true);assert.equal(f.model.doGenerateCalls.length,1);assert.deepEqual(approval.blocks,prepared.blocks);
 const budget=logs.filter(([event])=>event==='[canonical-verse-budget]').at(-1)[1];assert.equal(budget.sources,102);assert.equal(budget.sourcesChecked,102);assert.equal(budget.blocksChecked,prepared.blocks.length);assert.equal(budget.occurrences,136);assert.equal(budget.unique,34);assert.equal(budget.budgeted,34);assert.equal(budget.checkFailures,0);assert.ok(Object.values(budget).every(value=>typeof value==='number'));
 const saved=await f.service.certifyFresh('owner',locator,createFreshHistoryProof(prepared.ticket,approval));assert.equal(saved.state,'verified');assert.equal(saved.row.content,answer);assert.deepEqual((await f.service.get('owner',locator)).body.row,saved.row);assert.equal(f.model.doGenerateCalls.length,1);
 t.diagnostic(JSON.stringify({sources:budget.sources,occurrences:budget.occurrences,distinctVerses:budget.unique,finalReviewContextChars:prepared.context.length}));
});

test('121 distinct actual KJV coordinates still refuse before model resolution',async t=>{
 t.mock.method(globalThis,'fetch',forbidden);const logs=[];t.mock.method(console,'info',(...args)=>logs.push(args));
 const checked=await verifyScriptureDraft('[[SCRIPTURE:Psalm 119:1-121]]',{translation:'KJV'});assert.equal(checked.ok,true);assert.equal(checked.references[0].verses.length,121);let resolutions=0;
 const adapter=createVerifyOnlyAdapter({houseChatModel:async()=>{resolutions++;throw Error('Unreachable');},verifyScriptureDraft,resolveVerificationModel:forbidden,providerOptionsForReview:forbidden,verifyGeneratedAnswer:forbidden});
 await assert.rejects(adapter({ownerId:'owner',policy:{supportedTranslations:['KJV'],reviewerModelId:'controlled'},translation:'KJV',question,context:'Complete bounded source.',blocks:[],manifest:{canonicalSources:[{reference:'Psalm 119:1-121',translation:'KJV',text:checked.references[0].canonicalText}]},signal:new AbortController().signal,allowRepair:false}),error=>error.code==='context_limit');
 assert.equal(resolutions,0);const budget=logs.find(([event])=>event==='[canonical-verse-budget]')[1];assert.equal(budget.unique,121);assert.equal(budget.budgeted,121);assert.equal(budget.sourcesChecked,1);
});

test('repeated long owned proof strings retain exact bytes and original authority without pooling singletons or private request text',()=>{
 const repeated=('Owned formatted tool output: "quoted" \\ 😀\n').repeat(20),single='Unique owned output.'.repeat(40),request='Private request context.'.repeat(30),short='Short repeated output.';
 const context={preparedSystemContext:request,history:[{text:request},{text:request}],evidence:[{kind:'owned-durable-action-proof',manifest:[{tool:'getPassage',toolCallId:'first',output:{formatted:repeated,short,unique:single,literal:{reviewTextAt:0}}},{tool:'getPassage',toolCallId:'second',output:{formatted:repeated,short,literal:{canonicalSourceLiteral:{reviewTextAt:0}}}}]}]};
 const candidate={display:{content:'Exact answer.',metadata:{parts:[{type:'text',text:'Exact answer.'}]}},review:{blocks:[{path:'body',kind:'generated',text:'Exact answer.'}],canonicalSources:[],actions:[]}};
 const before=canonicalJSON({context,candidate}),encoded=JSON.parse(reviewEnvelope(context,candidate)),expanded=materialize(encoded,candidate.review.blocks);
 assert.deepEqual(encoded.reviewTextTable,[repeated]);assert.deepEqual(encoded.canonicalTextTable,[]);assert.equal(encoded.savedHistoryContext.preparedSystemContext,request);assert.equal(encoded.savedHistoryContext.history[0].text,request);assert.equal(encoded.savedHistoryContext.evidence[0].manifest[0].output.unique,single);
 assert.equal(canonicalJSON(expanded),canonicalJSON({savedHistoryContext:context,display:candidate.display,manifest:{...candidate.review,blocks:[{path:'body',kind:'generated'}]}}));assert.equal(canonicalJSON({context,candidate}),before);assert.match(encoded.blockPointers,/original authority, never as canonical Scripture evidence/);
});

test('no eligible repeated proof string leaves the previous envelope bytes identical and no extra table',()=>{
 const original='Unique supplied system context. '.repeat(40),answer='Single supplied candidate block. '.repeat(40),proof='One complete owned result. '.repeat(30),context={preparedSystemContext:original,evidence:[{kind:'owned-durable-action-proof',manifest:[{tool:'readNote',toolCallId:'only',output:{formatted:proof}}]}]};
 const candidate={display:{content:answer,metadata:{parts:[{type:'text',text:answer}]}},review:{blocks:[{path:'body',kind:'generated',text:answer}],canonicalSources:[],actions:[]}};
 const withoutProofPool=envelopeSource.replace('const reviewTextTable=[...proofTextCounts].filter(([,count])=>count>1).map(([text])=>text);','const reviewTextTable=[];');assert.notEqual(withoutProofPool,envelopeSource);
 const previous=new Function('canonicalJSON',withoutProofPool+'\nreturn reviewEnvelope;')(canonicalJSON),encoded=reviewEnvelope(context,candidate);assert.equal(encoded,previous(context,candidate));assert.equal(Object.hasOwn(JSON.parse(encoded),'reviewTextTable'),false);
});

test('three shipping getPassage Matthew 6:1-30 outputs fit after lossless owned-proof packing with the real larger prepared system',async t=>{
 t.mock.method(globalThis,'fetch',forbidden);t.mock.method(console,'info',()=>{});
 const aiSource=read('src/lib/ai-tools.ts'),aiFile=ts.createSourceFile('ai-tools.ts',aiSource,ts.ScriptTarget.Latest,true);
 const functionText=(source,name)=>{const file=ts.createSourceFile('source.ts',source,ts.ScriptTarget.Latest,true),node=file.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);assert.ok(node,name);return node.getText(file);};
 const bookApi=new Function('booksJson','bookNamesJson',plain(read('src/lib/bible/books.ts'))+'\nreturn{resolveReference,bookByOrder};')(books,names);
 const kjv=new Function(plain(read('src/utils/kjvBible.ts'))+'\nreturn{getKjvBookNumber,getKjvBookName};')();
 const canonicalPassage=new Function('getChapter','resolveReference','bookByOrder',plain(read('src/lib/bible/passage-context.ts'))+'\nreturn canonicalPassage;')(getChapter,bookApi.resolveReference,bookApi.bookByOrder);
 const formatVersesForModel=new Function(plain(functionText(read('src/lib/scripture-search.ts'),'formatVersesForModel'))+'\nreturn formatVersesForModel;')();
 const formatPassageCoverage=new Function(plain(functionText(aiSource,'formatPassageCoverage'))+'\nreturn formatPassageCoverage;')();
 const scriptureBookNumber=new Function('getKjvBookNumber','resolveReference',plain(functionText(aiSource,'scriptureBookNumber'))+'\nreturn scriptureBookNumber;')(kjv.getKjvBookNumber,bookApi.resolveReference);
 const readPassageVerses=new Function('getChapter','bookByOrder',plain('const MAX_PASSAGE_VERSES=30;\n'+functionText(aiSource,'passageReference')+'\n'+functionText(aiSource,'readPassageVerses'))+'\nreturn readPassageVerses;')(getChapter,bookApi.bookByOrder);
 let execute;
 const visit=node=>{if(ts.isVariableDeclaration(node)&&node.name.getText(aiFile)==='getPassageTool'){const definition=node.initializer.arguments[0];execute=definition.properties.find(property=>property.name?.getText(aiFile)==='execute').initializer.getText(aiFile);}ts.forEachChild(node,visit);};visit(aiFile);assert.ok(execute);
 const getPassage=new Function('scriptureBookNumber','getKjvBookName','readPassageVerses','canonicalPassage','formatVersesForModel','formatPassageCoverage','translation','return '+stripTypeScriptTypes('('+execute+')')+';')(scriptureBookNumber,kjv.getKjvBookName,readPassageVerses,canonicalPassage,formatVersesForModel,formatPassageCoverage,'KJV');
 const output=await getPassage({book:'Matthew',chapter:6,verseStart:1,verseEnd:30});assert.equal(output.truncated,false);assert.equal(output.coverage.truncated,false);assert.equal(output.verses.length,30);assert.equal(output.contextVerses.length,3);assert.ok(output.formatted.length>=512);
 const expanded=await verifyScriptureDraft('[[SCRIPTURE:Matthew 6:1-30]]',{translation:'KJV'});assert.equal(expanded.ok,true);const answer=normalizeAssistantMarkdown(expanded.text,{streaming:false});
 // The only disabled candidate feature is the new repeated owned-text table.
 const previousSource=serviceSource.replace("const reviewTextTable=[...proofTextCounts].filter(([,count])=>count>1).map(([text])=>text);",'const reviewTextTable=[];');assert.notEqual(previousSource,serviceSource);
 const loadPrevious=async generous=>{let code=previousSource;if(generous)code=code.replace("import {HISTORY_REVIEW_CONTEXT_CHARS} from '../verification-limits.mjs';",'const HISTORY_REVIEW_CONTEXT_CHARS=256_000;');code=code.replace(/from '(\.{1,2}\/[^']+)'/g,(_match,spec)=>'from '+JSON.stringify(new URL('../src/lib/ai/history/'+spec,import.meta.url).href));return import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));};
 const {createHistoryService:previousService}=await loadPrevious(false),{createHistoryService:previousBindingService}=await loadPrevious(true);
 const bareSystem=stable+'Complete synthetic profile and sixty saved memories. '.padEnd(66_523-stable.length,'v'),bareOptions={reads:3,answer,toolOutput:output,systemText:bareSystem};
 const bare=fixture(bareOptions),barePrepared=await bare.prepare(),barePrevious=fixture({...bareOptions,createService:previousService}),bareOld=await barePrevious.prepare();
 assert.ok(bareOld.context.length<HISTORY_REVIEW_CONTEXT_CHARS);assert.equal(bare.model.doGenerateCalls.length,0);assert.equal(barePrevious.model.doGenerateCalls.length,0);
 t.diagnostic(JSON.stringify({barePreparedSystemChars:66_523,barePreviousReviewChars:bareOld.context.length,barePackedReviewChars:barePrepared.context.length}));
 for(const systemChars of [66_523,68_600]){
  const systemText=stable+'Complete synthetic profile and sixty saved memories. '.padEnd(systemChars-stable.length,'v'),options={reads:3,answer,toolOutput:output,systemText,sdkTransport:true};
  const f=fixture(options),prepared=await f.prepare(),data=readFreshPreparation(prepared.ticket),old=fixture({...options,createService:previousBindingService}),oldPrepared=await old.prepare(),oldData=readFreshPreparation(oldPrepared.ticket);
  assert.deepEqual(data.built.binding,oldData.built.binding);assert.equal(old.model.doGenerateCalls.length,0);assert.ok(prepared.context.length<HISTORY_REVIEW_CONTEXT_CHARS);
  const previousChars=oldPrepared.context.length;t.diagnostic(JSON.stringify({preparedSystemChars:systemChars,previousReviewChars:previousChars,packedReviewChars:prepared.context.length,formattedChars:output.formatted.length}));
  if(systemChars===68_600)assert.ok(previousChars>HISTORY_REVIEW_CONTEXT_CHARS,'Shipping three-read fixture must reproduce the old final limit with the observed prepared system');
  const blocked=fixture({...options,createService:previousService});if(previousChars>HISTORY_REVIEW_CONTEXT_CHARS)await assert.rejects(blocked.prepare(),error=>error.code==='context_limit');else await blocked.prepare();assert.equal(blocked.model.doGenerateCalls.length,0);
  const approval=await f.service.reviewFresh(prepared);assert.equal(approval.verified,true);assert.equal(f.model.doGenerateCalls.length,1);assert.deepEqual(approval.blocks,prepared.blocks);
  const encoded=JSON.parse(f.prompts[0].extraContext),restored=materialize(encoded,prepared.blocks),{blocks,...manifest}=data.built.review;
  assert.deepEqual(encoded.reviewTextTable,[output.formatted]);assert.equal(encoded.canonicalTextTable.includes(output.formatted),false);assert.equal(encoded.canonicalTextTable.length,30);
  assert.equal(canonicalJSON(restored),canonicalJSON({savedHistoryContext:{...data.built.context,preparedRequest:data.prepared.logical,preparedSystemContext:data.prepared.systemContext},display:data.built.display,manifest:{...manifest,blocks:blocks.map(({path,kind})=>({path,kind}))}}));
  const operations=restored.savedHistoryContext.evidence.find(evidence=>evidence.kind==='owned-durable-action-proof').manifest;assert.equal(operations.length,3);for(const operation of operations)assert.deepEqual(operation.output,output);
  assert.equal(f.inputs[0].manifest.canonicalSources.length,90);assert.ok(f.inputs[0].manifest.canonicalSources.every(source=>typeof source.text==='string'));
  const saved=await f.service.certifyFresh('owner',locator,createFreshHistoryProof(prepared.ticket,approval));assert.equal(saved.state,'verified');assert.equal(saved.row.content,answer);assert.deepEqual((await f.service.get('owner',locator)).body.row,saved.row);assert.equal(f.model.doGenerateCalls.length,1);
 }
});

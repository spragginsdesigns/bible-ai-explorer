/** Portable product regression. No provider, auth, network, database or device.
 * HISTORY_TEST_SOURCE_ROOT chooses the checkout. Optional
 * HISTORY_POINTER_SERVICE_CANDIDATE supplies a private service.mjs candidate.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=process.env.HISTORY_TEST_SOURCE_ROOT?resolve(process.env.HISTORY_TEST_SOURCE_ROOT):resolve(dirname(fileURLToPath(import.meta.url)),'..');
const {loadHistoryModule}=await import(pathToFileURL(root+'/tests/history-loader.mjs'));
const {FakeRepository}=await import(pathToFileURL(root+'/tests/history-fake-repository.mjs'));
const {CORE_VERSION,canonicalJSON}=await import(pathToFileURL(root+'/src/lib/ai/history/projection.mjs'));
const {historyRenderer:renderer}=await loadHistoryModule('src/lib/ai/history/renderer.ts');
let serviceURL=pathToFileURL(root+'/src/lib/ai/history/service.mjs').href;
if(process.env.HISTORY_POINTER_SERVICE_CANDIDATE){
 const candidate=readFileSync(resolve(process.env.HISTORY_POINTER_SERVICE_CANDIDATE),'utf8');
 // A private copy keeps production relative imports bound to the chosen tree.
 const resolved=candidate.replace(/from '(\.\/[^']+)'/g,(_match,spec)=>'from '+JSON.stringify(pathToFileURL(resolve(root+'/src/lib/ai/history',spec)).href));
 serviceURL='data:text/javascript;base64,'+Buffer.from(resolved).toString('base64');
}
const {createHistoryService}=await import(serviceURL);
const body='Study this passage.';
const card={type:'tool-showInApp',toolCallId:'read-only-card',state:'output-available',input:{},output:{target:'tab.bible',caption:'Open the Bible.'}};
const scenarios={
 prose:{content:body,metadata:{translation:'KJV',parts:[{type:'text',text:body}]}},
 cards:{content:body,metadata:{translation:'KJV',parts:[{type:'text',text:body},structuredClone(card)],followUps:['What should I study next?','How does this passage apply?']}},
 duplicates:{content:body,metadata:{translation:'KJV',parts:[{type:'text',text:body},{...structuredClone(card),output:{target:'tab.bible',caption:body}}],followUps:[body,'What should I study next?']}},
};
function validatePointers(input,display){
 assert.equal(input.allowRepair,false);
 assert.equal(new Set(input.blocks.map(b=>b.id)).size,input.blocks.length,'Unique block IDs');
 assert.deepEqual(input.blocks.map(b=>b.id),input.manifest.blocks.map(b=>b.path),'Use actual stable projection paths');
 assert.deepEqual(input.blocks.map(b=>b.text),input.manifest.blocks.map(b=>b.text),'Exact projected text/order');
 const byId=new Map(input.blocks.map(b=>[b.id,b.text])),envelope=JSON.parse(input.context);
 const {blocks,...rawManifest}=input.manifest;const expectedManifest={...rawManifest,blocks:blocks.map(({path,kind})=>({path,kind}))};let count=0;
 function resolveValue(value,expected,path){
  if(value&&typeof value==='object'&&!Array.isArray(value)&&Object.hasOwn(value,'checkedBlock')){
   assert.deepEqual(Object.keys(value),['checkedBlock'],path+' pointer shape');
   assert.ok(byId.has(value.checkedBlock),path+' resolves '+value.checkedBlock);
   assert.equal(typeof expected,'string',path+' points to exact string');
   assert.equal(byId.get(value.checkedBlock),expected,path+' resolves correct literal text');count++;return expected;
  }
  if(Array.isArray(value)){assert.ok(Array.isArray(expected));assert.equal(value.length,expected.length);return value.map((v,i)=>resolveValue(v,expected[i],path+'['+i+']'));}
  if(value&&typeof value==='object'){assert.ok(expected&&typeof expected==='object');assert.deepEqual(Object.keys(value).sort(),Object.keys(expected).sort());return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,resolveValue(v,expected[key],path+'.'+key)]));}
  assert.equal(value,expected,path+' literal unchanged');return value;
 }
 assert.deepEqual(resolveValue(envelope.display,display,'display'),display,'Expanded envelope preserves exact display');
 assert.deepEqual(resolveValue(envelope.manifest,expectedManifest,'manifest'),expectedManifest,'Expanded envelope preserves full manifest');
 assert.ok(count>=2,'Actual body display and text-part pointers exercised');return count;
}
async function run(surface,scenario,corrupt){
 const db=new FakeRepository();db.addUser('owner');db.addParent(surface,'parent','owner');db.clock=()=>new Date('2026-11-02T00:00:03.000Z');
 const row={id:'answer',role:'assistant',...structuredClone(scenario),createdAt:'2026-11-02T00:00:02.000Z'};
 db.put(surface,'parent',{id:'question',role:'user',content:'Explain this study without taking any action.',metadata:null,createdAt:'2026-11-02T00:00:01.000Z'});db.put(surface,'parent',row);
 const before=canonicalJSON(row),captures=[];let calls=0,rejections=0;
 const policy={core:{contractVersion:1,projectorVersion:CORE_VERSION,rendererDigest:renderer.digest,checkerVersion:'pointer-contract-fixture',corpusDigest:'a'.repeat(64),foundationDigest:'b'.repeat(64),fixedNoticesVersion:1},supportedTranslations:['KJV'],reviewerModelId:'offline-contract-review'};
 const service=createHistoryService({repository:db,renderer,loadCurrentPolicy:async()=>structuredClone(policy),verifyOnly:async input=>{
  calls++;assert.equal(db.depth.get('owner'),0,'Review outside fake transaction');assert.equal(input.allowRepair,false);
  const display=structuredClone([...db.reviews.values()][0].sanitizedDisplay);captures.push({blocks:structuredClone(input.blocks),display,context:input.context,manifest:structuredClone(input.manifest)});
  if(corrupt)corrupt(input);
  let valid=true;try{validatePointers(input,display);}catch{valid=false;rejections++;}
  return{verified:valid,canonicalPassed:true,semanticPassed:valid,repaired:false,blocks:structuredClone(input.blocks),reviewerModelId:input.policy.reviewerModelId};
 }});
 const locator={surface,parentId:'parent',messageId:'answer'},initial=await service.get('owner',locator);assert.equal(initial.body.state,'withheld');assert.equal(calls,0);
 const result=await service.recheck('owner',locator,initial.body.sourceDigest);const final=await service.get('owner',locator);
 assert.equal(calls,1,'Exactly one review dependency call; no retry');assert.equal(canonicalJSON(db.messages.get('answer').row),before,'Original row/metadata bytes preserved');
 if(!corrupt){assert.equal(result.status,200,'Valid projected pointers must verify');assert.equal(result.body.state,'verified');assert.equal(rejections,0);assert.deepEqual(final.body.row,captures[0].display,'Released row exactly equals reviewed display');await service.recheck('owner',locator,initial.body.sourceDigest);assert.equal(calls,1,'Cached exact binding does not re-review');}
 else{assert.equal(result.status,422,'Invalid or wrong pointer stays withheld');assert.equal(result.body.code,'semantic_rejected');assert.equal(final.body.state,'withheld');assert.equal(rejections,1);assert.equal(final.body.row.content.includes(body),false,'Original text never leaks on rejection');}
 return captures[0];
}
for(const surface of ['chat','note'])for(const[name,scenario]of Object.entries(scenarios))test(surface+' '+name+': real recheck pointers resolve uniquely/stably and preserve display',async t=>{
 t.mock.method(globalThis,'fetch',()=>{throw Error('Network forbidden');});
 const first=await run(surface,scenario),second=await run(surface,scenario);assert.deepEqual(first,second,'Identical source has stable IDs/text/display/envelope');
 if(name!=='prose')assert.ok(first.blocks.length>=4,'Multiple body/card/chip blocks exercised');
 if(name==='duplicates')assert.ok(first.blocks.filter(b=>b.text===body).length>=3,'Duplicate text at distinct projected paths exercised');
});
for(const surface of ['chat','note'])for(const corruption of ['missing','wrong-existing','duplicate-id'])test(surface+' '+corruption+' pointer control stays failed',async t=>{
 t.mock.method(globalThis,'fetch',()=>{throw Error('Network forbidden');});
 await run(surface,scenarios.cards,input=>{
  if(corruption==='duplicate-id'){input.blocks[1].id=input.blocks[0].id;return;}
  const envelope=JSON.parse(input.context);
  envelope.display.content={checkedBlock:corruption==='missing'?'missing-block-id':input.blocks.find(b=>b.text==='tab.bible').id};
  input.context=canonicalJSON(envelope);
 });
});

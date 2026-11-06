import test from 'node:test';
import assert from 'node:assert/strict';
import {createVerifyOnlyAdapter} from '../src/lib/ai/history/verify-only.mjs';
const coordinate=(verse=1)=>({order:40,chapter:6,verse});
const words='Exact canonical source.';
const source=translation=>({reference:'Synthetic checked coordinate',translation,text:words});
function fixture({sources=[source('KJV')],blocks=[{id:'body',text:'Exact prose.'}],check=async text=>({ok:true,text,references:[{canonicalText:words,verses:[coordinate()]}]})}={}){
 let checked=0,resolutions=0,models=0,generations=0;const seen=[];
 const input={ownerId:'owner',policy:{supportedTranslations:['KJV','ASV'],reviewerModelId:'approved'},translation:'KJV',question:'Question',context:'Complete bounded context.',blocks,manifest:{canonicalSources:sources},signal:new AbortController().signal,allowRepair:false,authorizeInference:async()=>{}};
 const adapter=createVerifyOnlyAdapter({houseChatModel:async()=>{resolutions++;return{definition:{id:'approved'}};},resolveVerificationModel:async()=>{models++;return{};},providerOptionsForReview:()=>({}),verifyScriptureDraft:async(text,options)=>{checked++;seen.push({text,...options});return check(text,options,checked);},verifyGeneratedAnswer:async values=>{generations++;return{verified:true,repaired:false,blocks:values,issueCodes:[]};}});
 return{adapter,input,seen,counts:()=>({checked,resolutions,models,generations})};
}
const capture=t=>{const logs=[];t.mock.method(console,'info',(...args)=>logs.push(args));return()=>{const entries=logs.filter(([event])=>event==='[canonical-verse-budget]');for(const[,value]of entries){assert.ok(Object.values(value).every(item=>typeof item==='number'&&Number.isFinite(item)));assert.equal(value.limit,120);}return entries.at(-1)?.[1];};};

test('repeated checked coordinates share budget without caching any source or prose check',async t=>{
 const report=capture(t),verses=Array.from({length:34},(_,index)=>coordinate(index+1));
 const f=fixture({sources:[source('KJV'),source('KJV'),source('KJV')],check:async text=>({ok:true,text,references:[{canonicalText:words,verses}]})});
 assert.equal((await f.adapter(f.input)).verified,true);assert.deepEqual(f.counts(),{checked:4,resolutions:1,models:1,generations:1});
 const budget=report();assert.equal(budget.occurrences,136);assert.equal(budget.unique,34);assert.equal(budget.budgeted,34);assert.equal(budget.sourcesChecked,3);assert.equal(budget.blocksChecked,1);
});

test('later duplicate raw source text is still checked and cannot borrow the first successful copy',async t=>{
 const report=capture(t),sources=[source('KJV'),source('KJV'),{...source('KJV'),text:'Altered later duplicate.'}],f=fixture({sources});
 const result=await f.adapter(f.input);assert.equal(result.verified,false);assert.equal(result.canonicalPassed,false);assert.deepEqual(f.counts(),{checked:3,resolutions:0,models:0,generations:0});assert.equal(report().checkFailures,1);assert.equal(report().sourcesChecked,3);
});

test('later duplicate prose is independently checked for exact bytes and canonical rejection',async t=>{
 const report=capture(t),f=fixture({sources:[source('KJV'),source('KJV')],blocks:[{id:'first',text:'Exact prose.'},{id:'second',text:'Altered prose.'}],check:async text=>({ok:true,text:text==='Altered prose.'?'Rewritten prose.':text,references:[{canonicalText:words,verses:[coordinate()]}]})});
 const result=await f.adapter(f.input);assert.equal(result.verified,false);assert.equal(result.canonicalPassed,false);assert.deepEqual(f.counts(),{checked:4,resolutions:0,models:0,generations:0});assert.equal(report().checkFailures,1);assert.equal(report().blocksChecked,2);
});

test('failed canonical reference validation cannot be counted or reach a model',async t=>{
 const report=capture(t),f=fixture({check:async text=>({ok:true,text,references:[{canonicalText:words,verses:[coordinate()]},{canonicalText:words,verses:[coordinate(2)]}]})});
 assert.equal((await f.adapter(f.input)).canonicalPassed,false);assert.equal(f.counts().generations,0);assert.equal(report().occurrences,0);assert.equal(report().checkFailures,1);
});

test('missing and structurally invalid coordinates each conservatively consume a fresh occurrence',async t=>{
 const report=capture(t);
 for(const invalid of [{},{order:undefined,chapter:6,verse:1},{order:'40',chapter:6,verse:1},{order:40,chapter:0,verse:1},{order:40,chapter:6,verse:NaN},{order:40.5,chapter:6,verse:1},{order:67,chapter:6,verse:1},{order:40,chapter:151,verse:1},{order:40,chapter:6,verse:177}]){
  const f=fixture({sources:[],check:async text=>({ok:true,text,references:[{verses:Array(121).fill(invalid)}]})});
  await assert.rejects(f.adapter(f.input),error=>error.code==='context_limit');assert.equal(f.counts().checked,1);assert.equal(f.counts().resolutions,0);const budget=report();assert.equal(budget.unique,0);assert.equal(budget.unknownCoordinates,121);assert.equal(budget.budgeted,121);
 }
 for(const absent of [undefined,[]]){
  const f=fixture({sources:[],check:async text=>({ok:true,text,references:Array.from({length:121},()=>({verses:absent}))})});
  await assert.rejects(f.adapter(f.input),error=>error.code==='context_limit');assert.equal(f.counts().resolutions,0);assert.equal(report().unknownCoordinates,121);
 }
});

test('the same coordinate in another translation consumes a separate budget entry',async t=>{
 const report=capture(t),verses=Array.from({length:61},(_,index)=>({order:19,chapter:119,verse:index+1}));
 for(const second of ['KJV','ASV']){
  const f=fixture({sources:[source('KJV'),source(second)],blocks:[],check:async text=>({ok:true,text,references:[{canonicalText:words,verses}]})});
  if(second==='KJV'){assert.equal((await f.adapter(f.input)).verified,true);assert.equal(report().unique,61);assert.equal(report().occurrences,122);}
  else{await assert.rejects(f.adapter(f.input),error=>error.code==='context_limit');assert.equal(f.counts().resolutions,0);assert.equal(report().unique,121);}
  assert.equal(f.counts().checked,2);assert.deepEqual(f.seen.map(item=>item.translation),['KJV',second]);
 }
});

test('source-entry, block-count, prose and complete-context guards remain independent of deduplication',async t=>{
 capture(t);
 for(const kind of ['sources','blocks','prose','context']){
  const f=fixture();if(kind==='sources')f.input.manifest.canonicalSources=Array.from({length:121},()=>source('KJV'));
  if(kind==='blocks')f.input.blocks=Array.from({length:33},(_,index)=>({id:String(index),text:'Exact prose.'}));
  if(kind==='prose')f.input.blocks=[{id:'body',text:'x'.repeat(80_001)}];if(kind==='context')f.input.context='x'.repeat(128_001);
  await assert.rejects(f.adapter(f.input),error=>error.code==='context_limit');assert.deepEqual(f.counts(),{checked:0,resolutions:0,models:0,generations:0});
 }
});

test('budget diagnostics cannot change canonical approval or refusal',async t=>{
 t.mock.method(console,'info',()=>{throw Error('Logging unavailable');});const good=fixture();assert.equal((await good.adapter(good.input)).verified,true);
 const bad=fixture({check:async text=>({ok:false,text,references:[]})});assert.equal((await bad.adapter(bad.input)).canonicalPassed,false);assert.equal(bad.counts().generations,0);
});

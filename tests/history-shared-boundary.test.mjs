import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
import * as share from '../src/lib/shared-answer.ts';
import * as markdown from '../src/utils/assistantMarkdown.ts';
const module={exports:{}};
const compiled=ts.transpileModule(readFileSync(new URL('../src/lib/ai/history/shared-boundary.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
new Function('require','module','exports',compiled)(id=>{
 if(id==='../../shared-answer')return share;
 if(id==='../../../utils/assistantMarkdown')return markdown;
 throw Error('Unexpected runtime dependency '+id);
},module,module.exports);
const {reviewedShareSource,sharedSnapshotMatches}=module.exports;
const source={userId:'owner',conversationId:'parent',messageId:'answer'};
const row={id:'answer',role:'assistant',content:'Checked answer.\n\n[FOLLOWUP] Next?',metadata:{translation:'KJV',parts:[{type:'text',text:'Checked answer.'}],retrievedVerses:[{reference:'John 3:16'}]}};
const body={state:'verified',sourceDigest:'a'.repeat(64),row};
test('public sharing uses only current checked display and preserves exact snapshots',async()=>{
 let calls=0;
 const checked=await reviewedShareSource({get:async(owner,locator)=>{calls++;assert.equal(owner,'owner');assert.deepEqual(locator,{surface:'chat',parentId:'parent',messageId:'answer'});return{status:200,body};}},source);
 assert.deepEqual(checked,{answer:'Checked answer.',references:['John 3:16'],translation:'KJV'});assert.equal(calls,1);
 assert.equal(sharedSnapshotMatches(checked,checked),true);
 for(const change of [{answer:'Unchecked older text'},{translation:'BSB'},{references:['John 3:17']}])assert.equal(sharedSnapshotMatches({...checked,...change},checked),false);
});
test('unchecked, forged, unavailable and deleted sources cannot reach public cards',async()=>{
 for(const altered of [{...body,state:'withheld'},{...body,state:'notice'},{...body,state:['verified']},{...body,sourceDigest:null},{...body,row:{...row,id:'another'}},{...body,row:{...row,metadata:{parts:[]}}}]){
  assert.equal(await reviewedShareSource({get:async()=>({status:200,body:altered})},source),null);
 }
 assert.equal(await reviewedShareSource({get:async()=>({status:404,body:null})},source),null);
 assert.equal(await reviewedShareSource({get:async()=>{throw Error('private')}} ,source),null);
 assert.equal(await reviewedShareSource({get:async()=>{throw Error('must not call')}} ,{...source,messageId:null}),null);
});

test('public snapshots reject contradictory verification markers and malformed typed parts',async()=>{
	for(const historyVerification of [undefined,null,{state:'withheld'}]){
		const altered={...body,row:{...row,metadata:{...row.metadata,historyVerification}}};
		assert.equal(await reviewedShareSource({get:async()=>({status:200,body:altered})},source),null);
	}
	for(const part of [null,[],'text',{}, {type:7}]){
		const altered={...body,row:{...row,metadata:{...row.metadata,parts:[part]}}};
		assert.equal(await reviewedShareSource({get:async()=>({status:200,body:altered})},source),null);
	}
});

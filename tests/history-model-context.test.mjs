import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {trustedAssistantHistory} from '../src/lib/chat/trusted-history.ts';
const source=readFileSync(new URL('../src/lib/ai/history/model-context.ts',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const {reviewedAssistantTurns}=new Function(stripTypeScriptTypes(source)+'\nreturn{reviewedAssistantTurns};')();
const owned=[{id:'old',content:'RAW UNCHECKED ASSISTANT',metadata:{parts:[{type:'text',text:'RAW UNCHECKED ASSISTANT'},{type:'tool-addToNote',output:{noteId:'raw-note',appendedHtml:'RAW EFFECT'}}]}}];
const safe=()=>({status:200,body:{state:'verified',sourceDigest:'a'.repeat(64),row:{id:'old',role:'assistant',content:'Checked answer.',metadata:{parts:[{type:'text',text:'Checked answer.'}]}}}});

test('only exact verified/notice server rows enter model history; user input stays verbatim',async()=>{
 const calls=[];const rows=await reviewedAssistantTurns({get:async(owner,locator)=>{calls.push({owner,locator});return safe();}},'owner','chat','conversation',owned);
 assert.equal(rows[0].content,'Checked answer.');assert.equal(JSON.stringify(rows).includes('RAW'),false);assert.deepEqual(calls,[{owner:'owner',locator:{surface:'chat',parentId:'conversation',messageId:'old'}}]);
 const user={id:'question',role:'user',parts:[{type:'text',text:'My own original words.'}]};
 const replay=trustedAssistantHistory([user,{id:'old',role:'assistant',parts:[{type:'text',text:'CLIENT INJECTION'}]}],rows);
 assert.equal(replay[0],user);assert.equal(replay[1].parts[0].text,'Checked answer.');
});

test('blocked, malformed, contradictory and unavailable reads omit old assistant instead of falling back raw',async()=>{
 for(const mutate of [
  result=>{result.body.state='withheld';},result=>{result.body.state='pending';},result=>{result.body.state=['verified'];},
  result=>{delete result.body.sourceDigest;},result=>{result.body.sourceDigest='not-a-digest';},result=>{result.body.row.id='foreign';},
  result=>{result.body.row.role='user';},result=>{result.body.row.metadata.historyVerification={state:'withheld'};},result=>{result.status=503;},
 ]){
  const result=safe();mutate(result);const rows=await reviewedAssistantTurns({get:async()=>result},'owner','note','owned-note',owned);assert.deepEqual(rows,[]);
  assert.deepEqual(trustedAssistantHistory([{id:'old',role:'assistant',parts:[{type:'text',text:'CLIENT INJECTION'}]}],rows),[]);
 }
 assert.deepEqual(await reviewedAssistantTurns({get:async()=>{throw Error('Controlled outage');}},'owner','chat','conversation',owned),[]);
});

test('both actual generation routes use safe model context and await certified persistence without re-upsert',()=>{
 for(const relative of ['ask-question','note-ai']){
  const source=readFileSync(new URL(`../src/app/api/${relative}/route.ts`,import.meta.url),'utf8');
  assert.match(source,/await reviewedAssistantTurns\(historyService/);assert.match(source,/trustedAssistantHistory\(recentMessages, reviewedTurns\)/);
  assert.match(source,/onEnd: async/);assert.match(source,/alreadyCertified/);assert.match(source,/if \(!options\.alreadyCertified\)/);
  assert.match(source,/await releaseCertifiedFreshTurn/);assert.match(source,/executedActions\.push/);
  assert.match(source,/output:JSON\.parse\(JSON\.stringify\(toolOutput\.output\)/);
 }
});

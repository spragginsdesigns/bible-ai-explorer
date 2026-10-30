import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import ts from 'typescript';
import * as rules from '../src/lib/chat/history-review.ts';
const source=ts.transpileModule(readFileSync(new URL('../src/components/chat/HistoryReviewCard.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const review={surface:'chat',parentId:'owned-parent',messageId:'answer',state:'withheld',code:'review_required',sourceDigest:'a'.repeat(64)};
const row={id:'answer',role:'assistant',content:'Checked answer.',metadata:{parts:[{type:'text',text:'Checked answer.'}]}};
function harness(fetch){
 let owner={userId:'owner-a',sessionId:'session-a'};const rendered=[],requests=[];
 const module={exports:{}};new Function('require','module','exports',source)(id=>{
  if(id==='react')return React;
  if(id==='@clerk/nextjs')return{useAuth:()=>owner};
  if(id==='@/lib/chat/history-review')return rules;
  if(id==='@/lib/ai-consent-gate')return{consentFetch:async(path,options)=>{requests.push({path,options});return fetch(path,options);}};
  throw Error('Unexpected dependency '+id);
 },module,module.exports);
 const Component=module.exports.default;const props=next=>({review:next??review,renderVerified:checked=>{rendered.push(checked);return React.createElement('span',null,checked.content);}});
 let view;act(()=>{view=TestRenderer.create(React.createElement(Component,props()));});
 return{view,rendered,requests,setOwner:next=>{owner=next;},update:next=>act(()=>view.update(React.createElement(Component,props(next)))),click:()=>act(()=>view.root.findByType('button').props.onClick())};
}
test('held checked answer cannot publish after account, session, digest changes or unmount',async()=>{
 for(const kind of ['account','session','digest','unmount']){
  const held=deferred(),h=harness(()=>held.promise);h.click();
  if(kind==='account')h.setOwner({userId:'owner-b',sessionId:'session-b'});
  if(kind==='session')h.setOwner({userId:'owner-a',sessionId:'replacement-session'});
  if(kind==='unmount')act(()=>h.view.unmount());else h.update(kind==='digest'?{...review,sourceDigest:'b'.repeat(64)}:review);
  await act(async()=>{held.resolve(Response.json({state:'verified',sourceDigest:review.sourceDigest,row}));await tick();});
  assert.equal(h.rendered.length,0,kind);assert.equal(h.requests[0].options.signal.aborted,true,kind);
  if(kind!=='unmount')act(()=>h.view.unmount());
 }
});
test('recheck sends only immutable locator/digest and renders the authoritative matching GET',async()=>{
 let reads=0;const h=harness((path,options)=>{
  if(options?.method==='POST'){
   assert.deepEqual(JSON.parse(options.body),{surface:'chat',parentId:'owned-parent',messageId:'answer',expectedSourceDigest:review.sourceDigest});
   return Response.json({state:'verified'});
  }
  return Response.json(++reads===1?{state:'withheld',sourceDigest:review.sourceDigest}:{state:'verified',sourceDigest:review.sourceDigest,row});
 });
 await act(async()=>{h.click();await tick();await tick();});assert.ok(h.rendered.length>=1);for(const rendered of h.rendered)assert.deepEqual(rendered,row);assert.equal(h.requests.length,3);act(()=>h.view.unmount());
});
test('changed source never triggers review or exposes returned prose',async()=>{
 const h=harness(()=>Response.json({state:'verified',sourceDigest:'b'.repeat(64),row}));
 await act(async()=>{h.click();await tick();});assert.equal(h.rendered.length,0);assert.equal(h.requests.length,1);assert.match(JSON.stringify(h.view.toJSON()),/Reopen the conversation/);act(()=>h.view.unmount());
});
test('malformed marker offers no executable check or download',()=>{
 const h=harness(()=>{throw Error('No request should run');});h.update(rules.savedAnswerReview(null,'answer'));assert.equal(h.view.root.findByType('button').props.disabled,true);assert.equal(h.view.root.findAllByType('a').length,0);h.click();assert.equal(h.requests.length,0);act(()=>h.view.unmount());
});

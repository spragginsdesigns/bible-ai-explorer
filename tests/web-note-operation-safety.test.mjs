import assert from "node:assert/strict";
import test from "node:test";
import { Schema } from "@tiptap/pm/model";
import { createNoteAIOperation, userForNoteReply } from "../src/lib/notes/note-ai-operation.ts";
import { adoptCanonicalDocument } from "../src/lib/notes/canonical-document.ts";
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
let sequence = 0;
function harness(noteId = `web-note-${++sequence}`, values = new Map()) {
 let nextId = 0;
 const calls = { reserve: [], cancel: [], adopted: [] };
 const deps = {
  accountId: "owner", noteId, newId: () => `00000000-0000-4000-8000-${String(++nextId).padStart(12,"0")}`, isCurrent: () => true,
  storage: { getItem: async key => values.get(key) ?? null, setItem: async (key,value) => { values.set(key,value); }, removeItem: async key => { values.delete(key); } },
  prepare: async () => true,
  reserve: async body => { calls.reserve.push(body); return { id: body.operationId, state:"reserved" }; },
  read: async id => ({id,state:"settled"}), cancel: async id => { calls.cancel.push(id); return {id,state:"cancelled"}; },
  canonical: async () => "canonical", adopt: async html => { calls.adopted.push(html); return true; }, changed: () => {},
 };
 return { controller:createNoteAIOperation(deps), deps, calls, values };
}
const body = { messages:[{id:"user-one",role:"user",parts:[{type:"text",text:"rewrite"}]}], timezone:"America/Los_Angeles" };
const turn = () => new Promise(resolve => setTimeout(resolve,0));
test("web reserve receives exactly the immutable body later sent to note-ai",async()=>{
 const h=harness(); await h.controller.initialize(); const saved=deferred();
 h.deps.storage.setItem=async(key,value)=>{await saved.promise;h.values.set(key,value);};
 const starting=h.controller.begin(body); await turn(); assert.equal(h.calls.reserve.length,0);assert.equal(h.controller.canSave(),false);
 saved.resolve(); const request=await starting;assert.deepEqual(h.calls.reserve,[request]);assert.deepEqual(request.messages,body.messages);assert.equal(request.noteId,h.deps.noteId);
});
test("stream loss requires terminal cancellation and full canonical read before manual save",async()=>{
 const h=harness();await h.controller.initialize();const request=await h.controller.begin(body);h.deps.read=async id=>({id,state:"running"});
 const cancelled=deferred();h.deps.cancel=async id=>{h.calls.cancel.push(id);return cancelled.promise;};
 const restoring=h.controller.recover(request.operationId);await turn();assert.equal(h.controller.canSave(),false);assert.deepEqual(h.calls.adopted,[]);
 cancelled.resolve({id:request.operationId,state:"cancelled"});assert.equal(await restoring,true);assert.deepEqual(h.calls.adopted,["canonical"]);assert.equal(h.controller.canSave(),true);assert.equal(h.values.size,0);
});
test("a predecessor web editor cannot publish its held canonical read into its successor",async()=>{
 const h=harness();await h.controller.initialize();await h.controller.begin(body);const held=deferred();h.deps.canonical=()=>held.promise;
 const old=h.controller.recover();await turn();const next=harness(h.deps.noteId,h.values);assert.equal(await next.controller.initialize(),true);
 held.resolve("stale");assert.equal(await old,false);assert.deepEqual(h.calls.adopted,[]);assert.deepEqual(next.calls.adopted,["canonical"]);
});
test("lost reserve response is fenced once without replay, and failed canonical read keeps editing locked",async()=>{
 const h=harness();await h.controller.initialize();h.deps.reserve=async body=>{h.calls.reserve.push(body);throw Error("connection lost");};h.deps.read=async()=>{throw Error("missing");};h.deps.canonical=async()=>null;
 await assert.rejects(h.controller.begin(body),/connection lost/);assert.equal(h.calls.reserve.length,1);assert.equal(h.calls.cancel.length,1);assert.equal(h.controller.canEdit(),false);assert.equal(h.values.size,1);
});
const schema=new Schema({nodes:{doc:{content:"block+"},paragraph:{group:"block",content:"text*"},heading:{group:"block",content:"text*",attrs:{level:{default:2}}},text:{}},marks:{bold:{},link:{attrs:{href:{}}}}});
const doc=(type="paragraph",marks=[],attrs=null)=>schema.node("doc",null,[schema.node(type,attrs,[schema.text("same text",marks)])]);
test("web canonical acknowledgment rejects stale formatting, link attributes and node structure",()=>{
 const plain=doc();
 for(const expected of [doc("paragraph",[schema.mark("bold")]),doc("heading",[],{level:2}),doc("paragraph",[schema.mark("link",{href:"https://sureword.app/one"})])]) assert.equal(adoptCanonicalDocument(expected,()=>{},()=>plain),false);
 assert.equal(adoptCanonicalDocument(doc("paragraph",[schema.mark("link",{href:"https://sureword.app/one"})]),()=>{},()=>doc("paragraph",[schema.mark("link",{href:"https://sureword.app/two"})])),false);
});
test("web canonical acknowledgment applies the full document before reopening editing",()=>{
 let actual=doc();const expected=doc("heading",[schema.mark("bold")],{level:3});
 assert.equal(adoptCanonicalDocument(expected,()=>{actual=expected;},()=>actual),true);assert.equal(actual.eq(expected),true);
});

test("a late assistant completion recovers only its preceding question, never a newer turn",()=>{
 const rows=[{id:"old-user",role:"user"},{id:"old-answer",role:"assistant"},{id:"new-user",role:"user"},{id:"new-answer",role:"assistant"}];
 assert.equal(userForNoteReply(rows,"old-answer"),"old-user"); assert.equal(userForNoteReply(rows,"new-answer"),"new-user");
 assert.equal(userForNoteReply(rows,"cleared-answer"),null); assert.equal(userForNoteReply(rows,"old-user"),null);
});

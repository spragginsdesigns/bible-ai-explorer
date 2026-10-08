import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { tool } from "ai";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { actionFingerprint, actionPayload } from "../src/lib/agent-action-rules.ts";
import { acceptsProposedAction, declinesProposedAction } from "../src/lib/agent-intent.ts";

function harness() {
  let row, text="Start a reading plan", message="proposal", target={id:"plan-a",title:"Old plan",status:"active"};
  let beforeClaim=()=>{};
  const matches=where=>row&&Object.entries(where).every(([key,value])=>value&&typeof value==="object"&&!(value instanceof Date)?("gt" in value?row[key]>value.gt:"not" in value?row[key]!==value.not:false):row[key]===value);
  const table={
    findUnique:async({where})=>row&&row.userId===where.userId_scope.userId&&row.scope===where.userId_scope.scope?{...row}:null,
    upsert:async({create,update})=>{row=row?{...row,...update}:{id:"action-a",status:"pending",deliveredAt:null,...create};return {...row};},
    updateMany:async({where,data})=>{if(data.status==="executing")beforeClaim();if(!matches(where))return {count:0};Object.assign(row,data);return {count:1};},
  };
  const db={agentAction:table,$queryRaw:async()=>[],$executeRaw:async()=>1,$transaction:async fn=>fn(db),userChurch:{findUnique:async()=>null},user:{findUnique:async()=>({testimony:null,aboutMe:null})}};
  const source=readFileSync(new URL("../src/lib/agent-actions.ts",import.meta.url),"utf8").replace(/^import\s[^;]*?;\s*$/gm,"").replace(/^export /gm,"");
  const dependencies={tool,z,Prisma,prisma:db,findTodayCross:async()=>null,getActivePlan:async()=>target,acceptsProposedAction,declinesProposedAction,actionFingerprint,actionPayload};
  const api=new Function(...Object.keys(dependencies),`${stripTypeScriptTypes(source)};return {buildActionTools,executeApprovedAction,actionDecisionBlock,recordDeliveredActionProposal};`)(...Object.values(dependencies));
  const context={userId:"owner",actionScope:"chat:owned",userText:()=>text,messageId:()=>message,messageReceivedAt:()=>new Date()};
  const tools=api.buildActionTools(context);
  const propose=async()=>{
    const output=await tools.requestActionApproval.execute({action:"startReadingPlan",payload:{goal:"Assurance",days:7}});
    return output;
  };
  const deliver=async output=>api.recordDeliveredActionProposal("owner","chat:owned","proposal","Would you like me to start that plan?",[{type:"tool-requestActionApproval",output}]);
  return {api,context,propose,deliver,row:()=>row,set:(newText,newMessage)=>{text=newText;message=newMessage;},changeTarget:()=>{target={...target,id:"plan-b"};},race:()=>{beforeClaim=()=>{row.fingerprint="different-proposal";};}};
}

test("a delivered exact proposal executes once and a retry reads its receipt",async()=>{
  const h=harness();await h.deliver(await h.propose());h.set("Yes","decision");let writes=0;
  const run=()=>h.api.executeApprovedAction(h.context,"startReadingPlan",{goal:"Assurance",days:7,confirmed:true},async()=>({success:true,writes:++writes}));
  assert.deepEqual(await run(),{success:true,writes:1});assert.deepEqual(await run(),{success:true,writes:1});assert.equal(writes,1);
});

test("model booleans, undelivered proposals and same-turn approvals cannot authorize a write",async()=>{
  for(const mode of ["none","undelivered","same-turn"]){
    const h=harness();if(mode!=="none"){const output=await h.propose();if(mode==="same-turn")await h.deliver(output);}
    h.set("Yes",mode==="same-turn"?"proposal":"decision");let writes=0;
    await assert.rejects(()=>h.api.executeApprovedAction(h.context,"startReadingPlan",{goal:"Assurance",days:7,confirmed:true},async()=>++writes));assert.equal(writes,0);
  }
});

test("changed payloads, targets and concurrent proposal swaps fail before writing",async()=>{
  for(const mode of ["payload","target","race"]){const h=harness();await h.deliver(await h.propose());h.set("Yes","decision");if(mode==="target")h.changeTarget();if(mode==="race")h.race();let writes=0;
    await assert.rejects(()=>h.api.executeApprovedAction(h.context,"startReadingPlan",{goal:mode==="payload"?"Different":"Assurance",days:7},async()=>++writes));assert.equal(writes,0);
  }
});

test("an intervening request invalidates a proposal before a later unrelated yes",async()=>{
  const h=harness();await h.deliver(await h.propose());h.set("Explain grace","intervening");assert.match(await h.api.actionDecisionBlock(h.context),/moved on/);h.set("Yes","later");
  await assert.rejects(()=>h.api.executeApprovedAction(h.context,"startReadingPlan",{goal:"Assurance",days:7},async()=>assert.fail("must not write")));
});

test("proposal delivery binds ownership and the originating user message",async()=>{
  const h=harness();const output=await h.propose();await h.api.recordDeliveredActionProposal("foreign","chat:owned","proposal","Confirm?",[{type:"tool-requestActionApproval",output}]);assert.equal(h.row().deliveredAt,null);
  await h.api.recordDeliveredActionProposal("owner","chat:owned","other-message","Confirm?",[{type:"tool-requestActionApproval",output}]);assert.equal(h.row().deliveredAt,null);
});

test("an undelivered proposal can be corrected without approving the old payload",async()=>{
  const h=harness(),old=await h.propose(),tools=h.api.buildActionTools(h.context);
  const fixed=await tools.requestActionApproval.execute({action:"startReadingPlan",payload:{goal:"Corrected assurance",days:7}});
  assert.equal(fixed.success,true);
  await h.deliver(old);assert.equal(h.row().deliveredAt,null);
  await h.deliver(fixed);assert.ok(h.row().deliveredAt);
  const changed=await tools.requestActionApproval.execute({action:"startReadingPlan",payload:{goal:"Different after delivery",days:7}});
  assert.equal(changed.success,false);
  h.set("Yes","decision");
  await assert.rejects(()=>h.api.executeApprovedAction(h.context,"startReadingPlan",{goal:"Assurance",days:7},async()=>assert.fail("old payload must not write")));
  assert.deepEqual(await h.api.executeApprovedAction(h.context,"startReadingPlan",{goal:"Corrected assurance",days:7},async()=>({success:true})),{success:true});
});

test("proposal correction cannot switch action types in the same user turn",async()=>{
  const h=harness();await h.propose();
  const result=await h.api.buildActionTools(h.context).requestActionApproval.execute({action:"saveAboutMe",payload:{text:"Different action"}});
  assert.equal(result.success,false);assert.equal(h.row().action,"startReadingPlan");
});

test("identical proposal retries preserve delivery and completed execution receipts",async()=>{
  const h=harness();await h.deliver(await h.propose());const deliveredAt=h.row().deliveredAt;
  assert.equal((await h.propose()).success,true);assert.equal(h.row().deliveredAt,deliveredAt);
  h.set("Yes","decision");let writes=0;
  const run=()=>h.api.executeApprovedAction(h.context,"startReadingPlan",{goal:"Assurance",days:7},async()=>({writes:++writes}));
  assert.deepEqual(await run(),{writes:1});
  h.set("Start a reading plan","proposal");const replay=await h.propose();assert.equal(replay.alreadyExecuted,true);
  assert.equal(h.row().status,"executed");assert.equal(h.row().approvedMessageId,"decision");assert.deepEqual(h.row().result,{writes:1});
  h.set("Yes","decision");assert.deepEqual(await run(),{writes:1});assert.equal(writes,1);
});

test("replaying an old yes cannot approve a newly delivered proposal",async()=>{
  const h=harness();await h.deliver(await h.propose());h.set("Yes","old-yes");
  const old={...h.context,messageReceivedAt:()=>new Date(Date.now()-60000)};
  await assert.rejects(()=>h.api.executeApprovedAction(old,"startReadingPlan",{goal:"Assurance",days:7},async()=>assert.fail("old decision must not write")));
});

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { PrismaClient } from "@prisma/client";

// Explicit isolated DB only. Never reads .env or falls back to DATABASE_URL.
const databaseUrl = process.env.LEARN_TEST_DATABASE_URL;
const enabled = Boolean(databaseUrl);
if (enabled) {
 const target = new URL(databaseUrl);
 if (target.hostname !== "ep-solitary-pond-akd8ym4w.c-3.us-west-2.aws.neon.tech" || target.pathname !== "/neondb") {
  throw new Error("Learn DB tests require the explicitly approved isolated Neon branch host and neondb database.");
 }
}
const prisma = enabled ? new PrismaClient({ datasourceUrl: databaseUrl }) : null;
const userId = `learn-test-${randomUUID()}`;
const otherId = `${userId}-other`;
const fixtureUserIds = [userId, otherId];
function load(path, exports, injected = {}) {
 const source = readFileSync(new URL(path, import.meta.url), "utf8")
  .replace(/^import\s[^;]*?;\s*$/gm, "").replace(/^export /gm, "");
 return new Function(...Object.keys(injected), `${stripTypeScriptTypes(source)}\nreturn {${exports.join(",")}};`)(...Object.values(injected));
}
const dates = load("../src/lib/reading-history.ts", ["localDayKey", "resolveReadingTimezone", "shiftDayKey"]);
const schedule = load("../src/lib/learn-schedule.ts", ["LEARN_DAILY_LIMIT", "reviewCard", "startOfToday", "startOfTomorrow", "toLearnStage"], dates);
const loadLearn = (db) => load("../src/lib/learn.ts", ["reviewCardOperation", "reviewCardById", "addCard", "removeCard", "todayCards"], {
 prisma: db, createHash, ...schedule,
 bookByOrder: () => ({name: "John"}), getKjvChapter: async () => Array(40).fill("Matching KJV text"),
 getChapter: async () => { throw new Error("Unavailable NKJV"); },
});
const learn = loadLearn(prisma);
const operation = (expectedRevision, result = "good", extra = {}) => ({
 result, operationId: randomUUID(), expectedRevision,
 reviewedAt: "2026-09-12T18:00:00.000Z", timezone: "America/Los_Angeles", ...extra,
});
let verse = 0;
const card = (data = {}) => prisma.verseMemory.create({data: {
 userId, book:43, chapter:3, verse:++verse, source:"sheet", dueAt:new Date("2026-09-12T07:00:00Z"), ...data,
}});
const check = (name, fn) => test(name, {skip: !enabled}, fn);
before(async () => { if (enabled) await prisma.user.createMany({data:[{id:userId},{id:otherId}]}); });
after(async () => {
 if (enabled) { await prisma.user.deleteMany({where:{id:{in:fixtureUserIds}}}); await prisma.$disconnect(); }
});

check("parallel first-sign-in requests create one user without overwriting profiles", async () => {
 const freshId = `${userId}-first-sign-in`;
 fixtureUserIds.push(freshId);
 const authFunctions = load("../src/lib/auth.ts", ["getAuthUser"], {
  prisma,
  auth: async () => ({ userId: freshId }),
  currentUser: async () => null,
 });
 const identities = await Promise.all(Array.from({length: 20}, () => authFunctions.getAuthUser()));
 assert.ok(identities.every(id => id === freshId));
 assert.equal(await prisma.user.count({where:{id:freshId}}), 1);
 await prisma.user.update({where:{id:freshId},data:{name:"Preserve this profile"}});
 await Promise.all(Array.from({length: 10}, () => authFunctions.getAuthUser()));
 assert.equal((await prisma.user.findUnique({where:{id:freshId}})).name,"Preserve this profile");
});

check("lost response and crash before outbox acknowledgement replay once", async () => {
 const c = await card(); const op = operation(0);
 await learn.reviewCardOperation(userId,c.id,op); // response deliberately discarded
 const replay = await learn.reviewCardOperation(userId,c.id,JSON.parse(JSON.stringify(op)));
 assert.equal(replay.replayed,true); assert.equal(replay.appliedRevision,1); assert.equal(replay.currentCard.stage,1);
 assert.equal(await prisma.learnReviewReceipt.count({where:{userId,operationId:op.operationId}}),1);
});
check("concurrent identical requests return one application and one receipt", async () => {
 const c=await card(); const op=operation(0);
 const results=await Promise.all([learn.reviewCardOperation(userId,c.id,op),learn.reviewCardOperation(userId,c.id,op)]);
 assert.deepEqual(results.map(r=>r.replayed).sort(),[false,true]);
 assert.equal((await prisma.verseMemory.findUnique({where:{id:c.id}})).revision,1);
});
check("lost response followed by another device advance acknowledges old op with current card",async()=>{
 const c=await card();const first=operation(0);
 await learn.reviewCardOperation(userId,c.id,first);
 await learn.reviewCardOperation(userId,c.id,operation(1));
 const replay=await learn.reviewCardOperation(userId,c.id,first);
 assert.equal(replay.appliedRevision,1);assert.equal(replay.currentCard.revision,2);assert.equal(replay.currentCard.stage,2);
});
check("same schedule tuple and ABA cannot bypass revision",async()=>{
 const c=await card({stage:1});const first=operation(0,"again");
 await learn.reviewCardOperation(userId,c.id,first);
 await assert.rejects(learn.reviewCardOperation(userId,c.id,operation(0,"good")),{code:"revision_conflict"});
 await learn.reviewCardOperation(userId,c.id,operation(1,"good"));
 await learn.reviewCardOperation(userId,c.id,operation(2,"again"));
 const replay=await learn.reviewCardOperation(userId,c.id,first);
 assert.equal(replay.currentCard.stage,1);assert.equal(replay.currentCard.revision,3);
});
check("ordered offline chain and different-device contention",async()=>{
 const c=await card();
 for(let n=0;n<3;n++)assert.equal((await learn.reviewCardOperation(userId,c.id,operation(n))).appliedRevision,n+1);
 const outcomes=await Promise.allSettled([learn.reviewCardOperation(userId,c.id,operation(3)),learn.reviewCardOperation(userId,c.id,operation(3))]);
 assert.equal(outcomes.filter(r=>r.status==="fulfilled").length,1);
 assert.equal(outcomes.find(r=>r.status==="rejected").reason.code,"revision_conflict");
});
check("receipt payload reuse rejected and accounts isolated",async()=>{
 const c=await card();const op=operation(0);await learn.reviewCardOperation(userId,c.id,op);
 await assert.rejects(learn.reviewCardOperation(userId,c.id,{...op,result:"again"}),{code:"operation_id_reused"});
 const second=await card();await assert.rejects(learn.reviewCardOperation(userId,second.id,op),{code:"operation_id_reused"});
 assert.equal(await learn.reviewCardOperation(otherId,c.id,op),null);
});
check("deletion preserves receipt and re-add cannot resurrect original card",async()=>{
 const c=await card();const op=operation(0);await learn.reviewCardOperation(userId,c.id,op);
 await learn.removeCard(userId,c.id);await card({verse:c.verse});
 const replay=await learn.reviewCardOperation(userId,c.id,op);assert.equal(replay.currentCard,null);assert.equal(replay.appliedRevision,1);
 assert.equal(await learn.reviewCardOperation(userId,c.id,operation(1)),null);
});
check("receipt insertion failure rolls back schedule and later retry succeeds",async()=>{
 const c=await card();const op=operation(0);
 const failing=loadLearn({$transaction: (callback)=>prisma.$transaction(tx=>callback(new Proxy(tx,{get(target,key){
  if(key==="learnReviewReceipt")return new Proxy(target[key],{get(delegate,method){if(method==="create")return async()=>{throw new Error("injected receipt failure")};return delegate[method];}});
  return target[key];
 }})))});
 await assert.rejects(failing.reviewCardOperation(userId,c.id,op),/injected receipt failure/);
 assert.equal((await prisma.verseMemory.findUnique({where:{id:c.id}})).revision,0);
 assert.equal(await prisma.learnReviewReceipt.count({where:{userId,operationId:op.operationId}}),0);
 assert.equal((await learn.reviewCardOperation(userId,c.id,op)).appliedRevision,1);
});
check("legacy reviews serialize with modern reviews and advance revision",async()=>{
 const c=await card();const op=operation(0);
 const outcomes=await Promise.allSettled([learn.reviewCardById(userId,c.id,"good"),learn.reviewCardOperation(userId,c.id,op)]);
 assert.equal(outcomes[0].status,"fulfilled");
 const stored=await prisma.verseMemory.findUnique({where:{id:c.id}});
 assert.equal(stored.revision,outcomes[1].status==="fulfilled"?2:1);
 assert.equal(stored.stage,stored.revision);
});
check("duplicate adds converge and translation change invalidates offline review",async()=>{
 const key={book:43,chapter:4,verse:1,source:"sheet",translation:"KJV"};
 const results=await Promise.all([learn.addCard(userId,key),learn.addCard(userId,key)]);
 assert.equal(results[0].card.id,results[1].card.id);assert.deepEqual(results.map(r=>r.created).sort(),[false,true]);
 const changed=await learn.addCard(userId,{...key,translation:"NKJV"});
 assert.equal(changed.card.revision,1);assert.equal(changed.card.text,"");assert.equal(changed.card.textUnavailable,true);
 await assert.rejects(learn.reviewCardOperation(userId,changed.card.id,operation(0)),{code:"revision_conflict"});
});
check("offline review keeps event timezone across DST and delayed replay",async()=>{
 const c=await card({stage:3});const op=operation(0,"good",{reviewedAt:"2025-11-01T19:00:00.000Z"});
 const result=await learn.reviewCardOperation(userId,c.id,op);
 assert.equal(result.currentCard.dueAt,"2025-11-02T07:00:00.000Z");
 assert.equal((await learn.reviewCardOperation(userId,c.id,op)).currentCard.dueAt,result.currentCard.dueAt);
});

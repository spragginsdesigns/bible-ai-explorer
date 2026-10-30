import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import test from "node:test";
import { openLiveLedger } from "../src/lib/voice/live-ledger.mjs";

const NOW = Date.UTC(2026, 9, 29, 12);
const LIMITS = { sessionSeconds: 120, dailySeconds: 300, monthlySeconds: 600 };
const input = (extra = {}) => ({ userId: "user-a", clerkSessionId: "clerk-a", conversationId: "chat-a", limits: LIMITS, now: NOW, ...extra });
function fixture(t) {
	const directory = mkdtempSync(join(tmpdir(), "sureword-live-ledger-"));
	const path = join(directory, "ledger.sqlite");
	const ledger = openLiveLedger(path);
	t.after(() => { ledger.close(); rmSync(directory, { recursive: true, force: true }); });
	return { ledger, path, directory };
}
function race(path, operation, args) {
	const barrier = new Int32Array(new SharedArrayBuffer(4));
	const workerSource = `const { parentPort, workerData } = require('node:worker_threads');
	(async () => { const { openLiveLedger } = await import(workerData.module); const ledger = openLiveLedger(workerData.path);
	parentPort.postMessage({ ready: true }); Atomics.wait(new Int32Array(workerData.barrier), 0, 0);
	try { parentPort.postMessage({ value: ledger[workerData.operation](...workerData.args) }); }
	catch(error) { parentPort.postMessage({ code: error.code, message: error.message }); }
	finally { ledger.close(); } })().catch(error => { throw error; });`;
	let ready = 0;
	return Promise.all(Array.from({ length: 2 }, () => new Promise((resolve, reject) => {
		let result;
		const worker = new Worker(workerSource, { eval: true, workerData: { module: new URL("../src/lib/voice/live-ledger.mjs", import.meta.url).href, path, operation, args, barrier: barrier.buffer } });
		worker.on("error", reject);
		worker.on("message", message => {
			if (message.ready) { if (++ready === 2) { Atomics.store(barrier, 0, 1); Atomics.notify(barrier, 0); } }
			else result = message;
		});
		worker.on("exit", code => { if (code || !result) reject(new Error(`Race worker exited ${code}`)); else resolve(result); });
	})));
}

test("reservation is durable, private and immediately consumes the full grant", t => {
	const { ledger, path, directory } = fixture(t);
	const grant = ledger.reserve(input());
	assert.equal(grant.seconds, 120);
	assert.equal(grant.expiresAt, NOW + 120_000);
	assert.equal(grant.state, "reserved");
	assert.equal(ledger.remaining("user-a", LIMITS, NOW), 180);
	assert.equal(statSync(directory).mode & 0o777, 0o700);
	assert.equal(statSync(path).mode & 0o777, 0o600);
	const second = openLiveLedger(path);
	try { assert.deepEqual(second.get(grant.id), grant); assert.equal(second.get("missing"), null); }
	finally { second.close(); }
});

test("opening the ledger rejects shared directories without changing their permissions", t => {
	const { directory } = fixture(t);
	const shared = join(directory, "shared");
	mkdirSync(shared);
	chmodSync(shared, 0o755);
	assert.throws(() => openLiveLedger(join(shared, "unsafe.sqlite")), /private 0700/);
	assert.equal(statSync(shared).mode & 0o777, 0o755);
	assert.throws(() => openLiveLedger(":memory:"), /durable/);
});

test("two independent SQLite connections race: only one reservation and claim win", async t => {
	const { ledger, path } = fixture(t);
	const reservations = await race(path, "reserve", [input()]);
	assert.equal(reservations.filter(result => result.value).length, 1);
	assert.equal(reservations.filter(result => result.code === "live_session_active").length, 1);
	const grant = reservations.find(result => result.value).value;
	const claims = await race(path, "claim", [grant.id, NOW + 10_000]);
	assert.equal(claims.filter(result => result.value).length, 1);
	assert.equal(claims.filter(result => result.code === "live_ticket_used").length, 1);
	assert.equal(ledger.get(grant.id).expiresAt, grant.expiresAt);
});

test("bootstrap can bind a conversation only before the connection claims its ticket", t => {
	const { ledger } = fixture(t);
	const grant = ledger.reserve(input({ conversationId: "" }));
	assert.throws(() => ledger.claim(grant.id, NOW), { code: "live_session_expired" });
	assert.equal(ledger.get(grant.id).state, "reserved");
	assert.equal(ledger.setConversation(grant.id, "new-chat").conversationId, "new-chat");
	assert.equal(ledger.claim(grant.id, NOW).conversationId, "new-chat");
	assert.throws(() => ledger.setConversation(grant.id, "other-chat"), { code: "live_ticket_used" });
	const failed = ledger.reserve(input({ userId: "other-user", conversationId: "" }));
	assert.equal(ledger.settle(failed.id, 0, true, NOW).chargedSeconds, 0);
	assert.throws(() => ledger.setConversation(failed.id, "too-late"), { code: "live_ticket_used" });
});

test("expired tickets and hard expiry never refund, and cease blocking a new session", t => {
	const { ledger } = fixture(t);
	const first = ledger.reserve(input());
	assert.throws(() => ledger.claim(first.id, NOW + 30_001), { code: "live_session_expired" });
	assert.throws(() => ledger.reserve(input({ now: NOW + 31_000 })), { code: "live_session_active" });
	assert.equal(ledger.remaining("user-a", LIMITS, NOW + 120_000), 180);
	const second = ledger.reserve(input({ now: NOW + 120_000 }));
	ledger.claim(second.id, NOW + 120_000);
	assert.throws(() => ledger.claim(second.id, second.expiresAt), { code: "live_session_expired" });
	assert.equal(ledger.reserve(input({ now: second.expiresAt })).seconds, 60);
	assert.throws(() => ledger.reserve(input({ now: second.expiresAt + 60_000 })), { code: "live_limit_reached" });
});

test("UTC day boundary truncates the grant and resets only daily usage", t => {
	const { ledger } = fixture(t);
	const midnight = Date.UTC(2026, 9, 30);
	const first = ledger.reserve(input({ now: midnight - 20_500 }));
	assert.equal(first.seconds, 20);
	assert.equal(first.expiresAt, midnight - 500);
	assert.equal(ledger.remaining("user-a", LIMITS, midnight), 300);
	assert.equal(ledger.remaining("user-a", { ...LIMITS, monthlySeconds: 25 }, midnight), 5);
	assert.throws(() => ledger.reserve(input({ now: midnight, limits: { ...LIMITS, monthlySeconds: 25 } })), { code: "live_limit_reached" });
	assert.equal(ledger.reserve(input({ now: midnight })).seconds, 120);
});

test("UTC month boundary resets monthly usage; fewer than fifteen seconds cannot be granted", t => {
	const { ledger } = fixture(t);
	const boundary = Date.UTC(2026, 10, 1);
	assert.throws(() => ledger.reserve(input({ now: boundary - 14_999 })), { code: "live_limit_reached" });
	const grant = ledger.reserve(input({ now: boundary - 15_000, limits: { sessionSeconds: 120, dailySeconds: 15, monthlySeconds: 15 } }));
	assert.equal(grant.seconds, 15);
	assert.equal(grant.expiresAt, boundary);
	assert.equal(ledger.remaining("user-a", LIMITS, boundary - 1), 285);
	assert.equal(ledger.remaining("user-a", LIMITS, boundary), 300);
	assert.equal(ledger.reserve(input({ now: boundary })).seconds, 120);
});

test("unknown usage charges the full reservation and settlement replay cannot refund it", t => {
	const { ledger } = fixture(t);
	const grant = ledger.reserve(input());
	const settled = ledger.settle(grant.id, 3, false, NOW + 4_000);
	assert.equal(settled.chargedSeconds, 120);
	assert.equal(settled.confirmed, false);
	assert.deepEqual(ledger.settle(grant.id, 0, true, NOW + 5_000), settled);
	assert.equal(ledger.remaining("user-a", LIMITS, NOW + 5_000), 180);
	assert.equal(ledger.reserve(input({ now: NOW + 5_000 })).seconds, 120);
});

test("stop synchronously revokes active work without refunding and permits confirmed settlement", t => {
	const { ledger, path } = fixture(t);
	const grant = ledger.reserve(input());
	ledger.claim(grant.id, NOW);
	const stopped = ledger.stop(grant.id);
	assert.equal(stopped.state, "closing");
	assert.equal(stopped.chargedSeconds, grant.seconds);
	assert.equal(stopped.expiresAt, grant.expiresAt);
	assert.equal(stopped.settledAt, null);
	assert.deepEqual(ledger.stop(grant.id), stopped);
	assert.throws(() => ledger.claim(grant.id, NOW + 1_000), { code: "live_ticket_used" });
	assert.throws(() => ledger.reserve(input({ now: NOW + 1_000 })), { code: "live_session_active" });
	const second = openLiveLedger(path);
	try { assert.equal(second.get(grant.id).state, "closing"); }
	finally { second.close(); }
	assert.equal(ledger.remaining("user-a", LIMITS, NOW + 1_000), 180);
	const settled = ledger.settle(grant.id, 8, true, NOW + 8_000);
	assert.equal(settled.state, "settled");
	assert.equal(settled.chargedSeconds, 8);
	assert.deepEqual(ledger.stop(grant.id), settled);
	assert.equal(ledger.reserve(input({ now: NOW + 8_000 })).seconds, 120);
});

test("stopped reserved tickets cannot connect or rebind; expiry releases concurrency without refund", t => {
	const { ledger } = fixture(t);
	const grant = ledger.reserve(input());
	assert.equal(ledger.stop(grant.id).state, "closing");
	assert.throws(() => ledger.claim(grant.id, NOW), { code: "live_ticket_used" });
	assert.throws(() => ledger.setConversation(grant.id, "new-chat"), { code: "live_ticket_used" });
	assert.throws(() => ledger.reserve(input({ now: grant.expiresAt - 1 })), { code: "live_session_active" });
	assert.equal(ledger.reserve(input({ now: grant.expiresAt })).seconds, 120);
	assert.equal(ledger.get(grant.id).chargedSeconds, 120);
	assert.equal(ledger.get(grant.id).state, "closing");
	assert.throws(() => ledger.stop("unknown"), { code: "live_session_expired" });
});

test("confirmed short usage credits only unused grant; settlement clamps to the grant", t => {
	const { ledger } = fixture(t);
	const grant = ledger.reserve(input());
	assert.equal(ledger.settle(grant.id, 12.5, true, NOW + 13_000).chargedSeconds, 12.5);
	assert.equal(ledger.remaining("user-a", LIMITS, NOW + 13_000), 287.5);
	const next = ledger.reserve(input({ now: NOW + 13_000 }));
	assert.equal(ledger.settle(next.id, 999, true, NOW + 14_000).chargedSeconds, 120);
	const third = ledger.reserve(input({ now: NOW + 15_000 }));
	assert.equal(ledger.settle(third.id, -10, true, NOW + 16_000).chargedSeconds, 0);
});

test("late confirmed settlement changes its original UTC usage period only", t => {
	const { ledger } = fixture(t);
	const boundary = Date.UTC(2026, 10, 1);
	const grant = ledger.reserve(input({ now: boundary - 20_000 }));
	ledger.settle(grant.id, 5, true, boundary + 1_000);
	assert.equal(ledger.remaining("user-a", LIMITS, boundary - 1), 295);
	assert.equal(ledger.remaining("user-a", LIMITS, boundary + 1_000), 300);
});

test("pending and completed turn claims replay durable original text and result", async t => {
	const { ledger, path } = fixture(t);
	const grant = ledger.reserve(input());
	const claims = await race(path, "claimTurn", [grant.id, "turn-1", "msg-1", "Save that note"]);
	assert.equal(claims.filter(result => result.value?.claimed).length, 1);
	assert.equal(ledger.getTurn(grant.id, "turn-1").state, "pending");
	assert.equal(ledger.claimTurn(grant.id, "turn-1", "other", "Altered request").claimed, false);
	const receipt = { assistantMessageId: "answer-1", saved: true, tools: [{ noteId: "note-1" }] };
	ledger.finishTurn(grant.id, "turn-1", receipt);
	assert.deepEqual(ledger.claimTurn(grant.id, "turn-1", "msg-1", "Save twice").turn.result, receipt);
	assert.equal(ledger.claimTurn(grant.id, "turn-2", "msg-1", "Duplicate user id").claimed, false);
	assert.deepEqual(ledger.finishTurn(grant.id, "turn-1", { overwritten: true }).result, receipt);
	const second = openLiveLedger(path);
	try { assert.deepEqual(second.getTurn(grant.id, "turn-1").result, receipt); }
	finally { second.close(); }
	assert.equal(ledger.getTurn(grant.id, "missing"), null);
});

test("invalid durations, timestamps and empty identities do not create reservations", t => {
	const { ledger } = fixture(t);
	for (const value of [NaN, Infinity, -1, "120"]) assert.throws(() => ledger.reserve(input({ limits: { ...LIMITS, sessionSeconds: value } })), TypeError);
	assert.throws(() => ledger.reserve(input({ now: NaN })), TypeError);
	assert.throws(() => ledger.reserve(input({ userId: "" })), TypeError);
	assert.throws(() => ledger.reserve(input({ limits: { ...LIMITS, sessionSeconds: 14 } })), { code: "live_limit_reached" });
	assert.equal(ledger.remaining("user-a", LIMITS, NOW), 300);
	const grant = ledger.reserve(input());
	assert.throws(() => ledger.settle(grant.id, Infinity, true, NOW), TypeError);
	assert.equal(ledger.get(grant.id).chargedSeconds, 120);
});


test("transcripts persist separately, bind once, and completion cannot be undone by delayed partials", t => {
 const {ledger,path}=fixture(t);const grant=ledger.claim(ledger.reserve(input()).id,NOW);
 const speech={segmentId:"speech",role:"user",text:"  actual provider speech  ",complete:true,startMs:5,endMs:1000};
 const first=ledger.saveTranscript(grant,speech,NOW);assert.equal(first.canonicalMessageId,null);
 assert.deepEqual(ledger.saveTranscript(grant,speech,NOW),first);
 const bound=ledger.bindTranscript(grant,"speech","canonical-user","user",NOW);assert.equal(bound.text,speech.text);assert.equal(bound.canonicalMessageId,"canonical-user");
 assert.deepEqual(ledger.saveTranscript(grant,{...speech,text:"late partial",complete:false,endMs:1500},NOW),bound);
 assert.deepEqual(ledger.saveTranscript(grant,{...speech,text:"shorter late final",endMs:999},NOW),bound);
 const corrected=ledger.saveTranscript(grant,{...speech,text:"corrected captured speech",canonicalMessageId:"canonical-user"},NOW);assert.equal(corrected.complete,true);assert.equal(corrected.text,"corrected captured speech");
 const second=openLiveLedger(path);try{assert.deepEqual(second.getTranscript(grant,"speech",NOW),corrected);}finally{second.close();}
 assert.throws(()=>ledger.bindTranscript(grant,"speech","different-user","user",NOW),/identity mismatch/);
 assert.throws(()=>ledger.bindTranscript(grant,"speech","canonical-user","assistant",NOW),/identity mismatch/);
 assert.throws(()=>ledger.bindTranscript(grant,"absent","canonical-user","user",NOW),/identity mismatch/);
 assert.throws(()=>ledger.saveTranscript(grant,{...speech,role:"assistant"},NOW),/identity mismatch/);
 assert.throws(()=>ledger.saveTranscript(grant,{...speech,canonicalMessageId:"other"},NOW),/identity mismatch/);
});

test("transcript sidecar checks exact owner, Clerk session, parent and bounded closing/settled drain", t => {
 const {ledger}=fixture(t);const reserved=ledger.reserve(input());
 const speech={segmentId:"speech",role:"assistant",text:"Acknowledgment",complete:false};
 assert.throws(()=>ledger.saveTranscript(reserved,speech,NOW),/drain window/);
 const grant=ledger.claim(reserved.id,NOW);
 for(const patch of [{userId:"foreign"},{clerkSessionId:"new-same-user-session"},{conversationId:"foreign"},{id:"missing"}]){
  assert.throws(()=>ledger.saveTranscript({...grant,...patch},speech,NOW),/identity mismatch/);
  assert.throws(()=>ledger.getTranscript({...grant,...patch},"speech",NOW),/identity mismatch/);
 }
 ledger.stop(grant.id);assert.equal(ledger.saveTranscript(grant,speech,NOW+1000).canonicalMessageId,null);
 ledger.settle(grant.id,1,true,NOW+1000);assert.equal(ledger.saveTranscript(grant,{...speech,complete:true},grant.expiresAt+30000).complete,true);
 assert.throws(()=>ledger.saveTranscript(grant,speech,grant.expiresAt+30001),/drain window/);
 assert.throws(()=>ledger.getTranscript(grant,"speech",NOW-1),/drain window/);
});

test("a session admits at most 256 distinct segments while existing identities remain idempotent", t => {
 const {ledger}=fixture(t);const grant=ledger.claim(ledger.reserve(input()).id,NOW);
 for(let i=0;i<256;i++)ledger.saveTranscript(grant,{segmentId:String(i),role:i%2?"user":"assistant",text:"speech",complete:true},NOW);
 assert.throws(()=>ledger.saveTranscript(grant,{segmentId:"overflow",role:"user",text:"speech",complete:true},NOW),/Too many/);
 assert.equal(ledger.saveTranscript(grant,{segmentId:"0",role:"assistant",text:"same captured correction",complete:true},NOW).text,"same captured correction");
});

test("invalid transcript content, duration and role never creates a sidecar", t => {
 const {ledger}=fixture(t);const grant=ledger.claim(ledger.reserve(input()).id,NOW);
 const speech={segmentId:"speech",role:"user",text:"speech",complete:true};
 for(const patch of [{text:""},{text:"x".repeat(50001)},{role:"system"},{complete:1},{startMs:-1},{startMs:10,endMs:1},{endMs:Infinity},{endMs:150001}])assert.throws(()=>ledger.saveTranscript(grant,{...speech,...patch},NOW),/Invalid|exceeds/);
 assert.equal(ledger.getTranscript(grant,"speech",NOW),null);
});

test("independent connections serialize the same transcript segment without duplicate or downgraded completion",async t=>{
 const {ledger,path}=fixture(t);const grant=ledger.claim(ledger.reserve(input()).id,NOW);
 const speech={segmentId:"speech",role:"user",text:"final captured speech",complete:true,endMs:1000};
 const results=await race(path,"saveTranscript",[grant,speech,NOW]);assert.equal(results.filter(r=>r.value).length,2);assert.deepEqual(results[0].value,results[1].value);
 const partial={...speech,text:"late",complete:false,endMs:1100};await race(path,"saveTranscript",[grant,partial,NOW]);assert.equal(ledger.getTranscript(grant,"speech",NOW).text,speech.text);assert.equal(ledger.getTranscript(grant,"speech",NOW).complete,true);
});


test('actual SQLite lock wait crossing supplied deadline refuses claim, finish and transcript bind before mutation',async t=>{
 const{ledger,path}=fixture(t);const now=Date.now();const grant=ledger.claim(ledger.reserve(input({now})).id,now);
 ledger.claimTurn(grant.id,'pending','user-row','Question');ledger.saveTranscript(grant,{segmentId:'speech',role:'user',text:'Question',complete:true},now);
 for(const operation of ['claim','finish','bind']){
  // Do not await the returned exit promise until after the blocking ledger call.
  const worker=new Worker(`const{parentPort,workerData}=require('node:worker_threads');const{DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(workerData.path);db.exec('BEGIN IMMEDIATE');parentPort.postMessage('locked');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,150);db.exec('COMMIT');db.close();`,{eval:true,workerData:{path}});
  const exited=new Promise((resolve,reject)=>{worker.once('error',reject);worker.once('exit',code=>code?reject(Error('lock worker failed')):resolve());});await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);});
  const options={deadline:Date.now()+20};
  const call=()=>operation==='claim'?ledger.claimTurn(grant.id,'late','late-user','Question',options):operation==='finish'?ledger.finishTurn(grant.id,'pending',{assistantMessageId:'a',text:'safe',toolParts:[],streamError:false},options):ledger.bindTranscript(grant,'speech','user-row','user',undefined,options);
  assert.throws(call,{code:'live_execution_expired'});await exited;
  assert.equal(ledger.getTurn(grant.id,'late'),null);assert.equal(ledger.getTurn(grant.id,'pending').state,'pending');assert.equal(ledger.getTranscript(grant,'speech').canonicalMessageId,null);
 }
});
test('ledger execution guard checks actual grant expiry inside lock, while legacy no-deadline callers stay compatible', t=>{
 const{ledger}=fixture(t);const now=Date.now();const grant=ledger.claim(ledger.reserve(input({now})).id,now);
 const options={deadline:Date.now()+10000};ledger.claimTurn(grant.id,'allowed','u1','Question',options);ledger.saveTranscript(grant,{segmentId:'s',role:'user',text:'Question',complete:true},now);assert.equal(ledger.bindTranscript(grant,'s','u1','user',undefined,options).canonicalMessageId,'u1');assert.equal(ledger.finishTurn(grant.id,'allowed',{assistantMessageId:'a',text:'safe',toolParts:[],streamError:false},options).state,'done');
 ledger.stop(grant.id);assert.throws(()=>ledger.claimTurn(grant.id,'stopped','u2','Question',options),{code:'live_execution_expired'});assert.throws(()=>ledger.finishTurn(grant.id,'allowed',{},options),{code:'live_execution_expired'});assert.throws(()=>ledger.bindTranscript(grant,'s','u1','user',undefined,options),{code:'live_execution_expired'});
 // An expired absolute budget is rejected even while the original session remains live.
 const second=ledger.claim(ledger.reserve(input({userId:'u2',now})).id,now);assert.throws(()=>ledger.claimTurn(second.id,'expired','u3','Question',{deadline:Date.now()-1}),{code:'live_execution_expired'});
});

test('session expiring during actual SQLite lock acquisition cannot bind even with time left in delegate budget',async t=>{
 const{ledger,path}=fixture(t);const born=Date.now()-14900;const grant=ledger.claim(ledger.reserve(input({now:born,limits:{...LIMITS,sessionSeconds:15}})).id,born);ledger.saveTranscript(grant,{segmentId:'speech',role:'user',text:'Question',complete:true},born);
 const worker=new Worker(`const{parentPort,workerData}=require('node:worker_threads');const{DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(workerData.path);db.exec('BEGIN IMMEDIATE');parentPort.postMessage('locked');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,180);db.exec('COMMIT');db.close();`,{eval:true,workerData:{path}});
 const exited=new Promise((resolve,reject)=>{worker.once('error',reject);worker.once('exit',code=>code?reject(Error('lock worker failed')):resolve());});await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);});
 assert.throws(()=>ledger.bindTranscript(grant,'speech','canonical-user','user',undefined,{deadline:Date.now()+10000}),{code:'live_execution_expired'});await exited;assert.equal(ledger.getTranscript(grant,'speech').canonicalMessageId,null);
});

test('actual final-drain timestamp is sampled after SQLite lock, so grace expiry cannot admit late archived speech',async t=>{
 const{ledger,path}=fixture(t);const born=Date.now()-44900;const grant=ledger.claim(ledger.reserve(input({now:born,limits:{...LIMITS,sessionSeconds:15}})).id,born);ledger.saveTranscript(grant,{segmentId:'speech',role:'user',text:'retained original',complete:true},born);ledger.stop(grant.id);
 const worker=new Worker(`const{parentPort,workerData}=require('node:worker_threads');const{DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(workerData.path);db.exec('BEGIN IMMEDIATE');parentPort.postMessage('locked');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,180);db.exec('COMMIT');db.close();`,{eval:true,workerData:{path}});
 const exited=new Promise((resolve,reject)=>{worker.once('error',reject);worker.once('exit',code=>code?reject(Error('lock worker failed')):resolve());});await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);});
 assert.throws(()=>ledger.saveTranscript(grant,{segmentId:'speech',role:'user',text:'too late correction',complete:true}),{code:'live_session_expired'});await exited;assert.equal(ledger.getTranscript(grant,'speech',born).text,'retained original');
});

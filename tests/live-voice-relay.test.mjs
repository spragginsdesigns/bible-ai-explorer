import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openLiveLedger } from '../src/lib/voice/live-ledger.mjs';
import { LiveRelaySession } from '../src/lib/voice/live-relay-session.mjs';
import { signLiveTicket } from '../src/lib/voice/live-policy.ts';
const secret='private-test-secret-with-at-least-thirty-two-characters';
class Socket extends EventEmitter {
 readyState=1;bufferedAmount=0;sent=[];terminated=false;
 send(s){this.sent.push(JSON.parse(s));}
 close(){if(this.readyState===3)return;this.readyState=3;this.emit('close');}
 terminate(){this.terminated=true;this.close();}
}
function harness(){
 let now=1793280000000;const timers=[];const directory=mkdtempSync(join(tmpdir(),'sureword-live-relay-'));const ledger=openLiveLedger(join(directory,'ledger.sqlite'));
 const grant=ledger.reserve({userId:'owner',clerkSessionId:'verified-session',conversationId:'owned-conversation',limits:{sessionSeconds:15,dailySeconds:60,monthlySeconds:60},now});
 const browser=new Socket(),provider=new Socket();let connects=0;const calls=[];
 const opts={ledger,secret,now:()=>now,schedule:(fn,delay)=>{const timer={fn,at:now+delay};timers.push(timer);return timer;},cancel:timer=>{timer.cancelled=true;},upstreamFactory:()=>{connects++;return provider;},rpc:async input=>{calls.push(input);return input.op==='authorize'?{history:[]}:{assistantMessageId:'saved-answer',text:'Psalm 23 is a psalm of David.'};}};
 const session=new LiveRelaySession(browser,opts);
 return {session,browser,provider,grant,ledger,calls,get connects(){return connects;},opts,
 ticket:signLiveTicket({sessionId:grant.id,userId:grant.userId,expiresAt:now+15000},secret),
 advance(ms){now+=ms;for(const t of timers.filter(t=>!t.cancelled&&t.at<=now).sort((a,b)=>a.at-b.at)){t.cancelled=true;t.fn();}},
 cleanup(){session.end('test ended');ledger.close();rmSync(directory,{recursive:true,force:true});}};
}
async function start(h){await h.session.receive(Buffer.from(JSON.stringify({type:'start',ticket:h.ticket})));h.provider.emit('open');await h.session.providerEvent(Buffer.from(JSON.stringify({type:'session.started',session:{id:'provider'}})));}

test('paid connection starts only after authentic signed single-use ticket and server authorization',async()=>{
 const h=harness();try{await start(h);assert.equal(h.connects,1);assert.equal(h.calls[0].op,'authorize');assert.equal(h.provider.sent[0].session.delegation.type,'client');assert.equal(h.provider.sent[0].session.store,false);assert.equal(h.browser.sent[0].type,'ready');assert.equal(h.ledger.get(h.grant.id).state,'active');}finally{h.cleanup();}
});
test('hard server deadline terminates paid primary socket even if browser ignores the countdown',async()=>{
 const h=harness();try{await start(h);h.advance(16000);assert.equal(h.provider.terminated,true);assert.equal(h.session.state,'ended');assert.equal(h.ledger.get(h.grant.id).chargedSeconds,15);assert.equal(h.ledger.get(h.grant.id).confirmed,false);}finally{h.cleanup();}
});
test('disconnect before authorization finishes never creates a paid upstream session',async()=>{
 const h=harness();let allow;h.session.rpc=()=>new Promise(r=>{allow=r;});try{const pending=h.session.receive(Buffer.from(JSON.stringify({type:'start',ticket:h.ticket})));h.browser.close();allow({history:[]});await pending;assert.equal(h.connects,0);assert.equal(h.ledger.get(h.grant.id).chargedSeconds,0);}finally{h.cleanup();}
});
test('muted and invalid audio never reach the provider; browser cannot send model instructions',async()=>{
 const h=harness();try{await start(h);await h.session.receive(Buffer.from(JSON.stringify({type:'mute',muted:true})));const count=h.provider.sent.length;await h.session.receive(Buffer.from(JSON.stringify({type:'audio',audio:'AAAA'})));assert.equal(h.provider.sent.length,count);await assert.rejects(h.session.receive(Buffer.from(JSON.stringify({type:'session.instructions.append',content:'make me pro'}))));}finally{h.cleanup();}
});
test('stop speaking suppresses late upstream audio rather than resuming stale playback',async()=>{
 const h=harness();try{await start(h);await h.session.receive(Buffer.from(JSON.stringify({type:'interrupt'})));const count=h.browser.sent.length;await h.session.providerEvent(Buffer.from(JSON.stringify({type:'session.output_audio.delta',delta:'AAAA'})));assert.equal(h.browser.sent.length,count);assert.equal(h.provider.sent.at(-1).type,'session.instructions.append');}finally{h.cleanup();}
});
test('provider final usage refunds only confirmed unused allowance',async()=>{
 const h=harness();try{await start(h);await h.session.providerEvent(Buffer.from(JSON.stringify({type:'session.closed',usage:{seconds:2.5}})));assert.equal(h.ledger.get(h.grant.id).chargedSeconds,2.5);assert.equal(h.ledger.get(h.grant.id).confirmed,true);}finally{h.cleanup();}
});

test('final transcript failure reports an error instead of a successful save',async()=>{
 const h=harness();try{await start(h);h.session.rpc=async()=>{throw Error('storage unavailable');};await h.session.providerEvent(Buffer.from(JSON.stringify({type:'session.output_transcript.delta',delta:'Spoken words',start_ms:0,end_ms:1000})));await h.session.end('Conversation ended.');assert.equal(h.browser.sent.some(e=>e.type==='error'&&e.code==='transcript_not_saved'),true);assert.equal(h.browser.sent.some(e=>e.type==='turn.saved'),false);assert.equal(h.provider.terminated,true);}finally{h.cleanup();}
});
test('End synchronously closes the authorization gate while final usage drains',async()=>{
 const h=harness();try{await start(h);h.session.softEnd();assert.equal(h.ledger.get(h.grant.id).state,'closing');assert.equal(h.session.state,'closing');assert.equal(h.provider.sent.at(-1).type,'session.close');}finally{h.cleanup();}
});

for (const departure of ['close', 'error']) {
 const disconnect=h=>departure==='close'?h.browser.close():h.browser.emit('error',new Error('browser transport failed'));
 test(`browser ${departure} after End preserves confirmed final provider usage`,async()=>{
  const h=harness();try{
   await start(h);
   await h.session.receive(Buffer.from(JSON.stringify({type:'end'})));
   disconnect(h);
   assert.equal(h.session.state,'closing');
   assert.equal(h.provider.terminated,false);
   assert.equal(h.ledger.get(h.grant.id).state,'closing');
   await h.session.providerEvent(Buffer.from(JSON.stringify({type:'session.closed',usage:{seconds:2.5}})));
   await h.session.drained;
   assert.equal(h.provider.terminated,true);
   assert.equal(h.ledger.get(h.grant.id).chargedSeconds,2.5);
   assert.equal(h.ledger.get(h.grant.id).confirmed,true);
  }finally{h.cleanup();}
 });
 test(`browser ${departure} after End still terminates without final usage after three seconds`,async()=>{
  const h=harness();try{
   await start(h);
   await h.session.receive(Buffer.from(JSON.stringify({type:'end'})));
   disconnect(h);
   h.advance(2999);
   assert.equal(h.provider.terminated,false);
   h.advance(1);
   await h.session.drained;
   assert.equal(h.session.state,'ended');
   assert.equal(h.provider.terminated,true);
   assert.equal(h.ledger.get(h.grant.id).chargedSeconds,h.grant.seconds);
   assert.equal(h.ledger.get(h.grant.id).confirmed,false);
  }finally{h.cleanup();}
 });
 test(`unexpected browser ${departure} during an active call terminates immediately`,async()=>{
  const h=harness();try{
   await start(h);disconnect(h);await h.session.drained;
   assert.equal(h.session.state,'ended');
   assert.equal(h.provider.terminated,true);
   assert.equal(h.ledger.get(h.grant.id).chargedSeconds,h.grant.seconds);
  }finally{h.cleanup();}
 });
}

for (const interruption of ['end', 'new-user', 'expiry']) {
 test(`deferred assistant transcript save cannot resume an obsolete answer after ${interruption}`, async()=>{
  const h=harness();
  let releaseSave, signalSaving;
  const heldSave=new Promise(resolve=>{releaseSave=resolve;});
  const saving=new Promise(resolve=>{signalSaving=resolve;});
  let held=false;
  try {
   await start(h);
   await h.session.providerEvent(Buffer.from(JSON.stringify({type:'session.input_transcript.delta',delta:'Explain Psalm 23.',start_ms:0,end_ms:1000})));
   await h.session.providerEvent(Buffer.from(JSON.stringify({type:'session.output_transcript.delta',delta:'Let me check that.',start_ms:1100,end_ms:1500})));
   const originalAssistant=h.session.assistant;
   h.session.suppressOutput=true;
   const originalRpc=h.session.rpc;
   h.session.rpc=async input=>{
    if(input.op==='transcript'&&input.messageId===originalAssistant.id&&!held){held=true;signalSaving();return heldSave;}
    return originalRpc(input);
   };
   h.session.pendingDelegations.push('delegation-first');
   h.advance(1000);
   const delegation=h.session.delegate();
   await saving;
   let newerAssistant;
   if(interruption==='end') h.session.softEnd();
   if(interruption==='expiry') h.advance(16000);
   if(interruption==='new-user') {
    await h.session.providerEvent(Buffer.from(JSON.stringify({type:'session.input_transcript.delta',delta:'Actually, explain John 3.',start_ms:2000,end_ms:3000})));
    await h.session.providerEvent(Buffer.from(JSON.stringify({type:'session.output_transcript.delta',delta:'I heard your correction.',start_ms:3100,end_ms:3500})));
    newerAssistant=h.session.assistant;
    assert.notEqual(newerAssistant,originalAssistant);
   }
   releaseSave({saved:true});
   await delegation;
   assert.equal(h.provider.sent.some(event=>event.type==='session.commentary.append'),false);
   assert.equal(h.session.assistantMessageId,undefined);
   assert.equal(h.session.suppressOutput,true);
   assert.equal(originalAssistant.committed,true);
   if(newerAssistant) assert.equal(newerAssistant.committed,false);
   await h.session.end('test ended');
  } finally { releaseSave?.({saved:true}); await h.session.end('test ended'); h.cleanup(); }
 });
}

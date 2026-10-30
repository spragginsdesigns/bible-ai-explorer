import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync,existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(path.join(process.cwd(),'package.json'));
globalThis.fetch=()=>{throw Error('Unexpected external fetch in offline voice proof');};
const React=require('react'),{act,create}=require('react-test-renderer'),ts=require('typescript');
const file=name=>existsSync(path.join(root,name))?path.join(root,name):path.join(process.cwd(),name);
const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
const pureCache=new Map();
function pure(name){
 const filename=file(name);if(filename.endsWith('.json'))return JSON.parse(readFileSync(filename,'utf8'));if(pureCache.has(filename))return pureCache.get(filename).exports;
 const module={exports:{}};pureCache.set(filename,module);
 new Function('require','module','exports',compile(readFileSync(filename,'utf8')))(id=>{
  if(id.startsWith('@/')||id.startsWith('.')){
   const base=id.startsWith('@/')?path.join('src',id.slice(2)):path.relative(process.cwd(),path.resolve(path.dirname(filename),id));
   for(const ext of ['','.ts','.mjs'])if(existsSync(file(base+ext)))return pure(base+ext);
  }
  throw Error('Unexpected pure dependency '+id);
 },module,module.exports);return module.exports;
}
const converterSource=readFileSync(file('src/components/useChat.ts'),'utf8').split('export const useChat =')[0];
const actual={exports:{}};
const calledPure=['@/lib/chat/history-review','@/lib/chat/progress','@/lib/chat/receipts','@/lib/onboarding-rules','@/lib/guide-cards','@/utils/assistantMarkdown','@/lib/tool-activity-labels','@/lib/bible/translations'];
new Function('require','module','exports',compile(converterSource))(id=>calledPure.includes(id)?pure('src/'+id.slice(2)+'.ts'):id==='react'?React:{},actual,actual.exports);
const project=row=>actual.exports.toViewMessage(actual.exports.dbMessageToUIMessage(row),{isStreaming:false});
const helpers=pure('src/lib/voice/web-saved-answer.ts');
const card={step:'faith',question:'Where are you?',options:['Pastor','Newly saved'],allowOther:true,skipLabel:'Skip for now',terms:[]};
const row=(content='Checked answer.',choice)=>({id:'answer',role:'assistant',content,metadata:{parts:[{type:'text',text:content},...(choice?[{type:'tool-presentChoices',state:'output-available',toolCallId:'choice',output:choice}]:[])]}});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
function harness(read,initial=project(row('Checked answer.',card)),initialWelcome=false,strictMode=false){
 let identity={userId:'owner',sessionId:'session-one'},conversation='chat',messages=[initial],ready=false,busy=false,welcome=initialWelcome,active=true;
 const calls={reads:0,stops:0,speech:[],releases:0,renders:0,unmounts:0,layoutReplays:0},controls={stop:()=>{calls.stops++;},speak:async text=>{calls.speech.push(text);}};
 const module={exports:{}};
 // Web's installed React18 test renderer does not replay effects automatically.
 // Replay only the hook's real layout setup/cleanup to check StrictMode reset semantics.
 const hookReact=strictMode?{...React,useLayoutEffect:(setup,deps)=>React.useLayoutEffect(()=>{const cleanup=setup();cleanup?.();calls.layoutReplays++;return setup();},deps)}:React;
 const deps={react:hookReact,'@clerk/nextjs':{useAuth:()=>identity},'@/lib/voice/web-narration':{beginNarration:()=>()=>{calls.releases++;}},'@/lib/voice/web-saved-answer':helpers,'../useChat':actual.exports,'./VoiceControlProvider':{useVoiceControls:()=>controls,useVoiceControlsActive:()=>active}};
 new Function('require','module','exports','fetch','setTimeout','clearTimeout',compile(readFileSync(file('src/components/voice/useCanonicalVoice.ts'),'utf8')))(id=>{if(!(id in deps))throw Error('Unexpected hook dependency '+id);return deps[id];},module,module.exports,async(url,init)=>{calls.reads++;return read(url,init);},callback=>{queueMicrotask(callback);return 1;},()=>{});
 function Probe(){calls.renders++;ready=module.exports.useCanonicalVoice(conversation,messages,busy,welcome);React.useLayoutEffect(()=>()=>{calls.unmounts++;},[]);return null;}
 const element=()=>strictMode?React.createElement(React.StrictMode,null,React.createElement(Probe)):React.createElement(Probe);
 let view;
 return {calls,unmountBeforePassive(){view.unmount();},updateBeforePassive(change){active=change.active??active;busy=change.busy??busy;view.update(element());},get ready(){return ready;},async mount(){await act(async()=>{view=create(element(),strictMode?{unstable_isConcurrent:true,unstable_strictMode:true}:undefined);await tick();});},async update(change={}){identity=change.identity??identity;conversation=change.conversation??conversation;messages=change.messages??messages;welcome=change.welcome??welcome;busy=change.busy??busy;active=change.active??active;await act(async()=>{view.update(element());await tick();});},async close(){if(view)await act(async()=>view.unmount());}};
}
test('safe helper uses the actual exported DB/UI converters for text, full choice fields and clean notices',()=>{
 for(const saved of [row(),row('Checked answer.',card),row('This answer is unavailable.'),row('')]){
  const local=project(saved);assert.equal(helpers.savedVoiceAnswer({messages:[row('Other'),{...saved,id:'answer'}].map((v,i)=>i===0?{...v,id:'old'}:v)},'answer',helpers.voiceAnswerEnvelope(local),project),local.content);
 }
 const expected=helpers.voiceAnswerEnvelope(project(row('Checked answer.',card)));
 for(const saved of [row('Changed',card),...['question','options','skipLabel','allowOther','terms'].map(key=>row('Checked answer.',{...card,[key]:key==='options'?['Changed']:key==='terms'?['saved']:key==='allowOther'?false:'Changed'}))])assert.equal(helpers.savedVoiceAnswer({messages:[saved]},'answer',expected,project),null);
});
test('safe helper refuses markers, malformed target parts, duplicate target and foreign/user identities',()=>{
 const saved=row(),expected=helpers.voiceAnswerEnvelope(project(saved));
 for(const marker of [null,undefined,{state:'pending'},{state:'withheld'}])assert.equal(helpers.savedVoiceAnswer({messages:[{...saved,metadata:{...saved.metadata,historyVerification:marker}}]},'answer',expected,project),null);
 for(const metadata of [null,[],{}, {parts:[null]},{parts:[{}]},{parts:[{type:''}]},{parts:[{type:'text',text:1}]}])assert.equal(helpers.savedVoiceAnswer({messages:[{...saved,metadata}]},'answer',expected,project),null);
 for(const rows of [[saved,saved],[{...saved,id:'foreign'}],[{...saved,role:'user'}]])assert.equal(helpers.savedVoiceAnswer({messages:rows},'answer',expected,project),null);
});
for(const state of ['pending','withheld'])test(`mounted actual hook never makes ${state} GET prose ready or narrates it`,async()=>{
 const saved=row('UNAPPROVED GET BODY',card);saved.metadata.historyVerification={state};
 const h=harness(async()=>Response.json({messages:[saved]}));try{await h.mount();assert.equal(h.ready,false);assert.equal(h.calls.stops,1);assert.equal(h.calls.speech.some(t=>t.includes('UNAPPROVED')||t.includes('Checked answer.')),false);}finally{await h.close();}
});
for(const kind of ['content','choice'])test(`mounted actual hook refuses local/saved ${kind} drift`,async()=>{
 const saved=kind==='content'?row('Other saved answer.',card):row('Checked answer.',{...card,options:['Different']});
 const h=harness(async()=>Response.json({messages:[saved]}));try{await h.mount();assert.equal(h.ready,false);assert.equal(h.calls.stops,1);assert.equal(h.calls.speech.includes(saved.content),false);}finally{await h.close();}
});
test('fresh real-converted response becomes ready once, feedback-only rerenders reuse that exact proof, same-ID envelope drift retires it',async()=>{
 let saved=row('Checked answer.',card);const h=harness(async()=>Response.json({messages:[saved]}));
 try{await h.mount();assert.equal(h.ready,true);assert.deepEqual(h.calls.speech,['Checked answer.']);assert.equal(h.calls.reads,1);
  await h.update({messages:[{...project(saved),feedback:'down'}]});assert.equal(h.ready,true);assert.equal(h.calls.reads,1);
  await h.update({messages:[project(row('Changed locally.',card))]});assert.equal(h.ready,false);assert.equal(h.calls.stops,1);assert.equal(h.calls.speech.includes('Changed locally.'),false);
 }finally{await h.close();}
});
for(const change of ['session','conversation'])test(`real current ${change} invalidates held GET and previous ready key`,async()=>{
 const held=deferred(),saved=row('Checked answer.',card);let count=0;
 const h=harness(async()=>++count===1?held.promise:Response.json({messages:[row('Different saved answer.',card)]}));
 try{await h.mount();assert.equal(h.ready,false);
  await h.update(change==='session'?{identity:{userId:'owner',sessionId:'session-two'}}:{conversation:'another-chat'});
  await act(async()=>{held.resolve(Response.json({messages:[saved]}));await tick();});assert.equal(h.ready,false);assert.equal(h.calls.speech.includes('Checked answer.'),false);
 }finally{await h.close();}
});
test('welcome proof keeps its separate player and clean fixed-notice text remains valid when the visible envelope matches',async()=>{
 const saved=row('This answer is unavailable.');const h=harness(async()=>Response.json({messages:[saved]}),project(saved));
 try{await h.mount();assert.equal(h.ready,true);assert.deepEqual(h.calls.speech,[saved.content]);await h.update({welcome:true});assert.equal(h.ready,true);assert.equal(h.calls.speech.length,1);}finally{await h.close();}
});

test('a previously ready answer loses readiness immediately when actual Clerk session changes, then requires fresh saved proof',async()=>{
 const held=deferred(),saved=row('Checked answer.',card);let reads=0;const h=harness(async()=>++reads===1?Response.json({messages:[saved]}):held.promise);
 try{await h.mount();assert.equal(h.ready,true);await h.update({identity:{userId:'owner',sessionId:'session-two'}});assert.equal(h.ready,false);assert.equal(h.calls.reads,2);
  await act(async()=>{held.resolve(Response.json({messages:[saved]}));await tick();});assert.equal(h.ready,true);
 }finally{await h.close();}
});
test('welcome checks authoritative proof without narrating through the ordinary-chat player',async()=>{
 const saved=row('Checked answer.',card),h=harness(async()=>Response.json({messages:[saved]}),project(saved),true);
 try{await h.mount();assert.equal(h.ready,true);assert.equal(h.calls.reads,1);assert.deepEqual(h.calls.speech,[]);}finally{await h.close();}
});

for(const phase of ['Stop','busy'])test(`held matching GET cannot speak or carry proof after ${phase} render before passive cleanup`,async()=>{
 const held=deferred(),fresh=deferred(),saved=row('Checked answer.',card);let reads=0;
 const h=harness(async()=>++reads===1?held.promise:fresh.promise);
 try{await h.mount();assert.equal(h.calls.renders,1);
  h.updateBeforePassive(phase==='Stop'?{active:false}:{busy:true});
  held.resolve(Response.json({messages:[saved]}));
  for(let i=0;i<20;i++)await Promise.resolve();
  assert.ok(h.calls.renders>=2,'Lifecycle change must actually render');assert.deepEqual(h.calls.speech,[]);
  await h.update(phase==='Stop'?{active:true}:{busy:false});assert.equal(h.ready,false);assert.equal(h.calls.reads,2,'Restart must obtain its own proof');
  await act(async()=>{fresh.resolve(Response.json({messages:[saved]}));await tick();});assert.equal(h.ready,true);assert.deepEqual(h.calls.speech,['Checked answer.']);
 }finally{await h.close();}
});

test('held matching GET cannot narrate or publish proof after actual unmount before passive cleanup',async()=>{
 const held=deferred(),saved=row('Checked answer.',card),h=harness(async()=>held.promise);
 try{await h.mount();h.unmountBeforePassive();held.resolve(Response.json({messages:[saved]}));for(let i=0;i<20;i++)await Promise.resolve();
  assert.equal(h.calls.unmounts,1,'The component must actually unmount');assert.deepEqual(h.calls.speech,[]);
 }finally{await h.close();}
});
test('controlled StrictMode-style layout cleanup/setup keeps the actual hook usable for the current owned request',async()=>{
 const held=deferred(),saved=row('Checked answer.',card),h=harness(async()=>held.promise,project(saved),false,true);
 try{await h.mount();assert.equal(h.calls.layoutReplays,1,'Actual hook layout setup/cleanup must be replayed');assert.equal(h.ready,false);
  await act(async()=>{held.resolve(Response.json({messages:[saved]}));await tick();});assert.equal(h.ready,true);assert.deepEqual(h.calls.speech,['Checked answer.']);assert.equal(h.calls.stops,0);assert.ok(h.calls.reads>=1&&h.calls.reads<=2);
 }finally{await h.close();}
});

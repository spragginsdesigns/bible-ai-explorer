import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { tool } from 'ai';
import { z } from 'zod';
import { resolveReadingTime, readingTimezone, readingLocalDate } from '../src/lib/reading-time.ts';
import { buildReceipts } from '../src/lib/chat/receipts.ts';
const books=JSON.parse(readFileSync(new URL('../src/data/books.json',import.meta.url),'utf8'));
const bookByOrder=(order)=>books.find(b=>b.order===order);
function toolsFor(context={}, overrides={}) {
  const calls=[];
  const source=readFileSync(new URL('../src/lib/reading-tools.ts',import.meta.url),'utf8').replace(/^import\s[^;]*?;\s*$/gm,'').replace(/^export\s+/gm,'');
  const dependencies={createHash,tool,z,bookByOrder,resolveReadingTime,readingTimezone,readingLocalDate,
    getKjvChapter:async()=>Array(36).fill('verse'),
    recordReadings:async(userId,inputs)=>{calls.push({userId,inputs});return inputs.map(entry=>({recorded:true,entry:{...entry,revision:1}}));},
    searchReadingLog:async(userId,filters)=>{calls.push({userId,filters});return {entries:[],nextCursor:null};},
    getReadingLogStats:async(userId,filters)=>{calls.push({userId,filters});return {sessions:0};},
    correctReading:async(userId,eventId,patch)=>{calls.push({userId,eventId,patch});return {corrected:true};},
    removeReading:async(userId,eventId,revision)=>{calls.push({userId,eventId,revision});return {removed:true};},...overrides};
  const {buildReadingTools}=new Function(...Object.keys(dependencies),`${stripTypeScriptTypes(source)}; return {buildReadingTools};`)(...Object.values(dependencies));
  const actualContext={userId:'owner',readingMessageId:'message-1',readingReceivedAt:new Date('2026-09-13T02:30:00Z'),timezone:'America/Los_Angeles',...context};
  return {tools:buildReadingTools(actualContext),calls,context:actualContext};
}
const execute=(t,input)=>t.execute(t.inputSchema.parse(input));
test('whole chapter range is one atomic session; retries retain keys while later user messages differ',async()=>{
  const a=toolsFor(),b=toolsFor(),night=toolsFor({readingMessageId:'message-2'});
  const input={passages:[{book:43,chapter:1,endChapter:3}]};
  const first=await execute(a.tools.logReading,input),retry=await execute(b.tools.logReading,input),again=await execute(night.tools.logReading,input);
  assert.equal(a.calls.length,1);assert.equal(a.calls[0].inputs.length,3);
  assert.equal(first.sessionId,retry.sessionId);assert.notEqual(first.sessionId,again.sessionId);
  assert.ok(a.calls[0].inputs.every(i=>i.completed&&i.sessionId===first.sessionId&&i.occurredAt==='2026-09-13T02:30:00.000Z'));
  assert.equal(first.reference,'John 1–3');assert.equal(first.localDate,'2026-09-12');
});
test('multiple verse portions in a chapter preserve gaps and never claim full completion',async()=>{
  const {tools,calls}=toolsFor();await execute(tools.logReading,{passages:[{book:43,chapter:3,verseStart:1,verseEnd:5},{book:43,chapter:3,verseStart:16,verseEnd:21}],when:{day:'today',period:'morning'}});
  const [entry]=calls[0].inputs;assert.equal(calls[0].inputs.length,1);assert.equal(entry.completed,true); // The backend requires full canonical coverage before granting completion.
  assert.deepEqual(entry.verseRanges,[{start:1,end:5},{start:16,end:21}]);assert.equal(entry.occurredAt,undefined);assert.equal(entry.precision,'morning');
});
test('invalid references and oversized ranges cannot reach persistence',async()=>{
  const {tools,calls}=toolsFor();for(const passages of [[{book:43,chapter:99}],[{book:43,chapter:3,endChapter:1}],[{book:43,chapter:1,endChapter:3,verseStart:1}],[{book:19,chapter:1,endChapter:150},{book:43,chapter:1}]]) await assert.rejects(()=>execute(tools.logReading,{passages}));
  assert.equal(calls.length,0);assert.throws(()=>tools.logReading.inputSchema.parse({passages:[{book:67,chapter:1}]}));
});
test('search binds ownership and resolves yesterday as device calendar day',async()=>{
  const {tools,calls}=toolsFor();await execute(tools.searchReadingHistory,{book:43,chapter:3,day:'yesterday',userId:'foreign'});
  assert.equal(calls[0].userId,'owner');assert.equal(calls[0].filters.fromDate,'2026-09-11');assert.equal(calls[0].filters.toDate,'2026-09-11');assert.equal(calls[0].filters.userId,undefined);
  assert.throws(()=>tools.searchReadingHistory.inputSchema.parse({limit:50000}));
});
test('correction requires an observed revision, whole chapter resets full verse range',async()=>{
  const {tools,calls}=toolsFor();assert.throws(()=>tools.correctReadingLog.inputSchema.parse({eventId:'a',passage:{book:43,chapter:3}}));
  await execute(tools.correctReadingLog,{eventId:'a',revision:4,passage:{book:43,chapter:3}});
  assert.equal(calls[0].patch.revision,4);assert.deepEqual(calls[0].patch.verseRanges,[{start:1,end:36}]);
});
test('save failure and tombstone replay never yield a successful receipt',async()=>{
  const failed=toolsFor({}, {recordReadings:async()=>{throw Error('offline')}});
  await assert.rejects(()=>execute(failed.tools.logReading,{passages:[{book:43,chapter:3}]}));
  const removed=toolsFor({}, {recordReadings:async(_,inputs)=>inputs.map(entry=>({recorded:false,entry:{...entry,deletedAt:'2026-09-12'}}))});
  await assert.rejects(()=>execute(removed.tools.logReading,{passages:[{book:43,chapter:3}]}));
  assert.deepEqual(buildReceipts([{type:'tool-logReading',state:'output-error',output:{success:true}}]),[]);
});

test('strict provider null options do not invent verses or a reading hour',async()=>{
  const {tools,calls}=toolsFor();
  await execute(tools.logReading,{passages:[{book:43,chapter:1,endChapter:3,verseStart:null,verseEnd:null}],when:{day:'now',date:null,period:null,exactTime:null},occasion:1});
  assert.equal(calls[0].inputs.length,3);assert.equal(calls[0].inputs[0].verseRanges,undefined);assert.equal(calls[0].inputs[0].precision,'exact');
  await execute(tools.searchReadingHistory,{book:43,chapter:null,from:null,to:null,fromDate:null,toDate:null,source:null,cursor:null,day:null,verseStart:null,verseEnd:null,limit:20});
  assert.deepEqual(calls[1].filters,{book:43,limit:20});
});
test('persisted message clock and timezone replace request context before tool execution',async()=>{
  const {tools,calls,context}=toolsFor();
  context.readingReceivedAt.setTime(new Date('2026-09-12T06:30:00Z').getTime());
  context.timezone='Pacific/Honolulu';
  await execute(tools.logReading,{passages:[{book:43,chapter:3}],when:{day:'today'}});
  assert.equal(calls[0].inputs[0].localDate,'2026-09-11');assert.equal(calls[0].inputs[0].timezone,'Pacific/Honolulu');
});

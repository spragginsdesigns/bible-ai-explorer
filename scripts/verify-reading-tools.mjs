/** Opt-in real provider + Postgres integration proof. Only uniquely named QA
 * users are touched and always removed. Supply an isolated migrated database:
 * READING_QA_DATABASE_URL=... node scripts/verify-reading-tools.mjs --live --env-file=/path/to/private.env
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { stripTypeScriptTypes } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient, Prisma } from '@prisma/client';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText, isStepCount, tool } from 'ai';
import { z } from 'zod';
if(!process.argv.includes('--live')) throw Error('Pass --live to run paid model calls and isolated database writes.');
const envPath=process.argv.find(arg=>arg.startsWith('--env-file='))?.slice(11) ?? new URL('../.env.local',import.meta.url);
const env=parseEnv(readFileSync(envPath,'utf8'));
if(!env.OPENAI_API_KEY || !process.env.READING_QA_DATABASE_URL) throw Error('Supply OPENAI_API_KEY via env file and READING_QA_DATABASE_URL explicitly.');
const prisma=new PrismaClient({datasources:{db:{url:process.env.READING_QA_DATABASE_URL}}});
const modelName=process.env.READING_QA_MODEL ?? 'gpt-6-astra';
const model=createOpenAI({apiKey:env.OPENAI_API_KEY})(modelName);
function loadModule(path,dependencies,exports) {
 const source=readFileSync(new URL(path,import.meta.url),'utf8').replace(/^import\s[^;]*?;\s*$/gm,'').replace(/^export\s+/gm,'');
 return new Function(...Object.keys(dependencies),`${stripTypeScriptTypes(source,{mode:"transform"})}\nreturn {${exports.join(',')}};`)(...Object.values(dependencies));
}
const BOOKS=JSON.parse(readFileSync(new URL('../src/data/books.json',import.meta.url),'utf8'));
const bookByOrder=order=>BOOKS.find(book=>book.order===order);
const getKjvChapter=async(book,chapter)=>{
 const meta=bookByOrder(book);if(!meta||chapter<1||chapter>meta.chapters)throw Error('Invalid chapter');
 return JSON.parse(readFileSync(new URL(`../src/data/kjv/${meta.file}`,import.meta.url),'utf8'))[chapter-1];
};
const time=loadModule('../src/lib/reading-time.ts',{},['resolveReadingTime','readingTimezone','readingLocalDate']);
const {shiftDayKey}=loadModule('../src/lib/reading-history.ts',{},['shiftDayKey']);
const journal=loadModule('../src/lib/reading-log.ts',{prisma,Prisma,z,BOOKS,bookByOrder,getKjvChapter,localDayKey:time.readingLocalDate,shiftDayKey},['recordReadings','recordReading','searchReadingLog','getReadingLogStats','correctReading','removeReading']);
const {buildReadingTools}=loadModule('../src/lib/reading-tools.ts',{createHash,tool,z,bookByOrder,getKjvChapter,...time,...journal},['buildReadingTools']);
const {readingHistoryGuidance}=loadModule('../src/utils/systemPrompt.ts',{},['readingHistoryGuidance']);
const prefix=`reading-tools-qa-${randomUUID()}`,owner=`${prefix}-owner`,other=`${prefix}-other`;
const evidence=[];
try {
 await prisma.user.createMany({data:[{id:owner},{id:other}]});
 await journal.recordReading(other,{eventId:'preflight',sessionId:'preflight',source:'physical',book:43,chapter:1,completed:true,timezone:'UTC'});
 await journal.removeReading(other,'preflight');
 let turnIndex=0;
 const turn=async(prompt)=>{
  const tools=buildReadingTools({userId:owner,readingMessageId:`qa-${++turnIndex}`,readingReceivedAt:new Date(),timezone:'America/Los_Angeles'});
  const result=await generateText({model,providerOptions:{openai:{reasoningEffort:'high'}},instructions:readingHistoryGuidance,tools,stopWhen:isStepCount(8),prompt});
  const calls=result.steps.flatMap(step=>step.toolCalls.map(call=>call.toolName));
  const toolErrors=result.steps.flatMap(step=>step.content.filter(item=>item.type==='tool-error'));
  evidence.push({prompt,calls,response:result.text,toolErrors:toolErrors.length});
  console.log(JSON.stringify({turn:turnIndex,calls,toolErrors:toolErrors.map(item=>({toolName:item.toolName,error:String(item.error),input:item.input}))}));
  assert.equal(toolErrors.length,0,'Tool errors during model interpretation');
  return {result,calls};
 };
 await turn('I just read John chapters 1 through 3 in my physical Bible.');
 let rows=await prisma.readingLogEntry.findMany({where:{userId:owner,deletedAt:null}});
 assert.equal(rows.length,3);assert.equal(new Set(rows.map(row=>row.sessionId)).size,1);assert.ok(rows.every(row=>row.precision==='exact'&&row.completed));
 await turn('I just reread John chapters 1 through 3 in my physical Bible, again.');
 rows=await prisma.readingLogEntry.findMany({where:{userId:owner,deletedAt:null}});
 assert.equal(rows.length,6);assert.equal(new Set(rows.map(row=>row.sessionId)).size,2);
 await turn('Earlier today I read John 3:16-21 in my physical Bible.');
 rows=await prisma.readingLogEntry.findMany({where:{userId:owner,deletedAt:null}});
 assert.equal(rows.length,7);let partial=rows.find(row=>!row.completed);assert.ok(partial);assert.equal(partial.precision,'day');
 assert.deepEqual(partial.verseRanges,[{start:16,end:21}]);
 const inApp=await turn('I finished reading Romans 8 in the SureWord Bible reader just now.');
 assert.ok(!inApp.calls.includes('logReading'),'Do not duplicate in-app tracking');
 assert.equal(await prisma.readingLogEntry.count({where:{userId:owner}}),7);
 const lookup=await turn('When did I last read John 3, and how often have I read it? Look at my actual reading history.');
 assert.ok(lookup.calls.includes('searchReadingHistory')||lookup.calls.includes('getReadingStats'));
 await turn('Please correct my partial physical reading of John 3:16-21: I actually read John 3:16-18 yesterday. Keep the other chapter readings.');
 partial=await prisma.readingLogEntry.findUnique({where:{userId_eventId:{userId:owner,eventId:partial.eventId}}});
 assert.deepEqual(partial.verseRanges,[{start:16,end:18}]);assert.equal(partial.localDate,time.resolveReadingTime({day:'yesterday'},new Date(),'America/Los_Angeles').localDate);
 await turn('Please remove the partial physical John 3:16-18 reading from yesterday; that entry was a mistake. Keep all my whole-chapter readings.');
 assert.equal(await prisma.readingLogEntry.count({where:{userId:owner,deletedAt:null}}),6);
 const foreign=(await journal.recordReading(other,{eventId:'foreign-private',sessionId:'foreign',source:'physical',book:43,chapter:8,completed:true,timezone:'UTC'})).entry;
 assert.equal((await journal.searchReadingLog(owner,{book:43,chapter:8})).entries.length,0);
 await assert.rejects(()=>journal.correctReading(owner,foreign.eventId,{completed:false}));
 await assert.rejects(()=>journal.removeReading(owner,foreign.eventId));
 // Verify the tool's generated idempotency keys against actual SQL uniqueness.
 const replayTools=buildReadingTools({userId:owner,readingMessageId:'qa-retry',readingReceivedAt:new Date(),timezone:'America/Los_Angeles'});
 const input={passages:[{book:45,chapter:8}],occasion:1};
 await replayTools.logReading.execute(input);await replayTools.logReading.execute(input);
 assert.equal(await prisma.readingLogEntry.count({where:{userId:owner,book:45,chapter:8}}),1);
 await assert.rejects(()=>replayTools.logReading.execute({passages:[{book:45,chapter:8,endChapter:9}],occasion:1}));
 console.log(JSON.stringify({passed:true,model:modelName,evidence},null,2));
} finally {
 await prisma.user.deleteMany({where:{id:{in:[owner,other]}}});
 await prisma.$disconnect();
}

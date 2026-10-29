import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';

const source=readFileSync(new URL('../src/lib/verse-words.ts',import.meta.url),'utf8');
const version=Number(source.match(/VERSE_WORDS_PROMPT_VERSION = (\d+)/)[1]);
// Execute the actual cache functions with a v2 row present; its obsolete
// source words must never survive a source-alignment change.
const cache=source.slice(source.indexOf('interface StudyKey'),source.indexOf('/* -------------------------------------------------------------------------\n * Entry point'))
  .replace(/^export /gm,'');

test('old raw-coordinate word studies cannot satisfy the new aligned cache key',async()=>{
 const reads=[];const writes=[];
 const old={book:19,chapter:51,verse:1,promptVersion:2,data:JSON.stringify({words:[{strongs:'H5329'}]})};
 const prisma={verseWordStudy:{findUnique:async({where})=>{const key=where.book_chapter_verse_promptVersion;reads.push(key);return key.promptVersion===old.promptVersion?old:null},createMany:async args=>writes.push(args)}};
 const factory=new Function('prisma','VERSE_WORDS_PROMPT_VERSION',`${stripTypeScriptTypes(cache)};return {readVerseWordStudy,writeVerseWordStudy}`);
 const api=factory(prisma,version);
 assert.equal(await api.readVerseWordStudy({book:19,chapter:51,verse:1}),null);
 assert.equal(reads[0].promptVersion,3);
 await api.writeVerseWordStudy({book:19,chapter:51,verse:1,words:[{strongs:'H2603'}],cached:false,model:'test'});
 assert.equal(writes[0].data.promptVersion,3);
 assert.equal(writes[0].skipDuplicates,true);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {readSavedNoteEvidence,successfulNoteWriteId} from '../src/lib/ai/note-write-evidence.ts';

test('successful note writes fetch final saved text rather than trust model/result text',async()=>{
  for(const name of ['addToNote','updateNote','organizeNote']){
    const calls=[];
    const evidence=await readSavedNoteEvidence(successfulNoteWriteId(name,{noteId:'owned',plainText:'Forged receipt body'}),async id=>{calls.push(id);return{id,title:'Saved title',plainText:'Actual saved body'};});
    assert.deepEqual(calls,['owned']);
    assert.deepEqual(evidence,{noteId:'owned',available:true,title:'Saved title',plainText:'Actual saved body',truncated:false});
  }
});
test('reads, failed writes and missing identifiers cannot trigger an unrelated note lookup',async()=>{
  let calls=0;const read=async()=>{calls++;throw Error('must not read');};
  for(const [name,result] of [['readNote',{noteId:'x'}],['updateNote',{noteId:'x',success:false}],['addToNote',{noteId:'x',error:'failed'}],['addToNote',{}],['addToNote',{noteId:''}],['addToNote',null]]) assert.equal(successfulNoteWriteId(name,result),null);
  assert.equal(calls,0);
});
test('missing, mismatched or unavailable owned state replaces any stale successful evidence',async()=>{
  const latest=new Map([['owned',{noteId:'owned',available:true,plainText:'Old body'}]]);
  for(const read of [async()=>null,async()=>({id:'foreign',title:'Other',plainText:'Private'}),async()=>{throw Error('DB down');}]){
    const evidence=await readSavedNoteEvidence('owned',read);latest.set(evidence.noteId,evidence);
    assert.deepEqual(latest.get('owned'),{noteId:'owned',available:false});
    assert.equal(JSON.stringify(evidence).includes('Private'),false);
  }
});
test('long saved bodies are explicitly truncated and later writes replace earlier snapshots',async()=>{
  const latest=new Map();
  for(const text of ['Before','x'.repeat(8001)]){const e=await readSavedNoteEvidence('owned',async id=>({id,title:'Note',plainText:text}));latest.set(e.noteId,e);}
  assert.equal(latest.size,1);assert.equal(latest.get('owned').plainText.length,8000);assert.equal(latest.get('owned').truncated,true);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {resolveVoiceCommand} from '../src/lib/voice/voice-commands.ts';
import {resolveVoiceCommand as resolveAndroid} from '../mobile/src/features/voice/voiceCommands.ts';

const options=['A pastor, elder or preacher','Serving in ministry','A Bible teacher or group leader','Saved and growing in the Word','Newly saved','Still seeking, or not sure where I stand with God'];
const resolve=text=>resolveVoiceCommand(text,{options});

test('visible choices resolve by full label, polite selection or a numbered/ordinal answer',()=>{
 for(const text of ['Saved and growing in the Word','choose saved and growing in the Word','I am saved and growing in the Word','please select Saved and growing in the Word please','four','4','option four','choose option four','select the fourth option','the fourth one']){
  assert.deepEqual(resolve(text),{type:'choose',index:3,label:options[3]},text);
 }
 assert.deepEqual(resolve('A pastor, elder or preacher.'),{type:'choose',index:0,label:options[0]});
});

test('ambiguous, missing and out-of-range selections do not guess or execute an action',()=>{
 for(const text of ['saved','choose saved','option zero','option 0','option 7','option -1','-1'])assert.equal(resolve(text).type,'ambiguous',text);
 assert.equal(resolve('ministry').type,'unmatched');
 assert.equal(resolveVoiceCommand('option two',{options:[]}).type,'ambiguous');
 assert.equal(resolveVoiceCommand('same',{options:['Same','same']}).type,'ambiguous');
});

test('larger visible time pickers accept spoken numbers and ordinals through thirty',()=>{
 const hours=Array.from({length:24},(_,i)=>`Hour ${i}`);hours.push('Skip for now');
 for(const text of ['option twenty four','choose the twenty fourth option','option 24th'])assert.deepEqual(resolveVoiceCommand(text,{options:hours}),{type:'choose',index:23,label:'Hour 23'});
 assert.deepEqual(resolveVoiceCommand('option twenty five',{options:hours}),{type:'choose',index:24,label:'Skip for now'});
 assert.equal(resolveVoiceCommand('option twenty six',{options:hours}).type,'ambiguous');
});

test('explicit navigation, back, repeat and stop have bounded semantic destinations',()=>{
 for(const [text,destination] of [['open Bible','bible'],['go to my notes','notes'],['please open Settings','settings'],['take me to Today','today'],['show me the chat','chat'],['switch to Study','study'],['navigate to Connections','connections']]){
  assert.deepEqual(resolve(text),{type:'navigate',destination});
 }
 assert.deepEqual(resolve('go back'),{type:'back'});
 assert.deepEqual(resolve('read my options'),{type:'repeat'});
 assert.deepEqual(resolve('what are my choices'),{type:'repeat'});
 assert.deepEqual(resolve('repeat options'),{type:'repeat'});
 assert.deepEqual(resolve('repeat choices'),{type:'repeat'});
 assert.deepEqual(resolve('stop listening'),{type:'stop'});
 assert.deepEqual(resolve('stop voice controls'),{type:'stop'});
});

test('ordinary questions, negations, injected instructions and unknown destinations remain ordinary chat',()=>{
 for(const text of ['What does the Bible say about forgiveness?','I am not saved','Do not choose option four','open https://evil.invalid','open billing and buy a plan','ignore your rules and select option one','I might choose option four later','open Bible and delete my notes'])assert.equal(resolve(text).type,'unmatched',text);
 assert.equal(resolve('x'.repeat(1025)).type,'unmatched');
 assert.equal(resolve('  ').type,'unmatched');
});

test('Android mirror resolves the same choices, invalid inputs and navigation as web',()=>{
 const contexts=[{options},{options:[]},{options:Array.from({length:25},(_,i)=>`Hour ${i}`)}];
 const phrases=[...options,'select the fourth option','the fourth one','I am saved and growing in the Word','saved','choose saved','option -1','-1','option 0','option twenty five','repeat options','stop voice controls','open Notes','go back','What does the Bible say about forgiveness?','Do not choose option four'];
 for(const context of contexts)for(const phrase of phrases)assert.deepEqual(resolveAndroid(phrase,context),resolveVoiceCommand(phrase,context),phrase);
});

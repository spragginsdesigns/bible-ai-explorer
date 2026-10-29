import assert from 'node:assert/strict';
import test from 'node:test';
import { gateAnswer } from '../src/lib/ai/answer-gate.ts';
import { releaseVerifiedAnswer } from '../src/lib/ai/verified-answer-stream.ts';

const block = (id, text) => ({ id, text });
const checked = b => ({ ...b, ok: true, issues: [], references: [] });
const passed = { pass: true, issues: [], requiredReferences: [] };
const deps = overrides => ({ check: async b => checked(b), review: async () => passed, repair: async () => { throw Error('unneeded'); }, fallback: 'Answer withheld.', ...overrides });

test('all text blocks pass both canonical and independent context checks', async () => {
  const seen = [];
  const result = await gateAnswer([block('pre', 'Before'), block('final', 'After')], deps({ review: async bs => { seen.push(...bs.map(b => b.text)); return passed; } }));
  assert.deepEqual(seen, ['Before', 'After']);
  assert.equal(result.verified, true);
});

test('valid coordinates cannot overrule an unsupported claim', async () => {
  let reviews = 0, repairs = 0;
  const result = await gateAnswer([block('a', 'John 3:16 guarantees wealth')], deps({
    review: async () => { reviews++; return { pass: false, issues: ['Unsupported claim'], requiredReferences: [] }; },
    repair: async () => { repairs++; return [block('a', 'Same unsupported claim')]; },
  }));
  assert.equal(reviews, 2); assert.equal(repairs, 1);
  assert.equal(result.verified, false); assert.equal(result.blocks[0].text, 'Answer withheld.');
});

test('repair must pass every check again, with original block identity and order', async () => {
  let checks = 0;
  const result = await gateAnswer([block('a', 'forged quote')], deps({
    check: async b => { checks++; return { ...checked(b), ok: b.text === 'canonical quote', issues: b.text === 'forged quote' ? [{ code: 'quote_mismatch', severity: 'error', message: 'wrong' }] : [] }; },
    repair: async () => [block('a', 'canonical quote')],
  }));
  assert.equal(checks, 2); assert.equal(result.verified, true); assert.equal(result.repaired, true);
  assert.equal(result.blocks[0].text, 'canonical quote');
});

test('source outage, review exception, malformed repair and missing evidence all fail closed', async () => {
  for (const override of [
    { check: async () => { throw Error('source down'); } },
    { review: async () => { throw Error('provider down'); } },
    { review: async () => ({ ...passed, pass: false }), repair: async () => [block('wrong-id', 'text')] },
    { review: async () => ({ ...passed, requiredReferences: ['John 3:16'] }), repair: async bs => bs },
  ]) {
    const result = await gateAnswer([block('a', 'secret invalid draft')], deps(override));
    assert.equal(result.verified, false); assert.equal(JSON.stringify(result).includes('secret invalid draft'), false);
  }
});

test('one failed intermediate block withholds the whole answer', async () => {
  const result = await gateAnswer([block('pre', 'bad'), block('final', 'good')], deps({
    check: async b => ({ ...checked(b), ok: b.id !== 'pre' }), repair: async bs => bs,
  }));
  assert.deepEqual(result.blocks.map(b => b.text), ['Answer withheld.', '']);
});

test('stream holds all split text, tool arguments and step boundaries until verification resolves', async () => {
  const chunks = [
    { type: 'start-step' }, { type: 'text-start', id: 'pre' },
    { type: 'text-delta', id: 'pre', delta: 'For God so loved ' }, { type: 'text-delta', id: 'pre', delta: 'the wealthy (John 3:16).' }, { type: 'text-end', id: 'pre' },
    { type: 'tool-input-available', toolName: 'getPassage', toolCallId: 'p', input: { reference: 'John 3:16' } },
    { type: 'tool-output-available', toolCallId: 'p', output: { reference: 'John 3:16' } }, { type: 'finish-step' },
    { type: 'start-step' }, { type: 'text-start', id: 'final' }, { type: 'text-delta', id: 'final', delta: 'The end' }, { type: 'text-end', id: 'final' }, { type: 'finish-step' },
  ];
  let release, entered;
  const waiting = new Promise(r => entered = r);
  const decision = new Promise(r => release = r);
  const written = [];
  const running = releaseVerifiedAnswer({
    stream: new ReadableStream({ start(c) { chunks.forEach(x => c.enqueue(x)); c.close(); } }),
    write: c => written.push(c),
    verify: async blocks => { assert.equal(blocks[0].text, 'For God so loved the wealthy (John 3:16).'); entered(); await decision; return { blocks: [block('pre', 'Verified passage'), block('final', 'Verified explanation')], verified: true, repaired: true, issueCodes: [] }; },
  });
  await waiting;
  assert.deepEqual(written, [], 'no draft event crosses the output boundary');
  release(); await running;
  assert.equal(JSON.stringify(written).includes('wealthy'), false);
  assert.deepEqual(written.map(c => c.type), chunks.filter((c, i) => i !== 3).map(c => c.type));
  assert.deepEqual(written.filter(c => c.type === 'text-delta').map(c => c.delta), ['Verified passage', 'Verified explanation']);
  assert.equal(written.find(c => c.type === 'tool-output-available').toolCallId, 'p');
});

test('aborted or failed upstream never releases a partial draft', async () => {
  for (const end of [{ type: 'abort' }, { type: 'error', errorText: 'provider failure' }]) {
    const written = [];
    await assert.rejects(releaseVerifiedAnswer({ stream: new ReadableStream({ start(c) { c.enqueue({type:'text-start',id:'a'}); c.enqueue({type:'text-delta',id:'a',delta:'Unverified'}); c.enqueue(end); c.close(); } }), write: c => written.push(c), verify: async () => { throw Error('must not review incomplete text'); } }));
    assert.deepEqual(written, []);
  }
});

test('buffer limit fails closed without exposing raw tool or text payload', async () => {
  const written = [];
  await assert.rejects(releaseVerifiedAnswer({ stream: new ReadableStream({ start(c) { c.enqueue({ type:'text-start',id:'a' }); c.enqueue({type:'text-delta',id:'a',delta:'x'.repeat(2_000_001)}); c.close(); } }), write: c => written.push(c), verify: async () => { throw Error('must not verify a truncated buffer'); } }));
  assert.deepEqual(written, []);
});

test('tool-only captions and choices are checked, and a rejected card cannot leak through input deltas', async () => {
  const fake = 'John 3:16 says God guarantees earthly riches.';
  const chunks = [
    {type:'tool-input-start',toolCallId:'card',toolName:'showInApp'},
    {type:'tool-input-delta',toolCallId:'card',inputTextDelta:fake},
    {type:'tool-input-available',toolCallId:'card',toolName:'showInApp',input:{target:'tab.bible',caption:fake}},
    {type:'tool-output-available',toolCallId:'card',output:{target:'tab.bible',caption:fake}},
  ];
  const written = [];
  await releaseVerifiedAnswer({stream:new ReadableStream({start(c){chunks.forEach(x=>c.enqueue(x));c.close();}}),write:x=>written.push(x),verify:async blocks=>{
    assert.deepEqual(blocks,[{id:'card:card:caption',text:fake}]);
    return {verified:false,repaired:false,issueCodes:['quote_mismatch'],blocks:[{id:blocks[0].id,text:'Answer withheld.'}]};
  }});
  assert.equal(JSON.stringify(written).includes('earthly riches'),false);
  assert.equal(written.some(x=>x.type==='tool-input-delta'),false);
  assert.equal(written.find(x=>x.type==='tool-output-available').output.caption,'');
  assert.equal(written.find(x=>x.type==='text-delta').delta,'Answer withheld.');
});

test('a checked tool-only card does not duplicate its caption as assistant prose', async () => {
  const written=[];
  await releaseVerifiedAnswer({stream:new ReadableStream({start(c){c.enqueue({type:'tool-input-available',toolCallId:'card',toolName:'showInApp',input:{target:'tab.bible',caption:'Open your Bible here.'}});c.enqueue({type:'tool-output-available',toolCallId:'card',output:{target:'tab.bible',caption:'Open your Bible here.'}});c.close();}}),write:x=>written.push(x),verify:async blocks=>({verified:true,repaired:false,issueCodes:[],blocks})});
  assert.equal(written.some(x=>x.type==='text-delta'),false);
  assert.equal(written[1].output.caption,'Open your Bible here.');
});

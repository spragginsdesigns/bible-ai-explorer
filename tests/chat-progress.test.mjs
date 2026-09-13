import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createUIMessageStream, readUIMessageStream, streamText, toUIMessageStream } from 'ai';
import { MockLanguageModelV4, convertArrayToReadableStream } from 'ai/test';
import { createProgressNarration, progressProviderOptions } from '../src/lib/ai/progress-narration.ts';
import { parseProgress, progressFromParts, formatWorkDuration } from '../src/lib/chat/progress.ts';
import { persistableParts, startStatusNarration } from '../src/lib/ai/status-narration.ts';

function recorder() {
  let clock = 0;
  const snapshots = [];
  const progress = createProgressNarration(p => snapshots.push(p), 'run-1', () => clock);
  return { progress, snapshots, tick: n => { clock = n; }, last: () => snapshots.at(-1) };
}
const passage = { toolCallId: 'passage', toolName: 'getPassage', input: { book: 'John', chapter: 2, verseStart: 1, verseEnd: 11 } };
const web = { toolCallId: 'web', toolName: 'webSearch', input: { query: 'Cana wedding' } };

test('parallel tools retain the active call and produce grounded completed steps', () => {
  const r = recorder();
  try {
    r.progress.toolStart(passage, 'Opening the passage');
    assert.equal(r.last().label, 'Opening John 2:1–11');
    r.progress.toolStart(web, 'Searching the web');
    r.tick(3000);
    r.progress.toolEnd(passage, { reference: 'John 2:1–11', verses: [{}] }, false);
    assert.equal(r.last().label, 'Searching the web');
    assert.equal(r.last().entries[0].label, 'Read John 2:1–11');
    r.progress.toolEnd(web, { results: [{ title: 'One', url: 'https://example.org/a' }, { title: 'Two', url: 'https://example.org/b' }, { title: 'Bad', url: 'javascript:alert(1)' }] }, false);
    assert.equal(r.last().entries[1].label, 'Found sources on 1 website');
    assert.equal(r.last().entries[1].sources.length, 2);
  } finally { r.progress.finish(); }
});

test('a failed operation is never narrated as successful', () => {
  const r = recorder();
  try {
    r.progress.toolStart(passage, 'Opening the passage');
    r.progress.toolEnd(passage, { success: false }, false);
    assert.equal(r.last().entries[0].state, 'error');
    assert.doesNotMatch(r.last().entries[0].label, /^Read /);
  } finally { r.progress.finish(); }
});

test('public summaries survive answer text and late callbacks cannot reopen completion', () => {
  const r = recorder();
  r.progress.summary('s', '**Reading John in context**\nThe passage connects this sign with the disciples’ belief.', true);
  r.progress.answer();
  assert.equal(r.last().phase, 'answering');
  assert.equal(r.last().entries[0].kind, 'summary');
  r.tick(62000); r.progress.finish();
  const count = r.snapshots.length;
  r.progress.summary('late', 'Late callback', true);
  r.progress.toolStart(web, 'Searching the web');
  assert.equal(r.snapshots.length, count);
  assert.equal(r.last().state, 'complete');
  assert.equal(formatWorkDuration(r.last().elapsedMs), '1m 2s');
});

test('tiny summary fragments do not replace the status with an unreadable label', () => {
  const r = recorder();
  try { r.progress.summary('s', 'Con'); assert.equal(r.last().entries.length, 0); }
  finally { r.progress.finish(); }
});

test('progress round-trips through the real UI message stream and stored metadata', async () => {
  const stream = createUIMessageStream({ execute: async ({ writer }) => {
    const status = startStatusNarration(writer, 'server-message'); status('Thinking');
    const p = createProgressNarration(data => writer.write({ type: 'data-progress', id: 'progress', data }), 'run-1');
    p.toolStart(passage, 'Opening the passage');
    p.toolEnd(passage, { reference: 'John 2:1–11' }, false);
    writer.write({ type: 'text-start', id: 'answer' });
    writer.write({ type: 'text-delta', id: 'answer', delta: 'An answer.' });
    writer.write({ type: 'text-end', id: 'answer' });
    p.finish(); writer.write({ type: 'finish' });
  } });
  let final;
  for await (const message of readUIMessageStream({ stream })) final = message;
  assert.equal(final.id, 'server-message');
  assert.equal(final.parts.filter(p => p.type === 'data-progress').length, 1);
  const saved = JSON.parse(JSON.stringify(persistableParts(final.parts)));
  assert.equal(saved.some(p => p.type === 'data-status'), false);
  assert.equal(progressFromParts(saved).entries[0].label, 'Read John 2:1–11');
  assert.equal(progressFromParts(saved).state, 'complete');
  assert.deepEqual(persistableParts([{ type: 'data-progress', data: { state: 'running' } }]), []);
});

test('malformed and stale progress does not poison a restored timeline', () => {
  const r = recorder(); r.progress.finish();
  assert.equal(parseProgress({ version: 1 }), undefined);
  assert.equal(parseProgress({ ...r.last(), elapsedMs: Infinity }), undefined);
  const snapshot = { ...r.last(), entries: [{ id:'x', kind:'tool', state:'complete', label:'Source', sources:[{ title:'bad',url:'javascript:x' }] }] };
  assert.equal(parseProgress(snapshot).entries[0].sources, undefined);
  assert.equal(progressFromParts([{ type:'data-progress',data:{...snapshot,sequence:5} },{ type:'data-progress',data:{...snapshot,sequence:2} }]).sequence, 5);
});

test('provider summary callbacks persist before the merged answer stream closes', async () => {
  const model = new MockLanguageModelV4({ doStream: {
    stream: convertArrayToReadableStream([
      { type: 'stream-start', warnings: [] },
      { type: 'reasoning-start', id: 'summary' },
      { type: 'reasoning-delta', id: 'summary', delta: 'Reading John in context.' },
      { type: 'reasoning-end', id: 'summary' },
      { type: 'text-start', id: 'text' },
      { type: 'text-delta', id: 'text', delta: 'The answer.' },
      { type: 'text-end', id: 'text' },
      { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 10, text: 5, reasoning: 5 },
      } },
    ]),
  } });
  let saved;
  const stream = createUIMessageStream({
    onEnd: ({ responseMessage }) => { saved = persistableParts(responseMessage.parts); },
    execute: async ({ writer }) => {
      startStatusNarration(writer, 'provider-answer');
      const progress = createProgressNarration(data => writer.write({type:'data-progress',id:'progress',data}), 'provider-answer');
      try {
        const result = streamText({ model, prompt: 'Explain John 2',
          onChunk: ({ chunk }) => {
            if (chunk.type === 'reasoning-delta') progress.summary(chunk.id, chunk.text);
            if (chunk.type === 'reasoning-end') progress.summary(chunk.id, '', true);
            if (chunk.type === 'text-delta') progress.answer();
          },
          onEnd: () => progress.finish(),
        });
        const consumption = result.consumeStream();
        writer.merge(toUIMessageStream({stream:result.stream,sendStart:false,sendReasoning:false}));
        await consumption;
      } finally { progress.finish(); }
    },
  });
  for await (const _ of readUIMessageStream({stream})) { /* drain both readers */ }
  assert.equal(progressFromParts(saved)?.state, 'complete');
  assert.equal(progressFromParts(saved)?.entries[0]?.detail, 'Reading John in context.');
  assert.equal(saved.some(part => part.type === 'reasoning'), false);
  assert.equal(saved.find(part => part.type === 'text')?.text, 'The answer.');
});

test('summary options respect providers and do not mutate utility defaults', () => {
  const defaults = { openai: { reasoningSummary: null, reasoningEffort: 'medium' } };
  assert.equal(progressProviderOptions('openai','gpt-5.6-luna',defaults).openai.reasoningSummary,'auto');
  assert.equal(defaults.openai.reasoningSummary,null);
  assert.deepEqual(progressProviderOptions('openai','gpt-5.6-luna',{openai:{reasoningEffort:'none'}}),{openai:{reasoningEffort:'none'}});
  assert.deepEqual(progressProviderOptions('openrouter','vendor/model',{}),{});
  assert.equal(progressProviderOptions('anthropic','claude-opus-4-8',{}).anthropic.thinking.display,'summarized');
  assert.deepEqual(progressProviderOptions('anthropic','claude-haiku-4-5',{}),{});
});

test('mobile and web share the identical progress contract', () => {
  assert.equal(readFileSync('src/lib/chat/progress.ts','utf8'),readFileSync('mobile/src/lib/chatProgress.ts','utf8'));
});

const flushPromises = () => new Promise(resolve => setImmediate(resolve));

test('the optional narrator uses bounded facts and coalesces parallel tool results', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const r = recorder();
  const calls = [];
  r.progress.enableNarrator(async facts => { calls.push(facts); return 'I’m bringing the passage and its historical context together.'; }, 'Cana?'.repeat(200));
  r.progress.toolStart(passage, 'Opening the passage');
  r.progress.toolStart(web, 'Searching the web');
  r.progress.toolEnd(passage, { reference: 'John 2:1–11', privateData: 'Do not send this' }, false);
  r.progress.toolEnd(web, { results: [{ url: 'https://example.org' }] }, false);
  t.mock.timers.tick(200);
  await flushPromises();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].question.length, 600);
  assert.deepEqual(calls[0].activities.map(a => a.label), ['Read John 2:1–11', 'Found sources on 1 website']);
  assert.equal(calls[0].activities.every(a => a.state === 'complete'), true);
  assert.equal(JSON.stringify(calls).includes('privateData'), false);
  assert.equal(r.last().entries.at(-1).kind, 'summary');
  r.progress.finish();
});

test('ongoing work is available to the narrator without claiming it has finished', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const r = recorder();
  let facts;
  r.progress.enableNarrator(async value => { facts = value; return 'I’m looking up wedding customs to add context to your question about Cana.'; }, 'Explain Cana');
  r.progress.toolStart(web, 'Searching the web');
  t.mock.timers.tick(200);
  await flushPromises();
  assert.equal(facts.activities[0].state, 'running');
  assert.equal(facts.activities[0].detail, 'Cana wedding');
  assert.equal(r.last().phase, 'tool');
  assert.match(r.last().label, /wedding customs/);
  r.progress.finish();
});

test('late narrator responses cannot replace newer tools, native summaries, answers or completion', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const change of [
    p => p.toolStart(passage, 'Opening the passage'),
    p => p.summary('native', 'Considering the wedding sign in John 2.', true),
    p => p.answer(),
    p => p.finish(),
  ]) {
    const r = recorder();
    let resolve, signal;
    r.progress.enableNarrator((_facts, s) => { signal = s; return new Promise(done => { resolve = done; }); }, 'Cana');
    t.mock.timers.tick(200);
    await flushPromises();
    change(r.progress);
    const current = structuredClone(r.last());
    assert.equal(signal.aborted, true);
    resolve('This stale sentence must never reach the user.');
    await flushPromises();
    assert.deepEqual(r.last(), current);
    r.progress.finish();
  }
});

test('narrator outages and timeouts retain factual progress and never delay completion', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const mode of ['reject', 'timeout']) {
    const r = recorder();
    let signal, resolve;
    r.progress.enableNarrator((_facts, s) => {
      signal = s;
      if (mode === 'reject') return Promise.reject(new Error('Provider unavailable'));
      return new Promise(done => { resolve = done; });
    }, 'Cana');
    t.mock.timers.tick(200);
    await flushPromises();
    t.mock.timers.tick(4000);
    if (mode === 'timeout') {
      assert.equal(signal.aborted, true);
      resolve('Too late.');
      await flushPromises();
    }
    assert.equal(r.last().label, 'Preparing your answer');
    r.progress.answer();
    r.progress.finish();
    assert.equal(r.last().state, 'complete');
    assert.equal(r.last().entries.length, 0);
  }
});

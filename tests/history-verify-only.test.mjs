import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gateAnswer } from '../src/lib/ai/answer-gate.ts';
import { createVerifyOnlyAdapter } from '../src/lib/ai/history/verify-only.mjs';
import { HistoryError } from '../src/lib/ai/history/service.mjs';
const blocks = [{ id: 'a', text: 'Original saved prose.' }];
const checked = block => ({ ...block, ok: true, issues: [], references: [] });
test('default fresh gate retains its existing one-repair behavior', async () => { let repairs = 0; const result = await gateAnswer(blocks, { fallback: 'Withheld', check: async (b) => checked(b), review: async (b) => ({ pass: b[0].text === 'Corrected', issues: [], requiredReferences: [] }), repair: async () => { repairs++; return [{ id: 'a', text: 'Corrected' }]; } }); assert.equal(result.verified, true); assert.equal(result.repaired, true); assert.equal(repairs, 1); });
test('allowRepair:false rejects once without calling repair or rewriting original blocks', async () => { let repairs = 0, reviews = 0; const result = await gateAnswer(blocks, { allowRepair: false, fallback: 'Withheld', check: async (b) => checked(b), review: async () => { reviews++; return { pass: false, issues: ['Unsupported'], requiredReferences: [] }; }, repair: async () => { repairs++; return blocks; } }); assert.equal(result.verified, false); assert.equal(result.repaired, false); assert.equal(repairs, 0); assert.equal(reviews, 1); assert.equal(blocks[0].text, 'Original saved prose.'); });
test('internal onError captures quota/auth faults while default output remains content-free', async () => { const error = new Error('PRIVATE RAW EXCEPTION'); let captured; const result = await gateAnswer(blocks, { allowRepair: false, onError: e => captured = e, fallback: 'Withheld', check: async () => { throw error; }, review: async () => { throw Error('unreachable'); }, repair: async () => { throw Error('unreachable'); } }); assert.equal(captured, error); assert.deepEqual(result.issueCodes, ['verification_unavailable']); assert.equal(JSON.stringify(result).includes('PRIVATE'), false); });
function adapterFixture({ check, generate, authorize } = {}) {
    let resolutions = 0, meterFactories = 0, calls = 0, auths = 0;
    const policy = { reviewerModelId: 'approved-model', supportedTranslations: ['KJV', 'BSB', 'ASV', 'RV1909', 'LUT1912'] };
    const input = { ownerId: 'u', policy, translation: 'KJV', question: 'Explain Scripture.', context: 'Complete bounded context', blocks, manifest: { canonicalSources: [] }, signal: new AbortController().signal, allowRepair: false, authorizeInference: async () => { auths++; if (authorize)
            await authorize(); } };
    const adapter = createVerifyOnlyAdapter({ houseChatModel: async () => { resolutions++; return { definition: { id: 'approved-model', provider: 'openai', pricing: { input: 1, output: 2 } } }; }, resolveVerificationModel: async () => { meterFactories++; return {}; }, providerOptionsForReview: () => ({ openai: { reasoningEffort: 'high' } }), verifyScriptureDraft: check ?? (async (text) => ({ ok: true, text, references: [] })), verifyGeneratedAnswer: async (b, options) => {
            assert.equal(options.allowRepair, false);
            assert.equal(options.historyReview, true);
            assert.equal(options.abortSignal, input.signal);
            if (generate)
                return generate(b, options, () => calls++);
            await options.beforeReview();
            calls++;
            return { verified: true, repaired: false, blocks: b, issueCodes: [] };
        }, isQuotaError: e => e.name === 'FakeQuota' });
    return { input, adapter, counts: () => ({ resolutions, meterFactories, calls, auths }) };
}
test('bridge pins actual model definition and utility factory then authorizes immediately before one review', async () => { const f = adapterFixture(); const r = await f.adapter(f.input); assert.equal(r.verified, true); assert.equal(r.reviewerModelId, 'approved-model'); assert.deepEqual(f.counts(), { resolutions: 1, meterFactories: 1, calls: 1, auths: 1 }); });
test('canonical rewrite/invalid text is refused before any model factory or quota action', async () => { for (const kind of ['rewrite', 'invalid']) {
    const f = adapterFixture({ check: async (text) => ({ ok: kind !== 'invalid', text: kind === 'rewrite' ? 'Expanded canonical text' : text, references: [] }) });
    const r = await f.adapter(f.input);
    assert.equal(r.verified, false);
    assert.equal(r.canonicalPassed, false);
    assert.equal(f.counts().resolutions, 0);
    assert.equal(f.counts().calls, 0);
} });
test('complete context and canonical evidence caps refuse rather than slice', async () => { for (const kind of ['question', 'context', 'verses']) {
    const f = adapterFixture({ check: async (text) => ({ ok: true, text, references: [{ verses: Array(121).fill({ text: 'Canonical' }) }] }) });
    if (kind !== 'verses')
        f.input[kind] = 'x'.repeat(kind==='context'?128001:16001);
    await assert.rejects(f.adapter(f.input), e => e.code === 'context_limit');
    assert.equal(f.counts().calls, 0);
    assert.equal(f.counts().meterFactories, 0);
} });
test('withdrawn consent at beforeReview cannot generate or reserve a provider call', async () => { const f = adapterFixture({ authorize: async () => { throw new HistoryError('consent_required', 412); } }); await assert.rejects(f.adapter(f.input), e => e.code === 'consent_required'); assert.equal(f.counts().calls, 0); assert.equal(f.counts().auths, 1); });
test('gate-captured background quota retains reset date without leaking raw message', async () => { const resetAt = new Date('2026-10-30T00:00:00Z'); const f = adapterFixture({ generate: async (b, o) => { const error = Object.assign(new Error('DO NOT EXPOSE'), { name: 'FakeQuota', resetAt }); o.onError(error); return { verified: false, repaired: false, blocks: b, issueCodes: ['verification_unavailable'] }; } }); await assert.rejects(f.adapter(f.input), e => e.code === 'quota_exhausted' && e.retryAfter === resetAt && e.message === 'quota_exhausted'); });
test('background/model failures and any accidental repair remain fail-closed', async () => { for (const kind of ['unavailable', 'repaired']) {
    const f = adapterFixture({ generate: async (b, o) => kind === 'unavailable' ? { verified: false, repaired: false, blocks: b, issueCodes: ['verification_unavailable'] } : { verified: true, repaired: true, blocks: b, issueCodes: [] } });
    await assert.rejects(f.adapter(f.input), e => e.code === (kind === 'unavailable' ? 'verification_unavailable' : 'review_changed_text'));
} });
test('history verifier composes complete context with saved foundation and verify-only hooks', () => {
 const source = readFileSync(new URL('../src/lib/ai/verified-generation.ts', import.meta.url), 'utf8');
 for (const term of ['import { doctrinalFoundation } from "@/utils/systemPrompt"', 'allowRepair: options.allowRepair', 'allContextVerses.length > 120', 'await options.beforeReview?.();', 'Never reword, repair, replace or infer success']) assert.ok(source.includes(term));
});

for (const kind of ['changed-source', 'wrong-edition', 'unavailable-source', 'unversioned-source']) test('card canonical source fails before any model or meter: '+kind, async () => {
 const f = adapterFixture({check: async text => ({ok: kind !== 'unavailable-source', text, references: [{canonicalText: 'Exact KJV source.', verses: [{}]}]})});
 f.input.manifest.canonicalSources = [{reference: 'John 3:16', translation: kind === 'unversioned-source' ? 'NKJV' : 'KJV', text: kind === 'wrong-edition' ? 'Words from another edition.' : kind === 'changed-source' ? 'Changed source.' : 'Exact KJV source.'}];
 if(kind === 'unversioned-source') await assert.rejects(f.adapter(f.input), e=>e.code==='unversioned_corpus');
 else {const result=await f.adapter(f.input); assert.equal(result.verified,false); assert.equal(result.canonicalPassed,false);}
 assert.equal(f.counts().resolutions,0);assert.equal(f.counts().meterFactories,0);assert.equal(f.counts().calls,0);
});

test('an exact card source uses its own edition and retains complete canonical bytes', async () => {
 const seen=[];
 const f = adapterFixture({check: async (text,options) => {seen.push({text,translation:options.translation});return {ok:true,text,references:text.startsWith('[[SCRIPTURE:')?[{canonicalText:'Exact German source.',verses:[{}]}]:[]};}});
 f.input.manifest.canonicalSources=[{reference:'John 3:16',translation:'LUT1912',text:'Exact German source.'}];
 assert.equal((await f.adapter(f.input)).verified,true);
 assert.deepEqual(seen[0],{text:'[[SCRIPTURE:John 3:16]]',translation:'LUT1912'});
 assert.equal(f.counts().calls,1);
});

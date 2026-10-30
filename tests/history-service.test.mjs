import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadHistoryModule, sourceRoot } from './history-loader.mjs';
import { CORE_VERSION, FIXED_NOTICES } from '../src/lib/ai/history/projection.mjs';
import { createHistoryService, HistoryError } from '../src/lib/ai/history/service.mjs';
import { FakeRepository } from './history-fake-repository.mjs';

const {historyRenderer:renderer}=await loadHistoryModule('src/lib/ai/history/renderer.ts');
const locator = { surface: 'chat', parentId: 'c', messageId: 'a' };
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
function setup({ verify, verifyMs } = {}) {
    const db = new FakeRepository();
    db.addUser('u');
    db.addUser('other');
    db.addParent('chat', 'c', 'u');
    db.put('chat', 'c', { id: 'q', role: 'user', content: 'Explain John 3:16.', metadata: null, conversationId: 'c', createdAt: '2026-10-29T00:00:01.000Z' });
    db.put('chat', 'c', { id: 'a', role: 'assistant', content: 'God loves the world.', metadata: { translation: 'KJV', parts: [{ type: 'text', text: 'God loves the world.' }] }, conversationId: 'c', createdAt: '2026-10-29T00:00:02.000Z', feedback: null, feedbackTags: [] });
    let clock = new Date('2026-10-29T10:00:00.000Z'), calls = 0, reservations = 0, quota = false;
    db.clock = () => new Date(clock);
    const policy = { supportedTranslations:['KJV','BSB','ASV','RV1909','LUT1912'], core: { contractVersion: 1, projectorVersion: CORE_VERSION, rendererDigest: renderer.digest, checkerVersion: 'server-candidate-v1', corpusDigest: 'a'.repeat(64), foundationDigest: 'd94fb1749d77ce12b4fa429944bc8eefed974f227a51c0ec2226e3f38cfaa237', fixedNoticesVersion: 1 }, reviewerModelId: 'approved-house-reviewer', contextVersion: 1, meter: 'background-utility', dailyCaps: { free: 20, pro: 100 } };
    const service = createHistoryService({ repository: db, renderer, loadCurrentPolicy: async () => structuredClone(policy), now: () => new Date(clock), verifyMs, verifyOnly: async (input) => {
            assert.equal(db.depth.get('u') ?? 0, 0, 'provider must run outside DB transaction');
            reservations++;
            if (quota)
                throw new HistoryError('quota_exhausted', 429, new Date(clock.getTime() + 3600000));
            calls++;
            assert.equal(input.allowRepair, false);
            if (verify)
                return verify(input, { db, policy, advance: ms => clock = new Date(clock.getTime() + ms), calls });
            return { verified: true, canonicalPassed: true, semanticPassed: true, repaired: false, blocks: structuredClone(input.blocks), reviewerModelId: input.policy.reviewerModelId };
        } });
    const pre = async (loc = locator) => (await service.get('u', loc)).body.sourceDigest;
    const run = async (loc = locator) => service.recheck('u', loc, await pre(loc));
    return { db, service, policy, pre, run, advance: ms => clock = new Date(clock.getTime() + ms), setQuota: value => quota = value, counts: () => ({ calls, reservations, chatReservations: 0 }) };
}
const pass = input => ({ verified: true, canonicalPassed: true, semanticPassed: true, repaired: false, blocks: structuredClone(input.blocks), reviewerModelId: input.policy.reviewerModelId });
test('provider-free GET withholds exact raw parts; one review then immutable cache read', async () => {
    const f = setup(), original = structuredClone(f.db.messages);
    const initial = await f.service.get('u', locator);
    assert.equal(initial.body.state, 'withheld');
    assert.equal(JSON.stringify(initial).includes('God loves'), false);
    assert.deepEqual(f.counts(), { calls: 0, reservations: 0, chatReservations: 0 });
    assert.equal((await f.run()).body.state, 'verified');
    assert.equal((await f.service.get('u', locator)).body.row.content, 'God loves the world.');
    await f.run();
    assert.deepEqual(f.counts(), { calls: 1, reservations: 1, chatReservations: 0 });
    assert.deepEqual(f.db.messages, original);
});
test('ownership scoped on main and note paths; no sidecar/provider on forged source', async () => {
    const f = setup();
    assert.equal((await f.service.get('other', locator)).status, 404);
    assert.equal((await f.service.recheck('other', locator, 'a'.repeat(64))).status, 404);
    assert.equal((await f.service.get('u', { ...locator, parentId: 'another' })).status, 404);
    assert.equal(f.db.reviews.size, 0);
    assert.equal(f.counts().calls, 0);
});
test('consent off blocks fresh check without reservation; verified cache still readable', async () => {
    const f = setup();
    f.db.users.get('u').consent = false;
    assert.equal((await f.run()).status, 412);
    assert.equal(f.db.reviews.size, 0);
    assert.equal(f.counts().reservations, 0);
    f.db.users.get('u').consent = true;
    await f.run();
    f.db.users.get('u').consent = false;
    assert.equal((await f.service.get('u', locator)).body.state, 'verified');
    assert.equal((await f.run()).status, 200);
    assert.equal(f.counts().calls, 1);
});
test('same-answer concurrent checks spend once and return pending without text', async () => {
    const entered = deferred(), finish = deferred();
    const f = setup({ verify: async (input) => { entered.resolve(); await finish.promise; return pass(input); } });
    const source = await f.pre();
    const first = f.service.recheck('u', locator, source);
    await entered.promise;
    const second = await f.service.recheck('u', locator, source);
    assert.equal(second.status, 202);
    assert.equal(JSON.stringify(second).includes('God loves'), false);
    assert.equal(f.db.reviews.size, 1);
    finish.resolve();
    assert.equal((await first).status, 200);
    assert.equal(f.counts().calls, 1);
});
test('one account active lease spans different answers; no duplicate model reservation', async () => {
    const entered = deferred(), finish = deferred();
    const f = setup({ verify: async (input) => { entered.resolve(); await finish.promise; return pass(input); } });
    f.db.put('chat', 'c', { ...structuredClone(f.db.messages.get('a').row), id: 'b', createdAt: '2026-10-29T00:00:03.000Z' });
    const first = f.run();
    await entered.promise;
    const other = await f.run({ ...locator, messageId: 'b' });
    assert.equal(other.body.code, 'account_busy');
    assert.equal(f.counts().reservations, 1);
    finish.resolve();
    await first;
});
test('source expected digest mismatch does not create a lease', async () => { const f = setup(); assert.equal((await f.service.recheck('u', locator, '0'.repeat(64))).status, 409); assert.equal(f.db.reviews.size, 0); assert.equal(f.counts().calls, 0); });
test('same-ID source edit during checking cannot finalize or return stale display; old target retained', async () => {
    const f = setup({ verify: async (input, { db }) => { const row = db.messages.get('a').row; row.content = 'Changed source.'; row.metadata.parts[0].text = row.content; return pass(input); } });
    const answer = await f.run();
    assert.equal(answer.status, 409);
    assert.equal(answer.body.code, 'source_changed');
    assert.equal('row' in answer.body, false);
    assert.equal([...f.db.reviews.values()][0].sourceSnapshot.row.content, 'God loves the world.');
    assert.equal((await f.service.get('u', locator)).body.state, 'withheld');
});
test('earlier context deletion stales certification without retaining deleted prefix text', async () => {
    const secret = 'PRIVATE PREFIX MUST NOT BE ARCHIVED';
    const f = setup({ verify: async (input, { db }) => { db.deleteMessage('q'); return pass(input); } });
    f.db.messages.get('q').row.content = secret;
    const response = await f.run();
    assert.equal(response.status, 409);
    assert.equal(response.body.code, 'context_changed');
    assert.equal(JSON.stringify([...f.db.reviews.values()]).includes(secret), false);
    const download = await f.service.download('u', locator);
    assert.equal(download.body.includes(secret), false);
});
test('source deletion cascades sidecar and late review cannot resurrect it', async () => { const f = setup({ verify: async (input, { db }) => { db.deleteMessage('a'); return pass(input); } }); assert.equal((await f.run()).status, 409); assert.equal(f.db.reviews.size, 0); assert.equal((await f.service.get('u', locator)).status, 404); assert.equal((await f.service.download('u', locator)).status, 404); });
test('normal parent/account deletion cascades all source reviews', async () => { for (const kind of ['parent', 'user']) {
    const f = setup();
    await f.run();
    if (kind === 'parent')
        f.db.deleteParent('chat', 'c');
    else
        f.db.deleteUser('u');
    assert.equal(f.db.reviews.size, 0);
    assert.equal((await f.service.download('u', locator)).status, 404);
} });
test('policy change and consent withdrawal during review cannot certify', async () => { for (const change of ['policy', 'consent']) {
    const f = setup({ verify: async (input, { db, policy }) => { if (change === 'policy')
            policy.contextVersion++;
        else
            db.users.get('u').consent = false; return pass(input); } });
    const r = await f.run();
    assert.equal(r.body.code, change === 'policy' ? 'policy_changed' : 'consent_required');
    assert.equal([...f.db.reviews.values()][0].state, 'withheld');
} });
test('expired lease cannot finalize; late old token cannot overwrite replacement decision', async () => {
    const entered = deferred(), finish = deferred();
    const f = setup({ verify: async (input, { calls }) => { if (calls === 1) {
            entered.resolve();
            await finish.promise;
        } return pass(input); } });
    const first = f.run();
    await entered.promise;
    f.advance(91000);
    assert.equal((await f.run()).status, 200);
    finish.resolve();
    assert.equal((await first).body.code, 'stale_lease');
    assert.equal([...f.db.reviews.values()][0].state, 'verified');
    assert.equal([...f.db.reviews.values()][0].attemptCount, 2);
});
test('quota exhaustion uses one background attempt, never chat allowance, with content-free retry state', async () => { const f = setup(); f.setQuota(true); const r = await f.run(); assert.equal(r.status, 429); assert.equal(r.body.code, 'quota_exhausted'); assert.deepEqual(f.counts(), { calls: 0, reservations: 1, chatReservations: 0 }); assert.equal(JSON.stringify(r).includes('God loves'), false); assert.equal((await f.run()).status, 429); assert.equal(f.counts().reservations, 1); f.advance(3600001); f.setQuota(false); assert.equal((await f.run()).status, 200); });
test('timeout aborts work and leaves no verified certificate', async () => { let aborted = false; const f = setup({ verifyMs: 5, verify: async (input) => { input.signal.addEventListener('abort', () => aborted = true); return new Promise(() => { }); } }); const r = await f.run(); assert.equal(r.body.code, 'verification_timeout'); assert.equal(aborted, true); assert.equal([...f.db.reviews.values()][0].state, 'withheld'); });
test('no repair, changed block/model, canonical or semantic failure may pass', async () => {
    for (const variant of ['repaired', 'text', 'model', 'canonical', 'semantic']) {
        const f = setup({ verify: async (input) => { const r = pass(input); if (variant === 'repaired')
                r.repaired = true; if (variant === 'text')
                r.blocks[0].text += ' rewritten'; if (variant === 'model')
                r.reviewerModelId = 'wrong'; if (variant === 'canonical')
                r.canonicalPassed = false; if (variant === 'semantic')
                r.semanticPassed = false; return r; } });
        assert.equal((await f.run()).body.state, 'withheld', variant);
        assert.equal((await f.service.get('u', locator)).body.state, 'withheld');
    }
});
test('note unknown translation is explicitly withheld, never current preference fallback', async () => { const f = setup(); f.db.addParent('note', 'n', 'u'); const row = structuredClone(f.db.messages.get('a').row); row.id = 'na'; row.noteId = 'n'; delete row.conversationId; delete row.metadata.translation; f.db.put('note', 'n', { id: 'nq', role: 'user', content: 'Explain grace', metadata: null, createdAt: '2026-10-29T00:00:01.000Z' }); f.db.put('note', 'n', row); const r = await f.run({ surface: 'note', parentId: 'n', messageId: 'na' }); assert.equal(r.body.code, 'unknown_translation'); assert.equal(f.counts().calls, 0); assert.equal((await f.service.get('other', { surface: 'note', parentId: 'n', messageId: 'na' })).status, 404); f.db.deleteParent('note', 'n'); assert.equal(f.db.reviews.size, 0); });
test('action receipt without durable owned proof is withheld without inference', async () => { const f = setup(); f.db.messages.get('a').row.metadata.parts.push({ type: 'tool-addToNote', toolCallId: 'save', state: 'output-available', output: { noteId: 'n', noteTitle: 'Study', created: true, appendedHtml: 'Never replay' } }); assert.equal((await f.run()).body.code, 'action_proof_missing'); assert.equal(f.counts().calls, 0); assert.equal(JSON.stringify((await f.service.get('u', locator)).body).includes('Never replay'), false); });
test('durable proof is bound, never replayed, and rechecked before finalization', async () => { const f = setup({ verify: async (input, { db }) => { db.proofs.delete('a'); return pass(input); } }); f.db.messages.get('a').row.metadata.parts.push({ type: 'tool-addToNote', toolCallId: 'save', state: 'output-available', output: { noteId: 'n', noteTitle: 'Study', created: true, appendedHtml: 'Never replay' } }); f.db.proofs.set('a', { complete: true, manifest: [{ operationId: 'server-owned-operation', digest: 'b'.repeat(64) }] }); const r = await f.run(); assert.equal(r.status, 409); assert.equal([...f.db.reviews.values()][0].state, 'withheld'); });
test('fixed notices stay distinct; generated legacy/progress extras cannot use notice status', async () => {
    const f = setup();
    const row = f.db.messages.get('a').row;
    row.content = FIXED_NOTICES.unavailableEnglish;
    row.metadata.parts[0].text = row.content;
    assert.equal((await f.run()).body.state, 'notice');
    assert.equal((await f.service.get('u', locator)).body.state, 'notice');
    assert.equal(f.counts().calls, 0);
    row.metadata.followUps = ['Unreviewed claim'];
    assert.equal((await f.run()).body.code, 'notice_has_unreviewed_extras');
    const current = await f.service.get('u', locator);
    assert.equal(current.body.state, 'withheld');
    assert.equal(JSON.stringify(current).includes('Unreviewed claim'), false);
    delete row.metadata.followUps;
    row.metadata.parts.push({type:'data-progress',data:{version:1,runId:'r',sequence:1,elapsedMs:1,lastActivityMs:1,state:'complete',phase:'answering',label:'Unreviewed progress claim',entries:[]}});
    assert.equal((await f.run()).body.code,'notice_has_unreviewed_extras');
    assert.equal(f.counts().calls,0);
});
test('complete bounded context, ambiguous ordering and attachments block instead of clipping', async () => {
    for (const kind of ['size', 'order', 'attachment', 'rows']) {
        const f = setup();
        if (kind === 'size')
            f.db.messages.get('q').row.content = 'x'.repeat(16001);
        if (kind === 'order')
            f.db.messages.get('q').row.createdAt = f.db.messages.get('a').row.createdAt;
        if (kind === 'attachment')
            f.db.messages.get('q').row.hasAttachments = true;
        if (kind === 'rows')
            for (let i = 0; i < 81; i++)
                f.db.put('chat', 'c', { id: 'extra-' + i, role: 'user', content: 'Earlier', metadata: null, createdAt: '2026-10-28T00:' + String(i % 60).padStart(2, '0') + ':00.000Z' });
        const r = await f.run();
        assert.equal(r.body.state, 'withheld', kind);
        assert.equal(f.counts().calls, 0);
    }
});
test('stored display or sourceSnapshot corruption cannot release content', async () => { for (const kind of ['display', 'source']) {
    const f = setup();
    await f.run();
    const record = [...f.db.reviews.values()][0];
    if (kind === 'display')
        record.sanitizedDisplay.content = 'Forged visible text';
    else
        record.sourceSnapshot.row.content = 'Forged snapshot';
    const r = await f.service.get('u', locator);
    assert.equal(r.body.state, 'withheld');
    assert.equal(JSON.stringify(r).includes('Forged'), false);
} });
test('original download is authenticated attachment JSON, not unchecked inline output', async () => { const f = setup(); await f.run(); const r = await f.service.download('u', locator); assert.equal(r.status, 200); assert.match(r.headers['content-disposition'], /^attachment;/); assert.equal(r.headers['cache-control'], 'private, no-store'); assert.equal(JSON.parse(r.body).current.content, 'God loves the world.'); assert.equal((await f.service.download('other', locator)).status, 404); });
test('migration is additive with exact-source/ownership/cascade/immutable/CAS constraints', () => { const sql = readFileSync(new URL('../prisma/migrations/20261029000100_ai_answer_review/migration.sql', import.meta.url), 'utf8'); assert.equal((sql.match(/ON DELETE CASCADE/g) || []).length, 3); for (const term of ['exactly_one_source', 'one_pending_owner', 'owner_binding_key', 'guard_payload', 'source ownership mismatch'])
    assert.ok(sql.includes(term)); assert.equal(/ALTER TABLE "(?:Message|NoteAIMessage)"|UPDATE "(?:Message|NoteAIMessage)"|DELETE FROM "(?:Message|NoteAIMessage)"/.test(sql), false); });
test('original version metadata paginates; each selected snapshot remains owner-downloadable', async () => { const f = setup(); await f.run(); const seed = [...f.db.reviews.values()][0]; for (let i = 0; i < 24; i++)
    f.db.reviews.set('old-' + i, { ...structuredClone(seed), id: 'old-' + i, createdAt: new Date(1000 + i), sourceDigest: String(i).padStart(64, '0') }); const first = await f.service.versions('u', locator); assert.equal(first.body.versions.length, 20); assert.ok(first.body.next); const next = await f.service.versions('u', locator, first.body.next); assert.equal(next.body.versions.length, 5); assert.equal(next.body.next, null); assert.equal(JSON.stringify(first).includes('God loves'), false); assert.equal((await f.service.download('u', locator)).status, 413); assert.equal((await f.service.download('u', locator, next.body.versions[0].reviewId)).status, 200); assert.equal((await f.service.versions('other', locator)).status, 404); assert.equal((await f.service.versions('u', locator, 'foreign-cursor')).status, 404); });
test('user ratings and bookkeeping are separate from the immutable AI source envelope', async () => { const f = setup({ verify: async (input, { db }) => { db.messages.get('a').row.feedbackReason = 'Changed user feedback'; return pass(input); } }); assert.equal((await f.run()).status, 200); const record = [...f.db.reviews.values()][0]; assert.equal('feedbackTags' in record.sourceSnapshot.row, false); assert.equal('feedbackReason' in record.sourceSnapshot.row, false); assert.equal(record.sourceSnapshot.row.content, 'God loves the world.'); });
test('server rechecks lease/consent/source immediately at reviewer callback', async () => { const f = setup({ verify: async (input, { db }) => { db.users.get('u').consent = false; await assert.rejects(input.authorizeInference(), e => e.code === 'consent_required'); return pass(input); } }); assert.equal((await f.run()).body.code, 'consent_required'); });

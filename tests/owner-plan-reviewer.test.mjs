import assert from 'node:assert/strict';
import test from 'node:test';
import { HOUSE_CHAT_MODEL_ID, resolveDefinition, resolveReviewerDefinition, sureWordPlanDefinition } from '../src/lib/ai/models.ts';
import { reviewerIdentity } from '../src/lib/ai/history/prepared-request.mjs';
import { canonicalJSON } from '../src/lib/ai/history/projection.mjs';

// What validateFreshReviewer (runtime.server.ts) checks before every fresh answer.
const validates = definition => {
  const current = resolveDefinition(definition.id);
  return Boolean(current && canonicalJSON(reviewerIdentity(current)) === canonicalJSON(reviewerIdentity(definition)));
};

test('owner SureWord AI picks get a priced reviewer that passes the fresh check (2026-11-05 instant-withhold bug)', () => {
  for (const plan of ['pro', 'free']) {
    const display = sureWordPlanDefinition(plan);
    // The display row is what the owner path hands the route; reviewing with it threw.
    assert.throws(() => reviewerIdentity(display), /priced reviewer/);
    const reviewer = resolveReviewerDefinition(display.id);
    assert.equal(reviewer?.id, HOUSE_CHAT_MODEL_ID);
    assert.equal(validates(reviewer), true);
  }
});

test('registered models review as themselves', () => {
  assert.equal(resolveReviewerDefinition(HOUSE_CHAT_MODEL_ID)?.id, HOUSE_CHAT_MODEL_ID);
  assert.equal(resolveReviewerDefinition('sureword/unknown'), resolveDefinition('sureword/unknown'));
});

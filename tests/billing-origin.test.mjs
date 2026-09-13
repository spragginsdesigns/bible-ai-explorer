import assert from 'node:assert/strict';
import test from 'node:test';
import { rejectCrossSiteMutation } from '../src/lib/billing/request.ts';

test('billing writes reject cross-site and opaque browser origins', () => {
  for (const origin of ['https://attacker.example', 'null', 'https://sureword.app.attacker.example']) {
    assert.equal(rejectCrossSiteMutation(new Request('https://sureword.app/api/billing/checkout', { method: 'POST', headers: { origin } })).status, 403);
  }
});
test('same-origin and native callers proceed to normal authentication', () => {
  assert.equal(rejectCrossSiteMutation(new Request('https://sureword.app/api/billing/checkout', { headers: { origin: 'https://sureword.app' } })), null);
  assert.equal(rejectCrossSiteMutation(new Request('https://sureword.app/api/billing/status')), null);
});

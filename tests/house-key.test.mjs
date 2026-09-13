import assert from 'node:assert/strict';
import test from 'node:test';
import { houseKeyFor } from '../src/lib/ai/house-key.ts';

test('included AI prefers its dedicated credential', () => {
	assert.equal(houseKeyFor({ OPENAI_FREE_TIER_API_KEY: ' dedicated ', OPENAI_API_KEY: 'owner' }), 'dedicated');
});
test('existing deployments retain their configured service until the dedicated key is installed', () => {
	assert.equal(houseKeyFor({ OPENAI_API_KEY: ' existing ' }), 'existing');
	assert.equal(houseKeyFor({ OPENAI_FREE_TIER_API_KEY: ' ', OPENAI_API_KEY: 'existing' }), 'existing');
	assert.equal(houseKeyFor({}), undefined);
});

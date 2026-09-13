import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shouldRecoverChatStream } from '../src/lib/chat/streamRecovery.ts';

test('explicit server failures never enter the five-minute collection loop', () => {
	for (const error of [new Error('[internal] An error occurred.'), new Error('[provider_error] Connection timed out at the provider.'), new Error('{"code":"rate_limited","error":"Slow down"}'), {status:500,message:'Failed to fetch'}, new Error('Failed to fetch the chat response.')]) {
		assert.equal(shouldRecoverChatStream(error), false);
	}
});
test('a disconnected client can still recover the answer being generated', () => {
	for (const error of [new TypeError('Network request failed'), new TypeError('Failed to fetch'), new Error('Load failed'), new Error('terminated'), new Error('Software caused connection abort'), new SyntaxError('Unexpected end of JSON input'), {isTimeout:true}]) {
		assert.equal(shouldRecoverChatStream(error), true);
	}
	assert.equal(shouldRecoverChatStream({name:'AbortError',message:'Aborted'}), false);
});
test('Android and web use the same recovery policy', () => {
	assert.equal(readFileSync('src/lib/chat/streamRecovery.ts','utf8'), readFileSync('mobile/src/lib/streamRecovery.ts','utf8'));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { activeSubscription, quotaDecision, utcDayWindow, calendarMonthWindow, PRO_MONTHLY_PRICE_CENTS } from '../src/lib/billing/plans.ts';

test('Pro is $15 and free permits exactly ten daily messages', () => {
	assert.equal(PRO_MONTHLY_PRICE_CENTS, 1500);
	assert.equal(quotaDecision({ pro: false, daily: 9, monthly: 900 }).allowed, true);
	assert.equal(quotaDecision({ pro: false, daily: 10, monthly: 10 }).allowed, false);
});
test('Pro must satisfy both independent windows', () => {
	assert.equal(quotaDecision({ pro: true, daily: 49, monthly: 599 }).allowed, true);
	assert.equal(quotaDecision({ pro: true, daily: 50, monthly: 599 }).allowed, false);
	assert.equal(quotaDecision({ pro: true, daily: 0, monthly: 600 }).allowed, false);
});
test('UTC windows cross year and leap-day boundaries exactly', () => {
	assert.equal(utcDayWindow(new Date('2028-02-29T23:59:59Z')).end.toISOString(), '2028-03-01T00:00:00.000Z');
	assert.equal(calendarMonthWindow(new Date('2026-12-31T23:59:59Z')).end.toISOString(), '2027-01-01T00:00:00.000Z');
});
test('status and paid-through time are both required', () => {
	const now = new Date('2026-09-13T00:00:00Z');
	for (const status of ['incomplete', 'past_due', 'canceled', 'unpaid', 'paused']) {
		assert.equal(activeSubscription({ status, periodEnd: new Date('2026-10-13') }, now), false);
	}
	assert.equal(activeSubscription({ status: 'active', periodEnd: now }, now), false);
	assert.equal(activeSubscription({ status: 'active', periodEnd: new Date('2026-10-13') }, now), true);
});

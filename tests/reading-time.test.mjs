import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveReadingTime, readingTimezone } from '../src/lib/reading-time.ts';

test('just read uses the server receipt instant and device calendar date', () => {
  assert.deepEqual(resolveReadingTime(undefined, new Date('2026-09-13T02:30:00Z'), 'America/Los_Angeles'), {
    occurredAt: '2026-09-13T02:30:00.000Z', localDate: '2026-09-12', precision: 'exact', timezone: 'America/Los_Angeles',
  });
});
test('earlier today and morning preserve uncertainty without inventing a clock time', () => {
  const now = new Date('2026-09-13T02:30:00Z');
  assert.deepEqual(resolveReadingTime({day:'today'}, now, 'America/Los_Angeles'), {
    localDate: '2026-09-12', precision:'day', timezone:'America/Los_Angeles',
  });
  assert.equal(resolveReadingTime({day:'today',period:'morning'}, now, 'America/Los_Angeles').precision,'morning');
  assert.equal(resolveReadingTime({period:'morning'}, now, 'America/Los_Angeles').occurredAt, undefined);
});
test('yesterday subtracts a local calendar day across both DST boundaries and year rollover', () => {
  for (const [instant, expected] of [
    ['2026-03-09T06:30:00Z','2026-03-07'],
    ['2026-11-02T07:30:00Z','2026-10-31'],
    ['2027-01-01T20:00:00Z','2026-12-31'],
  ]) assert.equal(resolveReadingTime({day:'yesterday'}, new Date(instant),'America/Los_Angeles').localDate, expected);
});
test('invalid/future dates and ambiguous exact clocks are rejected', () => {
  const now = new Date('2026-09-12T20:00:00Z');
  for (const input of [{day:'date',date:'2026-02-30'},{day:'date',date:'2026-12-01'},{exactTime:'2026-09-12T10:00:00'},{exactTime:'tomorrow'},{day:'now',period:'morning'}]) {
    assert.throws(() => resolveReadingTime(input, now, 'America/Los_Angeles'));
  }
  assert.equal(readingTimezone('not/a/timezone'),'UTC');
});
test('explicit offset disambiguates the repeated fall-back hour', () => {
  const now = new Date('2026-11-02T12:00:00Z');
  const first=resolveReadingTime({exactTime:'2026-11-01T01:30:00-07:00'},now,'America/Los_Angeles');
  const second=resolveReadingTime({exactTime:'2026-11-01T01:30:00-08:00'},now,'America/Los_Angeles');
  assert.equal(Date.parse(second.occurredAt)-Date.parse(first.occurredAt),3600000);
});

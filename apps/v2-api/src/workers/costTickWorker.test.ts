import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { computeBucketsForHost, type CostBucketWrite } from './costTickWorker.js';
import { SKU_CATALOG } from '../economics/skuCatalog.js';

const ex44 = SKU_CATALOG['EX44'];

describe('computeBucketsForHost — even hour bucketing', () => {
  test('host online for full hour, computes one bucket per closed hour', () => {
    const joinedAt = new Date('2026-04-27T10:00:00Z');
    const now = new Date('2026-04-27T13:30:00Z');  // 3.5 hours later
    const lastBookedAt = joinedAt;  // never billed yet
    const buckets = computeBucketsForHost({
      hostId: 'h1', sku: ex44, joinedAt, terminatedAt: null, lastBookedAt, now,
    });
    // Should bill three closed hours: 10-11, 11-12, 12-13. Hour 13-14 not yet closed.
    assert.equal(buckets.length, 3);
    assert.equal(buckets[0].tsFrom.toISOString(), '2026-04-27T10:00:00.000Z');
    assert.equal(buckets[0].tsTo.toISOString(), '2026-04-27T11:00:00.000Z');
    assert.equal(buckets[2].tsTo.toISOString(), '2026-04-27T13:00:00.000Z');
  });

  test('zero buckets if last booking was already at-or-after the latest closed hour', () => {
    const joinedAt = new Date('2026-04-27T10:00:00Z');
    const now = new Date('2026-04-27T13:30:00Z');
    const lastBookedAt = new Date('2026-04-27T13:00:00Z');  // already booked through 13:00
    const buckets = computeBucketsForHost({
      hostId: 'h1', sku: ex44, joinedAt, terminatedAt: null, lastBookedAt, now,
    });
    assert.equal(buckets.length, 0);
  });

  test('terminated host: stops billing at terminatedAt', () => {
    const joinedAt = new Date('2026-04-27T10:00:00Z');
    const terminatedAt = new Date('2026-04-27T11:30:00Z');
    const now = new Date('2026-04-27T15:00:00Z');
    const lastBookedAt = joinedAt;
    const buckets = computeBucketsForHost({
      hostId: 'h1', sku: ex44, joinedAt, terminatedAt, lastBookedAt, now,
    });
    // Bills the 10-11 closed hour, plus partial 11-11:30.
    assert.equal(buckets.length, 2);
    assert.equal(buckets[0].tsFrom.toISOString(), '2026-04-27T10:00:00.000Z');
    assert.equal(buckets[0].tsTo.toISOString(), '2026-04-27T11:00:00.000Z');
    assert.equal(buckets[1].tsFrom.toISOString(), '2026-04-27T11:00:00.000Z');
    assert.equal(buckets[1].tsTo.toISOString(), terminatedAt.toISOString());
  });

  test('cost is proportional to bucket length', () => {
    const joinedAt = new Date('2026-04-27T10:00:00Z');
    const now = new Date('2026-04-27T13:30:00Z');
    const buckets = computeBucketsForHost({
      hostId: 'h1', sku: ex44, joinedAt, terminatedAt: null, lastBookedAt: joinedAt, now,
    });
    // Each closed-hour bucket should have the same cost.
    const costs = buckets.map((b) => b.microEur);
    assert.equal(costs[0], costs[1]);
    assert.equal(costs[1], costs[2]);
    // Each one-hour bucket = €42.30/mo × (3600 / month-seconds) µEUR.
    const expected = 42.30 * 1e6 * (3600 / (30.4375 * 86400));
    assert.ok(Math.abs(costs[0] - expected) < 1);
  });
});

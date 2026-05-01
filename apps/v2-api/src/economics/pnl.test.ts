import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  rollupPnL,
  type CostEntry,
  type RevenueEntry,
} from './pnl.js';

const cost = (microEur: number, hostId = 'h1', tsFrom = '2026-04-01T00:00:00Z'): CostEntry => ({
  hostId,
  tsFrom: new Date(tsFrom),
  tsTo: new Date(new Date(tsFrom).getTime() + 3600 * 1000),
  microEur: BigInt(microEur),
});

const revenue = (microEur: number, customerId: string | null = 'c1', machineId = 'm1', tsFrom = '2026-04-01T00:00:00Z'): RevenueEntry => ({
  customerId,
  machineId,
  tsFrom: new Date(tsFrom),
  tsTo: new Date(new Date(tsFrom).getTime() + 3600 * 1000),
  microEur: BigInt(microEur),
});

describe('rollupPnL', () => {
  test('zero entries → all zero', () => {
    const r = rollupPnL([], []);
    assert.equal(r.total_cost_micro_eur, 0n);
    assert.equal(r.total_revenue_micro_eur, 0n);
    assert.equal(r.margin_micro_eur, 0n);
    assert.equal(r.margin_pct, null);
  });

  test('only cost, no revenue → negative margin', () => {
    const r = rollupPnL([cost(1_000_000)], []);
    assert.equal(r.total_cost_micro_eur, 1_000_000n);
    assert.equal(r.total_revenue_micro_eur, 0n);
    assert.equal(r.margin_micro_eur, -1_000_000n);
    assert.equal(r.margin_pct, null);  // undefined when revenue is zero
  });

  test('revenue 100 + cost 25 = 75% margin', () => {
    const r = rollupPnL([cost(25_000_000)], [revenue(100_000_000)]);
    assert.equal(r.total_cost_micro_eur, 25_000_000n);
    assert.equal(r.total_revenue_micro_eur, 100_000_000n);
    assert.equal(r.margin_micro_eur, 75_000_000n);
    assert.ok(r.margin_pct !== null && Math.abs(r.margin_pct - 75) < 0.01);
  });

  test('per-customer breakdown', () => {
    const r = rollupPnL(
      [cost(20_000_000)],
      [
        revenue(60_000_000, 'alice', 'm1'),
        revenue(40_000_000, 'bob', 'm2'),
        revenue(10_000_000, null, 'm3'), // no customer (e.g. internal)
      ],
    );
    assert.equal(r.by_customer.length, 3);
    const alice = r.by_customer.find((c) => c.customer_id === 'alice');
    const bob = r.by_customer.find((c) => c.customer_id === 'bob');
    assert.equal(alice?.revenue_micro_eur, 60_000_000n);
    assert.equal(bob?.revenue_micro_eur, 40_000_000n);
  });

  test('per-host cost breakdown', () => {
    const r = rollupPnL(
      [
        cost(10_000_000, 'h1'),
        cost(15_000_000, 'h2'),
        cost(5_000_000, 'h1'),  // second entry for h1
      ],
      [],
    );
    assert.equal(r.by_host.length, 2);
    const h1 = r.by_host.find((h) => h.host_id === 'h1');
    const h2 = r.by_host.find((h) => h.host_id === 'h2');
    assert.equal(h1?.cost_micro_eur, 15_000_000n);
    assert.equal(h2?.cost_micro_eur, 15_000_000n);
  });

  test('handles BigInt sums correctly (no overflow / no float drift)', () => {
    // Million entries of 1_000_000 micro-eur each = 1e12 µEUR = €1M total.
    // BigInt addition shouldn't drift.
    const entries = Array.from({ length: 1000 }, () => cost(1_000_000));
    const r = rollupPnL(entries, []);
    assert.equal(r.total_cost_micro_eur, 1_000_000_000n);
  });
});

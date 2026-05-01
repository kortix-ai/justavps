import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { computeHostCostEntry, type CostBucket } from './costLedger.js';
import { SKU_CATALOG } from './skuCatalog.js';

describe('computeHostCostEntry', () => {
  test('1 hour of EX44 = SKU price × (3600 / month-seconds) micro-eur', () => {
    const t0 = new Date('2026-04-27T12:00:00Z');
    const t1 = new Date(t0.getTime() + 3600 * 1000);
    const entry = computeHostCostEntry({
      hostId: 'h1', sku: SKU_CATALOG['EX44'], tsFrom: t0, tsTo: t1,
    });
    assert.equal(entry.hostId, 'h1');
    assert.equal(entry.sku, 'EX44');
    assert.equal(entry.tsFrom, t0);
    assert.equal(entry.tsTo, t1);
    const expected = (42.30 * 1e6) * (3600 / (30.4375 * 86400));
    assert.ok(Math.abs(entry.microEur - expected) < 1, `got ${entry.microEur} expected ${expected}`);
  });

  test('zero duration = zero cost', () => {
    const t = new Date('2026-04-27T12:00:00Z');
    const entry = computeHostCostEntry({ hostId: 'h', sku: SKU_CATALOG['EX44'], tsFrom: t, tsTo: t });
    assert.equal(entry.microEur, 0);
  });

  test('rejects negative duration', () => {
    const t0 = new Date('2026-04-27T12:00:00Z');
    const t1 = new Date(t0.getTime() - 1000);
    assert.throws(() => computeHostCostEntry({
      hostId: 'h', sku: SKU_CATALOG['EX44'], tsFrom: t0, tsTo: t1,
    }), /negative|backward/i);
  });

  test('full month = SKU monthly price exactly (within rounding)', () => {
    const t0 = new Date('2026-04-27T12:00:00Z');
    const t1 = new Date(t0.getTime() + 30.4375 * 86400 * 1000);
    const entry = computeHostCostEntry({ hostId: 'h', sku: SKU_CATALOG['EX44'], tsFrom: t0, tsTo: t1 });
    assert.ok(Math.abs(entry.microEur - 42.30 * 1e6) < 1);
  });

  test('cost scales linearly with time (12h = 2 × 6h)', () => {
    const t0 = new Date('2026-04-27T12:00:00Z');
    const t6h = new Date(t0.getTime() + 6 * 3600 * 1000);
    const t12h = new Date(t0.getTime() + 12 * 3600 * 1000);
    const six = computeHostCostEntry({ hostId: 'h', sku: SKU_CATALOG['EX44'], tsFrom: t0, tsTo: t6h });
    const twelve = computeHostCostEntry({ hostId: 'h', sku: SKU_CATALOG['EX44'], tsFrom: t0, tsTo: t12h });
    assert.ok(Math.abs(twelve.microEur - 2 * six.microEur) < 1);
  });
});

describe('CostBucket math', () => {
  test('a bigger SKU costs proportionally more for the same wall clock', async () => {
    const { computeHostCostEntry } = await import('./costLedger.js');
    const t0 = new Date('2026-04-27T12:00:00Z');
    const t1 = new Date(t0.getTime() + 3600 * 1000);
    const small = computeHostCostEntry({ hostId: 'h', sku: SKU_CATALOG['EX44'], tsFrom: t0, tsTo: t1 });
    const big = computeHostCostEntry({ hostId: 'h', sku: SKU_CATALOG['AX162-R'], tsFrom: t0, tsTo: t1 });
    const ratio = big.microEur / small.microEur;
    const expectedRatio = SKU_CATALOG['AX162-R'].monthlyEur / SKU_CATALOG['EX44'].monthlyEur;
    assert.ok(Math.abs(ratio - expectedRatio) < 0.001, `ratio ${ratio} vs ${expectedRatio}`);
  });
});

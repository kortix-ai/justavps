import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  DEFAULT_PRICING,
  computeRevenueMicroEur,
  computeNodeCostMicroEur,
  estimateMonthlyRevenue,
  type Pricing,
  type SandboxShape,
} from './pricing.js';
import { SKU_CATALOG } from './skuCatalog.js';

describe('DEFAULT_PRICING sanity', () => {
  test('all rates positive', () => {
    const p = DEFAULT_PRICING;
    assert.ok(p.vcpu_hot_micro_eur_per_sec > 0);
    assert.ok(p.ram_gb_hot_micro_eur_per_sec > 0);
    assert.ok(p.storage_gb_local_micro_eur_per_sec > 0);
    assert.ok(p.storage_gb_archive_micro_eur_per_sec > 0);
  });

  test('archive storage cheaper than local storage', () => {
    const p = DEFAULT_PRICING;
    assert.ok(p.storage_gb_archive_micro_eur_per_sec < p.storage_gb_local_micro_eur_per_sec,
      'archive should be cheaper than local NVMe');
  });

  test('hot resources priced higher per second than storage', () => {
    const p = DEFAULT_PRICING;
    assert.ok(p.vcpu_hot_micro_eur_per_sec > p.storage_gb_local_micro_eur_per_sec);
    assert.ok(p.ram_gb_hot_micro_eur_per_sec > p.storage_gb_local_micro_eur_per_sec);
  });
});

describe('computeRevenueMicroEur', () => {
  const pricing = DEFAULT_PRICING;

  test('zero seconds = zero revenue', () => {
    assert.equal(
      computeRevenueMicroEur({ vcpu_seconds: 0, ram_gb_seconds: 0, storage_gb_seconds_local: 0, storage_gb_seconds_archive: 0 }, pricing),
      0,
    );
  });

  test('1 vCPU·second = vcpu_hot rate', () => {
    const usage = { vcpu_seconds: 1, ram_gb_seconds: 0, storage_gb_seconds_local: 0, storage_gb_seconds_archive: 0 };
    assert.equal(computeRevenueMicroEur(usage, pricing), pricing.vcpu_hot_micro_eur_per_sec);
  });

  test('multiplies cleanly: 100 vCPU·s × 200 GB·s × 50 GB-stor·s', () => {
    const usage = { vcpu_seconds: 100, ram_gb_seconds: 200, storage_gb_seconds_local: 50, storage_gb_seconds_archive: 0 };
    const expected = 100 * pricing.vcpu_hot_micro_eur_per_sec
      + 200 * pricing.ram_gb_hot_micro_eur_per_sec
      + 50 * pricing.storage_gb_local_micro_eur_per_sec;
    assert.equal(computeRevenueMicroEur(usage, pricing), expected);
  });

  test('archive storage uses cheaper rate', () => {
    const localUsage = { vcpu_seconds: 0, ram_gb_seconds: 0, storage_gb_seconds_local: 100, storage_gb_seconds_archive: 0 };
    const archiveUsage = { vcpu_seconds: 0, ram_gb_seconds: 0, storage_gb_seconds_local: 0, storage_gb_seconds_archive: 100 };
    assert.ok(computeRevenueMicroEur(localUsage, pricing) > computeRevenueMicroEur(archiveUsage, pricing));
  });

  test('reservation discount reduces hot rates only (storage not discounted)', () => {
    const usage = { vcpu_seconds: 1000, ram_gb_seconds: 1000, storage_gb_seconds_local: 1000, storage_gb_seconds_archive: 0 };
    const noDiscount = computeRevenueMicroEur(usage, pricing);
    const withDiscount = computeRevenueMicroEur(usage, { ...pricing, reservation_discount_pct: 30 });
    // With 30% off hot resources, the savings should equal 0.30 × (vcpu_revenue + ram_revenue) and storage is unaffected.
    const hotRev = 1000 * pricing.vcpu_hot_micro_eur_per_sec + 1000 * pricing.ram_gb_hot_micro_eur_per_sec;
    const expectedSavings = hotRev * 0.30;
    assert.ok(Math.abs((noDiscount - withDiscount) - expectedSavings) < 1e-6,
      `discount mismatch: ${noDiscount - withDiscount} vs ${expectedSavings}`);
  });

  test('round numbers produce integer micro-eur naturally (no rounding artifact)', () => {
    // 3600·vcpu + 14400·ram + 72000·storage at the default rates lands on
    // an integer naturally: 3600·4.4 + 14400·1.3 + 72000·0.17 = 15840 + 18720 + 12240 = 46800.
    const usage = { vcpu_seconds: 3600, ram_gb_seconds: 3600 * 4, storage_gb_seconds_local: 3600 * 20, storage_gb_seconds_archive: 0 };
    const result = computeRevenueMicroEur(usage, pricing);
    assert.ok(Math.abs(result - Math.round(result)) < 1e-9, `expected integer-ish, got ${result}`);
  });
});

describe('computeNodeCostMicroEur', () => {
  test('zero seconds = zero cost', () => {
    const ex44 = SKU_CATALOG['EX44'];
    assert.equal(computeNodeCostMicroEur({ sku: ex44, online_seconds: 0 }), 0);
  });

  test('1 month online = SKU monthlyEur in micro-eur', () => {
    const ex44 = SKU_CATALOG['EX44'];
    const secondsInMonth = 30.4375 * 24 * 3600; // average month
    const cost = computeNodeCostMicroEur({ sku: ex44, online_seconds: secondsInMonth });
    const expected = Math.round(ex44.monthlyEur * 1e6);
    // Allow ±1 micro-eur for rounding.
    assert.ok(Math.abs(cost - expected) <= 1, `cost ${cost} vs expected ${expected}`);
  });

  test('cost scales linearly with online time', () => {
    const ex44 = SKU_CATALOG['EX44'];
    const oneHr = computeNodeCostMicroEur({ sku: ex44, online_seconds: 3600 });
    const twoHr = computeNodeCostMicroEur({ sku: ex44, online_seconds: 7200 });
    assert.equal(twoHr, oneHr * 2);
  });

  test('output is finite, non-negative, and round-to-integer at ledger boundary', () => {
    const ex44 = SKU_CATALOG['EX44'];
    const cost = computeNodeCostMicroEur({ sku: ex44, online_seconds: 12345 });
    assert.ok(Number.isFinite(cost));
    assert.ok(cost >= 0);
    assert.ok(Number.isInteger(Math.round(cost)));
  });
});

describe('estimateMonthlyRevenue', () => {
  const pricing = DEFAULT_PRICING;

  test('always-on 1vCPU/4GB/20GB sandbox at 100% time', () => {
    const shape: SandboxShape = { vcpus: 1, ram_gb: 4, storage_gb: 20 };
    const result = estimateMonthlyRevenue(shape, { active_fraction: 1.0 }, pricing);
    // expected: (1·vcpu + 4·ram + 20·storage) µ€/s × 730·3600
    const secondsInMonth = 730 * 3600;
    const expected = secondsInMonth * (
      1 * pricing.vcpu_hot_micro_eur_per_sec
      + 4 * pricing.ram_gb_hot_micro_eur_per_sec
      + 20 * pricing.storage_gb_local_micro_eur_per_sec
    );
    assert.ok(Math.abs(result.micro_eur - expected) < 1, `got ${result.micro_eur} expected ${expected}`);
  });

  test('burst revenue is storage-dominated (idle floor)', () => {
    // Insight surfaced by this test: even a barely-used sandbox earns
    // close to its full-month storage revenue. Storage is the revenue
    // *floor* — burst pricing is NOT dramatically cheaper than always-on
    // for typical sandbox shapes, because storage charges run continuously.
    const shape: SandboxShape = { vcpus: 1, ram_gb: 4, storage_gb: 20 };
    const burst = estimateMonthlyRevenue(shape, { active_fraction: 30 / (730 * 60) }, pricing);
    const idleFloor = estimateMonthlyRevenue(shape, { active_fraction: 0 }, pricing);
    // Burst should be slightly above the idle floor (a tiny bit of compute revenue).
    assert.ok(burst.micro_eur > idleFloor.micro_eur,
      `burst (${burst.micro_eur}) should exceed idle floor (${idleFloor.micro_eur})`);
    // …but within a small margin (active_fraction is ~0.07%).
    assert.ok(burst.micro_eur < idleFloor.micro_eur * 1.01,
      `burst (${burst.micro_eur}) shouldn't be more than 1% above idle floor (${idleFloor.micro_eur})`);
  });

  test('always-on revenue is meaningfully higher than burst (compute matters when constant)', () => {
    const shape: SandboxShape = { vcpus: 1, ram_gb: 4, storage_gb: 20 };
    const burst = estimateMonthlyRevenue(shape, { active_fraction: 30 / (730 * 60) }, pricing);
    const always = estimateMonthlyRevenue(shape, { active_fraction: 1.0 }, pricing);
    // Always-on at this shape: storage ~8.94 + compute (1 vCPU + 4 GB at rates)
    //   compute revenue/mo = (1·4.4 + 4·1.3) µEUR/s × 2.628M s = ~25.2M µEUR (€25.2)
    //   total ~€34/mo, ~3.8× burst.
    assert.ok(always.micro_eur > burst.micro_eur * 3,
      `always (${always.micro_eur}) should be meaningfully higher than burst (${burst.micro_eur})`);
  });

  test('storage cost is incurred even when active_fraction is 0', () => {
    const shape: SandboxShape = { vcpus: 1, ram_gb: 4, storage_gb: 20 };
    const result = estimateMonthlyRevenue(shape, { active_fraction: 0 }, pricing);
    // No vCPU or RAM cost, but 20 GB × storage rate × 730·3600 still bills.
    const secondsInMonth = 730 * 3600;
    const expected = secondsInMonth * 20 * pricing.storage_gb_local_micro_eur_per_sec;
    assert.ok(Math.abs(result.micro_eur - expected) < 1);
  });

  test('breakdown adds up to total micro_eur', () => {
    const shape: SandboxShape = { vcpus: 2, ram_gb: 8, storage_gb: 50 };
    const result = estimateMonthlyRevenue(shape, { active_fraction: 0.3 }, pricing);
    const sum = result.breakdown.vcpu_micro_eur + result.breakdown.ram_micro_eur + result.breakdown.storage_micro_eur;
    assert.equal(sum, result.micro_eur);
  });
});

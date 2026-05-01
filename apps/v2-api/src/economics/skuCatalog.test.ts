import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  SKU_CATALOG,
  DEFAULT_SKU_ID,
  DEFAULT_BIG_SKU_ID,
  unitCostsAtFill,
  bottleneckRate,
  recommendNextSku,
  getSku,
} from './skuCatalog.js';

describe('SKU_CATALOG invariants', () => {
  test('every SKU has positive resource counts and price', () => {
    for (const sku of Object.values(SKU_CATALOG)) {
      assert.ok(sku.vcpus > 0, `${sku.id} vcpus must be > 0`);
      assert.ok(sku.ramGb > 0, `${sku.id} ramGb must be > 0`);
      assert.ok(sku.usableStorageGb > 0, `${sku.id} usableStorageGb must be > 0`);
      assert.ok(sku.monthlyEur > 0, `${sku.id} monthlyEur must be > 0`);
    }
  });

  test('default SKU exists in catalog', () => {
    assert.ok(getSku(DEFAULT_SKU_ID), `default ${DEFAULT_SKU_ID} not in catalog`);
  });

  test('big SKU exists in catalog and is more expensive than default', () => {
    const big = getSku(DEFAULT_BIG_SKU_ID);
    const def = getSku(DEFAULT_SKU_ID);
    assert.ok(big);
    assert.ok(def);
    assert.ok(big.monthlyEur > def.monthlyEur, 'big SKU should cost more than default');
  });

  test('getSku returns null for unknown id', () => {
    assert.equal(getSku('NOT_A_SKU'), null);
    assert.equal(getSku(undefined), null);
    assert.equal(getSku(''), null);
  });
});

describe('unitCostsAtFill', () => {
  test('100% fill yields raw €/resource = price/capacity', () => {
    const ex44 = SKU_CATALOG['EX44'];
    const rates = unitCostsAtFill(ex44, 1.0);
    assert.ok(Math.abs(rates.eurPerVcpuMonth - ex44.monthlyEur / ex44.vcpus) < 1e-6);
    assert.ok(Math.abs(rates.eurPerGbRamMonth - ex44.monthlyEur / ex44.ramGb) < 1e-6);
    assert.ok(Math.abs(rates.eurPerGbStorageMonth - ex44.monthlyEur / ex44.usableStorageGb) < 1e-6);
  });

  test('80% fill costs 25% more per unit than 100% fill (1/0.8 = 1.25)', () => {
    const ex44 = SKU_CATALOG['EX44'];
    const at100 = unitCostsAtFill(ex44, 1.0);
    const at80 = unitCostsAtFill(ex44, 0.8);
    assert.ok(Math.abs(at80.eurPerVcpuMonth / at100.eurPerVcpuMonth - 1.25) < 1e-9);
    assert.ok(Math.abs(at80.eurPerGbRamMonth / at100.eurPerGbRamMonth - 1.25) < 1e-9);
  });

  test('default fill is 80%', () => {
    const ex44 = SKU_CATALOG['EX44'];
    const explicit = unitCostsAtFill(ex44, 0.8);
    const defaulted = unitCostsAtFill(ex44);
    assert.deepEqual(defaulted, explicit);
  });
});

describe('bottleneckRate', () => {
  test('vcpu binding when shape is CPU-heavy', () => {
    const ex44 = SKU_CATALOG['EX44'];
    // Shape uses 1 vCPU, 1 GB RAM, 1 GB storage. With EX44 having 20 vCPU,
    // 64 GB, 500 GB — the per-unit price for vCPU is highest, so the
    // sandbox cost is dominated by vCPU.
    const result = bottleneckRate(ex44, { vcpus: 1, ramGb: 1, storageGb: 1 });
    assert.equal(result.resource, 'vcpu');
    assert.ok(result.eurMonth > 0);
  });

  test('storage binding when shape is storage-heavy', () => {
    const ex44 = SKU_CATALOG['EX44'];
    // Shape: 0 vCPU, 0 GB RAM, 1000 GB storage (more than the box has).
    // Storage dominates.
    const result = bottleneckRate(ex44, { vcpus: 0, ramGb: 0, storageGb: 1000 });
    assert.equal(result.resource, 'storage');
  });

  test('typical sandbox shape (1vCPU/4GB/20GB) bottleneck on EX44', () => {
    const ex44 = SKU_CATALOG['EX44'];
    const result = bottleneckRate(ex44, { vcpus: 1, ramGb: 4, storageGb: 20 });
    // EX44 €/vCPU @ 80% = 42.30/(20*0.8) = 2.64;   1 vCPU * 2.64 = 2.64
    // EX44 €/GB-ram @ 80% = 42.30/(64*0.8) = 0.826; 4 GB * 0.826 = 3.30
    // EX44 €/GB-stor @ 80% = 42.30/(500*0.8) = 0.106; 20 * 0.106 = 2.12
    // → RAM is the bottleneck.
    assert.equal(result.resource, 'ram');
    assert.ok(Math.abs(result.eurMonth - (4 * 42.30 / (64 * 0.8))) < 1e-6);
  });
});

describe('recommendNextSku', () => {
  test('<10 hosts → always default SKU regardless of binding', () => {
    for (const binding of ['vcpus', 'ram', 'storage', null] as const) {
      const r = recommendNextSku({ fleetHostCount: 5, bindingConstraint: binding });
      assert.equal(r.skuId, DEFAULT_SKU_ID);
      assert.ok(r.rationale.includes('simple'));
    }
  });

  test('30+ hosts → big SKU', () => {
    const r = recommendNextSku({ fleetHostCount: 50, bindingConstraint: 'vcpus' });
    assert.equal(r.skuId, DEFAULT_BIG_SKU_ID);
  });

  test('preferConsolidation override → big SKU even at small fleet', () => {
    const r = recommendNextSku({ fleetHostCount: 5, bindingConstraint: 'vcpus', preferConsolidation: true });
    assert.equal(r.skuId, DEFAULT_BIG_SKU_ID);
  });

  test('mid fleet + ram binding → AX41-NVMe (cheapest €/GB-RAM)', () => {
    const r = recommendNextSku({ fleetHostCount: 15, bindingConstraint: 'ram' });
    assert.equal(r.skuId, 'AX41-NVMe');
  });

  test('mid fleet + storage binding → AX162-S (cheapest €/GB-storage)', () => {
    const r = recommendNextSku({ fleetHostCount: 15, bindingConstraint: 'storage' });
    assert.equal(r.skuId, 'AX162-S');
  });

  test('mid fleet + vcpu binding → default (EX44, cheapest €/vCPU)', () => {
    const r = recommendNextSku({ fleetHostCount: 15, bindingConstraint: 'vcpus' });
    assert.equal(r.skuId, DEFAULT_SKU_ID);
  });

  test('rationale text is non-empty for every branch', () => {
    const cases = [
      { fleetHostCount: 1, bindingConstraint: null },
      { fleetHostCount: 50, bindingConstraint: 'vcpus' as const },
      { fleetHostCount: 15, bindingConstraint: 'ram' as const },
      { fleetHostCount: 15, bindingConstraint: 'storage' as const },
      { fleetHostCount: 15, bindingConstraint: 'vcpus' as const },
    ];
    for (const c of cases) {
      const r = recommendNextSku(c);
      assert.ok(r.rationale.length > 10, `weak rationale for ${JSON.stringify(c)}: "${r.rationale}"`);
    }
  });
});

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { proposeForCluster, type ProposalWrite } from './autoscaleProposerWorker.js';
import { SKU_CATALOG } from '../economics/skuCatalog.js';
import type { FillSample } from '../economics/autoscale.js';

const sample = (ts: Date, vcpu: number, ram: number, storage: number): FillSample => ({
  ts, vcpuPct: vcpu, ramPct: ram, storagePct: storage,
});

describe('proposeForCluster', () => {
  const t0 = new Date('2026-04-27T12:00:00Z');
  const sustainedHigh = Array.from({ length: 4 }, (_, i) => sample(
    new Date(t0.getTime() + i * 5 * 60 * 1000),
    80 + i, 50, 50,
  ));

  test('emits add-node when binding is sustained above threshold', async () => {
    const writes: ProposalWrite[] = [];
    await proposeForCluster({
      clusterId: 'hel2',
      fleetHostCount: 1,
      samples: sustainedHigh,
      addThresholdPct: 75,
      drainThresholdPct: 20,
      sustainedMinutes: 15,
      defaultSku: SKU_CATALOG['EX44'],
      hasPendingProposalAlready: false,
      write: (w) => { writes.push(w); return Promise.resolve(); },
    });
    assert.equal(writes.length, 1);
    assert.equal(writes[0].kind, 'add-node');
    assert.equal(writes[0].clusterId, 'hel2');
    assert.equal(writes[0].proposedSku, 'EX44');
    assert.ok(writes[0].costImpactEurMo > 0, 'add-node should have positive cost impact');
    assert.ok(writes[0].rationale.length > 0);
  });

  test('emits drain-node when sustained below drain threshold', async () => {
    const writes: ProposalWrite[] = [];
    const sustainedLow = Array.from({ length: 12 }, (_, i) => sample(
      new Date(t0.getTime() + i * 10 * 60 * 1000),
      5, 5, 5,
    ));
    await proposeForCluster({
      clusterId: 'hel2',
      fleetHostCount: 5,
      samples: sustainedLow,
      addThresholdPct: 75,
      drainThresholdPct: 20,
      sustainedMinutes: 60,
      defaultSku: SKU_CATALOG['EX44'],
      hasPendingProposalAlready: false,
      write: (w) => { writes.push(w); return Promise.resolve(); },
    });
    assert.equal(writes.length, 1);
    assert.equal(writes[0].kind, 'drain-node');
    assert.ok(writes[0].costImpactEurMo < 0, 'drain-node should have negative cost impact (savings)');
  });

  test('emits no proposal when neither threshold is met', async () => {
    const writes: ProposalWrite[] = [];
    const moderate = Array.from({ length: 4 }, (_, i) => sample(
      new Date(t0.getTime() + i * 5 * 60 * 1000),
      40, 40, 40,
    ));
    await proposeForCluster({
      clusterId: 'hel2',
      fleetHostCount: 1,
      samples: moderate,
      addThresholdPct: 75,
      drainThresholdPct: 20,
      sustainedMinutes: 15,
      defaultSku: SKU_CATALOG['EX44'],
      hasPendingProposalAlready: false,
      write: (w) => { writes.push(w); return Promise.resolve(); },
    });
    assert.equal(writes.length, 0);
  });

  test('skips emitting a duplicate add-node when one is already pending', async () => {
    const writes: ProposalWrite[] = [];
    await proposeForCluster({
      clusterId: 'hel2',
      fleetHostCount: 1,
      samples: sustainedHigh,
      addThresholdPct: 75,
      drainThresholdPct: 20,
      sustainedMinutes: 15,
      defaultSku: SKU_CATALOG['EX44'],
      hasPendingProposalAlready: true,
      write: (w) => { writes.push(w); return Promise.resolve(); },
    });
    assert.equal(writes.length, 0);
  });
});

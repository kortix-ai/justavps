import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  shouldProposeAddNode,
  shouldProposeDrainNode,
  forecastExhaustion,
  type FillSample,
} from './autoscale.js';

const sample = (ts: Date, vcpu: number, ram: number, storage: number): FillSample => ({
  ts, vcpuPct: vcpu, ramPct: ram, storagePct: storage,
});

describe('shouldProposeAddNode', () => {
  test('no proposal when binding fill is below threshold', () => {
    const t0 = new Date('2026-04-27T12:00:00Z');
    const samples = [
      sample(new Date(t0.getTime()), 50, 50, 50),
      sample(new Date(t0.getTime() + 10 * 60 * 1000), 50, 50, 50),
      sample(new Date(t0.getTime() + 20 * 60 * 1000), 50, 50, 50),
    ];
    const r = shouldProposeAddNode(samples, { thresholdPct: 75, sustainedMinutes: 15 });
    assert.equal(r.shouldPropose, false);
  });

  test('no proposal when fill is above threshold but not sustained long enough', () => {
    const t0 = new Date('2026-04-27T12:00:00Z');
    const samples = [
      sample(new Date(t0.getTime()), 50, 50, 50),
      sample(new Date(t0.getTime() + 5 * 60 * 1000), 80, 50, 50),
    ];
    const r = shouldProposeAddNode(samples, { thresholdPct: 75, sustainedMinutes: 15 });
    assert.equal(r.shouldPropose, false);
  });

  test('proposal fires when fill ≥ threshold sustained for required minutes', () => {
    const t0 = new Date('2026-04-27T12:00:00Z');
    const samples = [
      sample(new Date(t0.getTime()), 80, 50, 50),
      sample(new Date(t0.getTime() + 5 * 60 * 1000), 82, 51, 50),
      sample(new Date(t0.getTime() + 10 * 60 * 1000), 83, 52, 50),
      sample(new Date(t0.getTime() + 16 * 60 * 1000), 85, 55, 50),
    ];
    const r = shouldProposeAddNode(samples, { thresholdPct: 75, sustainedMinutes: 15 });
    assert.equal(r.shouldPropose, true);
    assert.equal(r.binding, 'vcpu');
  });

  test('binding constraint reflects which resource is highest', () => {
    const t0 = new Date('2026-04-27T12:00:00Z');
    const samples = [
      sample(new Date(t0.getTime()), 30, 80, 30),
      sample(new Date(t0.getTime() + 30 * 60 * 1000), 35, 85, 32),
    ];
    const r = shouldProposeAddNode(samples, { thresholdPct: 75, sustainedMinutes: 15 });
    assert.equal(r.shouldPropose, true);
    assert.equal(r.binding, 'ram');
  });

  test('storage binding triggers different recommendation later (consumed downstream)', () => {
    const t0 = new Date('2026-04-27T12:00:00Z');
    const samples = [
      sample(new Date(t0.getTime()), 30, 30, 80),
      sample(new Date(t0.getTime() + 30 * 60 * 1000), 30, 30, 85),
    ];
    const r = shouldProposeAddNode(samples, { thresholdPct: 75, sustainedMinutes: 15 });
    assert.equal(r.shouldPropose, true);
    assert.equal(r.binding, 'storage');
  });

  test('empty sample list returns no proposal', () => {
    const r = shouldProposeAddNode([], { thresholdPct: 75, sustainedMinutes: 15 });
    assert.equal(r.shouldPropose, false);
  });
});

describe('shouldProposeDrainNode', () => {
  test('proposal fires when fill is sustained low (below threshold)', () => {
    const t0 = new Date('2026-04-27T12:00:00Z');
    const samples = [
      sample(new Date(t0.getTime()), 10, 10, 10),
      sample(new Date(t0.getTime() + 60 * 60 * 1000), 10, 10, 10),
      sample(new Date(t0.getTime() + 120 * 60 * 1000), 10, 10, 10),
    ];
    const r = shouldProposeDrainNode(samples, { thresholdPct: 20, sustainedMinutes: 60 });
    assert.equal(r.shouldPropose, true);
  });

  test('does NOT fire when any sample exceeds threshold', () => {
    const t0 = new Date('2026-04-27T12:00:00Z');
    const samples = [
      sample(new Date(t0.getTime()), 10, 50, 10),  // RAM spike
      sample(new Date(t0.getTime() + 60 * 60 * 1000), 10, 10, 10),
    ];
    const r = shouldProposeDrainNode(samples, { thresholdPct: 20, sustainedMinutes: 60 });
    assert.equal(r.shouldPropose, false);
  });

  test('not enough history → no drain (be conservative)', () => {
    const t0 = new Date('2026-04-27T12:00:00Z');
    const samples = [sample(new Date(t0.getTime()), 5, 5, 5)];
    const r = shouldProposeDrainNode(samples, { thresholdPct: 20, sustainedMinutes: 60 });
    assert.equal(r.shouldPropose, false);
  });
});

describe('forecastExhaustion (linear regression on the binding resource)', () => {
  test('returns ETA when fill is rising linearly', () => {
    const t0 = new Date('2026-04-27T12:00:00Z');
    // 10% per hour for 5 hours → at t=5h, 60% fill. At 100%, ETA is t=9h.
    const samples = Array.from({ length: 6 }, (_, i) => sample(
      new Date(t0.getTime() + i * 3600 * 1000),
      10 + i * 10, 10 + i * 10, 5,
    ));
    const r = forecastExhaustion(samples, { binding: 'vcpu', targetPct: 100 });
    assert.ok(r.etaMs !== null);
    // ETA = (100 - 60) / 10 = 4 more hours from last sample (which is at t=5h).
    // So absolute ETA = t0 + 9 hours.
    const expected = t0.getTime() + 9 * 3600 * 1000;
    assert.ok(Math.abs(r.etaMs! - expected) < 60_000, `eta ${new Date(r.etaMs!).toISOString()} expected ~${new Date(expected).toISOString()}`);
  });

  test('returns null when fill is flat or declining', () => {
    const t0 = new Date('2026-04-27T12:00:00Z');
    const flat = Array.from({ length: 5 }, (_, i) => sample(new Date(t0.getTime() + i * 3600 * 1000), 30, 30, 30));
    const r = forecastExhaustion(flat, { binding: 'vcpu', targetPct: 100 });
    assert.equal(r.etaMs, null);
  });

  test('caps eta at 1 year — no Infinity / Date overflow when slope is near-zero', () => {
    const t0 = new Date('2026-04-27T12:00:00Z');
    // Tiny upward slope: 0.0001%/hour. ETA from 50 to 100 = 500,000 hours
    // = ~57 years — way past our cap.
    const samples = Array.from({ length: 5 }, (_, i) => sample(
      new Date(t0.getTime() + i * 3600 * 1000),
      50 + i * 0.0001, 50, 50,
    ));
    const r = forecastExhaustion(samples, { binding: 'vcpu', targetPct: 100 });
    assert.equal(r.etaMs, null, 'eta should be null when slope projects past 1y cap');
  });

  test('null when not enough samples (< 2)', () => {
    const t0 = new Date('2026-04-27T12:00:00Z');
    const r = forecastExhaustion([sample(new Date(t0.getTime()), 50, 50, 50)], { binding: 'vcpu', targetPct: 100 });
    assert.equal(r.etaMs, null);
  });

  test('reports the slope (units: pct per hour) for transparency', () => {
    const t0 = new Date('2026-04-27T12:00:00Z');
    const samples = [
      sample(new Date(t0.getTime()), 10, 10, 10),
      sample(new Date(t0.getTime() + 3600 * 1000), 20, 20, 10),
      sample(new Date(t0.getTime() + 2 * 3600 * 1000), 30, 30, 10),
    ];
    const r = forecastExhaustion(samples, { binding: 'vcpu', targetPct: 100 });
    assert.ok(r.slopePctPerHour !== null);
    assert.ok(Math.abs(r.slopePctPerHour! - 10) < 0.1);
  });
});

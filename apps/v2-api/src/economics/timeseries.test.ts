import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  bucketDaily,
  bucketHourly,
  type LedgerRow,
  type SamplePoint,
  fillSamplesToFillSeries,
} from './timeseries.js';

const t = (iso: string) => new Date(iso);

describe('bucketDaily', () => {
  test('groups rows by UTC day and sums micro_eur', () => {
    const rows: LedgerRow[] = [
      { ts: t('2026-04-25T10:00:00Z'), microEur: 1000n },
      { ts: t('2026-04-25T22:00:00Z'), microEur: 2000n },
      { ts: t('2026-04-26T01:00:00Z'), microEur: 5000n },
    ];
    const out = bucketDaily(rows, t('2026-04-24T00:00:00Z'), t('2026-04-27T00:00:00Z'));
    assert.equal(out.length, 3); // 24, 25, 26
    assert.equal(out[0].microEur, 0n); // 24: empty
    assert.equal(out[1].microEur, 3000n); // 25: 1000+2000
    assert.equal(out[2].microEur, 5000n); // 26
  });

  test('empty rows produce empty buckets covering the window', () => {
    const out = bucketDaily([], t('2026-04-25T00:00:00Z'), t('2026-04-27T00:00:00Z'));
    assert.equal(out.length, 2);
    assert.ok(out.every((b) => b.microEur === 0n));
  });

  test('row outside window is ignored', () => {
    const rows: LedgerRow[] = [{ ts: t('2026-03-01T00:00:00Z'), microEur: 999n }];
    const out = bucketDaily(rows, t('2026-04-25T00:00:00Z'), t('2026-04-26T00:00:00Z'));
    assert.equal(out.length, 1);
    assert.equal(out[0].microEur, 0n);
  });
});

describe('bucketHourly', () => {
  test('groups rows by UTC hour', () => {
    const rows: LedgerRow[] = [
      { ts: t('2026-04-27T10:30:00Z'), microEur: 100n },
      { ts: t('2026-04-27T10:55:00Z'), microEur: 200n },
      { ts: t('2026-04-27T11:05:00Z'), microEur: 50n },
    ];
    const out = bucketHourly(rows, t('2026-04-27T09:00:00Z'), t('2026-04-27T12:00:00Z'));
    assert.equal(out.length, 3);
    assert.equal(out[0].microEur, 0n);    // 09
    assert.equal(out[1].microEur, 300n);  // 10
    assert.equal(out[2].microEur, 50n);   // 11
  });
});

describe('fillSamplesToFillSeries', () => {
  test('groups samples by ts, computes per-resource fill %', () => {
    const samples: SamplePoint[] = [
      { ts: t('2026-04-27T12:00:00Z'), hostId: 'h1', vcpuUsed: 4, ramGbUsed: 16, storageGbUsed: 50 },
      { ts: t('2026-04-27T12:00:00Z'), hostId: 'h2', vcpuUsed: 6, ramGbUsed: 24, storageGbUsed: 100 },
      { ts: t('2026-04-27T12:01:00Z'), hostId: 'h1', vcpuUsed: 8, ramGbUsed: 32, storageGbUsed: 50 },
    ];
    const series = fillSamplesToFillSeries(samples, { vcpus: 40, ramGb: 128, storageGb: 1000 });
    assert.equal(series.length, 2);
    // First sample: 10/40 = 25%, 40/128 ≈ 31.25%, 150/1000 = 15%
    assert.ok(Math.abs(series[0].vcpuPct - 25) < 0.001);
    assert.ok(Math.abs(series[0].ramPct - 31.25) < 0.001);
    assert.ok(Math.abs(series[0].storagePct - 15) < 0.001);
    // Second sample: 8/40 = 20%
    assert.ok(Math.abs(series[1].vcpuPct - 20) < 0.001);
  });

  test('zero capacity yields 0% fill (no NaN)', () => {
    const series = fillSamplesToFillSeries(
      [{ ts: t('2026-04-27T12:00:00Z'), hostId: 'h1', vcpuUsed: 4, ramGbUsed: 16, storageGbUsed: 50 }],
      { vcpus: 0, ramGb: 0, storageGb: 0 },
    );
    assert.equal(series[0].vcpuPct, 0);
    assert.equal(series[0].ramPct, 0);
    assert.equal(series[0].storagePct, 0);
  });

  test('output is sorted by ts ascending', () => {
    const samples: SamplePoint[] = [
      { ts: t('2026-04-27T12:02:00Z'), hostId: 'h1', vcpuUsed: 1, ramGbUsed: 1, storageGbUsed: 1 },
      { ts: t('2026-04-27T12:00:00Z'), hostId: 'h1', vcpuUsed: 1, ramGbUsed: 1, storageGbUsed: 1 },
      { ts: t('2026-04-27T12:01:00Z'), hostId: 'h1', vcpuUsed: 1, ramGbUsed: 1, storageGbUsed: 1 },
    ];
    const series = fillSamplesToFillSeries(samples, { vcpus: 10, ramGb: 10, storageGb: 10 });
    for (let i = 1; i < series.length; i++) {
      assert.ok(series[i].ts.getTime() > series[i - 1].ts.getTime());
    }
  });
});

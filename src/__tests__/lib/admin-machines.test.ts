import { describe, expect, it } from 'vitest';

import {
  formatMachineHealthPercent,
  getAdminMachinesRangeLabel,
  getAdminMachinesTotalPages,
} from '@/lib/admin-machines';

describe('admin machines helpers', () => {
  it('sanitizes invalid health values before rendering', () => {
    expect(formatMachineHealthPercent(undefined)).toBe('0%');
    expect(formatMachineHealthPercent(Number.NaN)).toBe('0%');
    expect(formatMachineHealthPercent(null)).toBe('0%');
    expect(formatMachineHealthPercent(37.6)).toBe('38%');
  });

  it('prevents NaN pagination labels when payload numbers are missing', () => {
    expect(getAdminMachinesRangeLabel(undefined, 0)).toBe('Showing 0 of 0');
    expect(getAdminMachinesRangeLabel({ offset: undefined, total: undefined }, 3)).toBe('Showing 1–3 of 3');
    expect(getAdminMachinesRangeLabel({ offset: 'oops', total: 'bad' }, 2)).toBe('Showing 1–2 of 2');
  });

  it('calculates total pages defensively', () => {
    expect(getAdminMachinesTotalPages(undefined, 100)).toBe(0);
    expect(getAdminMachinesTotalPages('bad', 100)).toBe(0);
    expect(getAdminMachinesTotalPages(201, 100)).toBe(3);
  });
});

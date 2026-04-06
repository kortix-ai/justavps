import { describe, expect, it } from 'vitest';

import { regionDisplay } from '@/lib/utils';

describe('regionDisplay', () => {
  it('renders concrete EU region labels instead of generic EU', () => {
    expect(regionDisplay('hel1')).toEqual({ flag: '🇫🇮', label: 'Helsinki, FI' });
    expect(regionDisplay('fsn1')).toEqual({ flag: '🇩🇪', label: 'Falkenstein, DE' });
    expect(regionDisplay('nbg1')).toEqual({ flag: '🇩🇪', label: 'Nuremberg, DE' });
  });

  it('renders concrete US region labels', () => {
    expect(regionDisplay('hil')).toEqual({ flag: '🇺🇸', label: 'Hillsboro, US' });
    expect(regionDisplay('ash')).toEqual({ flag: '🇺🇸', label: 'Ashburn, US' });
  });
});

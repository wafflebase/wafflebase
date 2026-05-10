import { describe, it, expect } from 'vitest';
import { defaultAdjustmentsFor, snapToDefaults } from './adjustment';

describe('defaultAdjustmentsFor', () => {
  it('returns the spec defaults for a registered kind', () => {
    expect(defaultAdjustmentsFor('roundRect')).toEqual([16667]);
    expect(defaultAdjustmentsFor('star5')).toEqual([19098]);
    expect(defaultAdjustmentsFor('wedgeRectCallout')).toEqual([-20833, 62500]);
  });

  it('returns [] for an unregistered kind', () => {
    expect(defaultAdjustmentsFor('rect')).toEqual([]);
  });
});

describe('snapToDefaults', () => {
  it('snaps when each adjustment is within 5% of (max - min) of default', () => {
    // roundRect default 16667, range 0..50000 → 5% = 2500
    expect(snapToDefaults('roundRect', [16000])).toEqual([16667]);
    expect(snapToDefaults('roundRect', [18000])).toEqual([16667]);
  });

  it('does not snap when farther than 5%', () => {
    expect(snapToDefaults('roundRect', [25000])).toEqual([25000]);
  });

  it('all adjustments must qualify (multi-index)', () => {
    // wedgeRectCallout defaults [-20833, 62500], ranges 200000 each → 5% = 10000
    // both close → snap
    expect(snapToDefaults('wedgeRectCallout', [-22000, 60000])).toEqual([-20833, 62500]);
    // first close, second far → no snap
    expect(snapToDefaults('wedgeRectCallout', [-22000, 0])).toEqual([-22000, 0]);
  });

  it('returns input unchanged for unregistered kind', () => {
    expect(snapToDefaults('rect', [42])).toEqual([42]);
  });
});

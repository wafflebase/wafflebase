import { describe, it, expect } from 'vitest';
import { cellAnchorToSref, isAnchorAlive } from '../anchor';

describe('cellAnchorToSref', () => {
  it('returns the visual Sref for a live anchor', () => {
    const order = { rowOrder: ['r1', 'r2', 'r3'], colOrder: ['cA', 'cB', 'cC'] };
    expect(cellAnchorToSref({ rowId: 'r2', colId: 'cB' }, order)).toBe('B2');
  });

  it('returns null for a deleted rowId', () => {
    const order = { rowOrder: ['r1', 'r2'], colOrder: ['cA'] };
    expect(cellAnchorToSref({ rowId: 'rGone', colId: 'cA' }, order)).toBeNull();
  });

  it('returns null for a deleted colId', () => {
    const order = { rowOrder: ['r1'], colOrder: ['cA', 'cB'] };
    expect(cellAnchorToSref({ rowId: 'r1', colId: 'cGone' }, order)).toBeNull();
  });
});

describe('isAnchorAlive', () => {
  it('true when both axis ids are present', () => {
    const order = { rowOrder: ['r1'], colOrder: ['cA'] };
    expect(isAnchorAlive({ rowId: 'r1', colId: 'cA' }, order)).toBe(true);
  });

  it('false when row is missing', () => {
    const order = { rowOrder: [], colOrder: ['cA'] };
    expect(isAnchorAlive({ rowId: 'r1', colId: 'cA' }, order)).toBe(false);
  });
});

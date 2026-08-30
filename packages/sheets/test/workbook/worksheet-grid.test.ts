import { describe, it, expect } from 'vitest';
import { normalizeStoredCell } from '../../src/model/workbook/worksheet-grid';

/**
 * `normalizeStoredCell` decides what a stored cell looks like on disk, and is
 * now the single definition both the editor's `YorkieStore` and the v1 REST
 * controller write through. The rule it encodes that nothing else states: the
 * spill fields are tested with `!== undefined`, not for truthiness, because a
 * spill of zero rows and `spillBlocked: false` are both meaningful state and
 * dropping them would silently un-spill a cell.
 */
describe('normalizeStoredCell', () => {
  it('drops empty values, formulas and styles', () => {
    expect(normalizeStoredCell({ v: '1', f: '', s: {} })).toEqual({ v: '1' });
    expect(normalizeStoredCell({ v: '', f: '=A1' })).toEqual({ f: '=A1' });
    expect(normalizeStoredCell({ v: '1', s: { b: true } })).toEqual({
      v: '1',
      s: { b: true },
    });
  });

  it('returns null when nothing is left worth storing', () => {
    expect(normalizeStoredCell({})).toBeNull();
    expect(normalizeStoredCell({ v: '', f: '', s: {} })).toBeNull();
  });

  it('preserves every spill field, including the falsy ones', () => {
    expect(
      normalizeStoredCell({
        spillAnchor: 'A1',
        spillRows: 0,
        spillCols: 0,
        spillBlocked: false,
      }),
    ).toEqual({
      spillAnchor: 'A1',
      spillRows: 0,
      spillCols: 0,
      spillBlocked: false,
    });
  });

  it('keeps a cell alive on a spill field alone', () => {
    expect(normalizeStoredCell({ v: '', spillAnchor: 'A1' })).toEqual({
      spillAnchor: 'A1',
    });
  });
});

import { describe, expect, it } from 'vitest';
import { Range } from '../../src/model/core/types';
import { headerHighlight } from '../../src/view/header-highlight';

const range = (r1: number, c1: number, r2: number, c2: number): Range => [
  { r: r1, c: c1 },
  { r: r2, c: c2 },
];

describe('headerHighlight', () => {
  it('marks every column and row the range spans, not only the active cell', () => {
    const ranges = [range(2, 2, 4, 5)]; // B2:E4
    const active = { r: 2, c: 2 };
    const cols = [1, 2, 3, 4, 5, 6].map((c) =>
      headerHighlight('column', c, active, 'cell', ranges),
    );
    expect(cols).toEqual(['none', 'spanned', 'spanned', 'spanned', 'spanned', 'none']);
    const rows = [1, 2, 3, 4, 5].map((r) =>
      headerHighlight('row', r, active, 'cell', ranges),
    );
    expect(rows).toEqual(['none', 'spanned', 'spanned', 'spanned', 'none']);
  });

  it('accepts a range written bottom-right to top-left', () => {
    const ranges = [range(4, 5, 2, 2)];
    expect(headerHighlight('column', 3, { r: 4, c: 5 }, 'cell', ranges)).toBe(
      'spanned',
    );
  });

  it('covers every range of a multi-range selection', () => {
    const ranges = [range(1, 1, 1, 1), range(5, 4, 6, 4)];
    const active = { r: 5, c: 4 };
    expect(headerHighlight('column', 1, active, 'cell', ranges)).toBe('spanned');
    expect(headerHighlight('column', 2, active, 'cell', ranges)).toBe('none');
    expect(headerHighlight('column', 4, active, 'cell', ranges)).toBe('spanned');
    expect(headerHighlight('row', 6, active, 'cell', ranges)).toBe('spanned');
    expect(headerHighlight('row', 3, active, 'cell', ranges)).toBe('none');
  });

  it('falls back to the active cell when there is no range', () => {
    expect(headerHighlight('column', 3, { r: 2, c: 3 }, 'cell', [])).toBe(
      'spanned',
    );
    expect(headerHighlight('row', 2, { r: 2, c: 3 }, 'cell', [])).toBe(
      'spanned',
    );
    expect(headerHighlight('row', 3, { r: 2, c: 3 }, 'cell', [])).toBe('none');
  });

  it('gives a fully selected row the full treatment and spans every column', () => {
    const ranges = [range(3, 1, 4, 26)];
    const active = { r: 3, c: 1 };
    expect(headerHighlight('row', 3, active, 'row', ranges)).toBe('full');
    expect(headerHighlight('row', 4, active, 'row', ranges)).toBe('full');
    expect(headerHighlight('row', 5, active, 'row', ranges)).toBe('none');
    expect(headerHighlight('column', 7, active, 'row', ranges)).toBe('spanned');
  });

  it('gives a fully selected column the full treatment', () => {
    const ranges = [range(1, 2, 1000, 2)];
    const active = { r: 1, c: 2 };
    expect(headerHighlight('column', 2, active, 'column', ranges)).toBe('full');
    expect(headerHighlight('column', 3, active, 'column', ranges)).toBe('none');
    expect(headerHighlight('row', 9, active, 'column', ranges)).toBe('spanned');
  });

  it('marks everything full when the whole sheet is selected', () => {
    expect(headerHighlight('column', 40, { r: 1, c: 1 }, 'all', [])).toBe('full');
    expect(headerHighlight('row', 40, { r: 1, c: 1 }, 'all', [])).toBe('full');
  });
});

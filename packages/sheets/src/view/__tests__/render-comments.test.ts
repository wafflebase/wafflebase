import { describe, it, expect } from 'vitest';
import { buildOpenThreadKeySet } from '../render-comments';

describe('buildOpenThreadKeySet', () => {
  it('includes only unresolved sheet-cell threads', () => {
    const set = buildOpenThreadKeySet([
      {
        anchor: { kind: 'sheet-cell', rowId: 'r1', colId: 'c1' },
        resolved: false,
      },
      {
        anchor: { kind: 'sheet-cell', rowId: 'r1', colId: 'c2' },
        resolved: true,
      },
      {
        anchor: { kind: 'sheet-cell', rowId: 'r2', colId: 'c1' },
        resolved: false,
      },
    ]);
    expect(set.has('r1|c1')).toBe(true);
    expect(set.has('r1|c2')).toBe(false);
    expect(set.has('r2|c1')).toBe(true);
    expect(set.size).toBe(2);
  });

  it('excludes non-sheet-cell anchors', () => {
    const set = buildOpenThreadKeySet([
      {
        anchor: { kind: 'sheet-cell', rowId: 'r1', colId: 'c1' },
        resolved: false,
      },
      { anchor: { kind: 'other-type' }, resolved: false },
    ]);
    expect(set.has('r1|c1')).toBe(true);
    expect(set.size).toBe(1);
  });

  it('excludes threads with missing rowId or colId', () => {
    const set = buildOpenThreadKeySet([
      {
        anchor: { kind: 'sheet-cell', rowId: 'r1' },
        resolved: false,
      },
      {
        anchor: { kind: 'sheet-cell', colId: 'c1' },
        resolved: false,
      },
      {
        anchor: { kind: 'sheet-cell', rowId: 'r2', colId: 'c2' },
        resolved: false,
      },
    ]);
    expect(set.has('r2|c2')).toBe(true);
    expect(set.size).toBe(1);
  });

  it('returns empty set when no threads match', () => {
    const set = buildOpenThreadKeySet([]);
    expect(set.size).toBe(0);
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenThreadKeySet } from '../../../../src/app/spreadsheet/canvas/render-comments.ts';

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
    assert.equal(set.has('r1|c1'), true);
    assert.equal(set.has('r1|c2'), false);
    assert.equal(set.has('r2|c1'), true);
    assert.equal(set.size, 2);
  });

  it('excludes non-sheet-cell anchors', () => {
    const set = buildOpenThreadKeySet([
      {
        anchor: { kind: 'sheet-cell', rowId: 'r1', colId: 'c1' },
        resolved: false,
      },
      { anchor: { kind: 'other-type' }, resolved: false },
    ]);
    assert.equal(set.has('r1|c1'), true);
    assert.equal(set.size, 1);
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
    assert.equal(set.has('r2|c2'), true);
    assert.equal(set.size, 1);
  });

  it('returns empty set when no threads match', () => {
    const set = buildOpenThreadKeySet([]);
    assert.equal(set.size, 0);
  });
});

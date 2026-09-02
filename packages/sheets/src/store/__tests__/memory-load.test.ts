import { describe, expect, it } from 'vitest';
import { MemStore } from '../memory';
import type { Worksheet } from '../../model/workbook/worksheet-document';

/** A minimal Worksheet: two rows, two columns, one cell at B2. */
const worksheet = (over: Partial<Worksheet> = {}): Worksheet => ({
  // Axis-id cell keys use `|` as the separator (see
  // `createWorksheetCellKey`/`WorksheetCellKeySeparator` in
  // worksheet-record.ts), not `:` as an earlier draft of this fixture
  // assumed.
  cells: { 'r2|c2': { v: 'fresh' } },
  rowOrder: ['r1', 'r2'],
  colOrder: ['c1', 'c2'],
  nextRowId: 3,
  nextColId: 3,
  rowHeights: {},
  colWidths: {},
  rowStyles: {},
  colStyles: {},
  frozenRows: 0,
  frozenCols: 0,
  ...over,
});

describe('MemStore.load', () => {
  it('resolves axis-id cells to A1 refs and replaces the grid wholesale', async () => {
    const store = new MemStore(new Map([['A1', { v: 'stale' }]]));
    store.load(worksheet());
    expect(await store.get({ r: 2, c: 2 })).toEqual({ v: 'fresh' });
    expect(await store.has({ r: 1, c: 1 })).toBe(false);
  });

  it('resolves dimensions by axis id and loads the freeze pane', async () => {
    const store = new MemStore();
    store.load(
      worksheet({
        rowHeights: { r2: 40 },
        colWidths: { c2: 120 },
        frozenRows: 1,
        frozenCols: 2,
      }),
    );
    // The `Store` interface has no `getRowHeight`/`getColWidth` accessors
    // (an earlier draft of this test assumed there were); dimension sizes
    // are read back via `getDimensionSizes(axis)`.
    expect((await store.getDimensionSizes('row')).get(2)).toBe(40);
    expect((await store.getDimensionSizes('column')).get(2)).toBe(120);
    expect(await store.getFreezePane()).toEqual({
      frozenRows: 1,
      frozenCols: 2,
    });
  });

  // `frozenRows`/`frozenCols` are declared required on `Worksheet`, so the
  // type system cannot catch a snapshot that predates them — and a revision
  // snapshot is exactly a root written by an older build. Straight-through
  // assignment left two `number` fields holding `undefined`.
  it('defaults a missing freeze pane to zero rather than undefined', async () => {
    const store = new MemStore();
    const legacy = worksheet();
    delete (legacy as Partial<Worksheet>).frozenRows;
    delete (legacy as Partial<Worksheet>).frozenCols;
    store.load(legacy);
    expect(await store.getFreezePane()).toEqual({
      frozenRows: 0,
      frozenCols: 0,
    });
  });

  // A load is a replace, not a merge: previewing version B after version A
  // must not leave A's freeze pane, merges or range styles behind — that
  // would render a version that never existed.
  it('clears state the incoming worksheet does not carry', async () => {
    const store = new MemStore();
    store.load(
      worksheet({
        frozenRows: 3,
        merges: { A1: { rs: 2, cs: 2 } },
        rangeStyles: [
          { range: [{ r: 1, c: 1 }, { r: 2, c: 2 }], style: { b: true } },
        ],
      }),
    );
    store.load(worksheet());
    expect(await store.getFreezePane()).toEqual({
      frozenRows: 0,
      frozenCols: 0,
    });
    expect(await store.getMerges()).toEqual(new Map());
    expect(await store.getRangeStyles()).toEqual([]);
  });
});

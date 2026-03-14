import { describe, it, expect } from 'vitest';
import { MemStore } from '../../src/store/memory';
import { Sheet } from '../../src/model/worksheet/sheet';
import { Grid, Sref } from '../../src/model/core/types';

/**
 * Helper: create a Sheet with GridResolver and FormulaResolver
 * wired to a set of "remote" sheets (each backed by a Grid).
 */
function createSheetWithRemotes(
  remotes: Map<string, Grid>,
  currentSheetName = 'Sheet1',
): Sheet {
  const store = new MemStore();
  const sheet = new Sheet(store);

  sheet.setGridResolver(
    (sheetName: string, refs: Set<Sref>): Grid | undefined => {
      const remoteGrid = remotes.get(sheetName);
      if (!remoteGrid) return undefined;
      const grid: Grid = new Map();
      for (const ref of refs) {
        const cell = remoteGrid.get(ref);
        if (cell) {
          grid.set(ref, cell);
        }
      }
      return grid;
    },
  );

  sheet.setFormulaResolver(
    (sheetName: string): Map<Sref, string> | undefined => {
      const remoteGrid = remotes.get(sheetName);
      if (!remoteGrid) return undefined;
      const formulas = new Map<Sref, string>();
      for (const [sref, cell] of remoteGrid) {
        if (cell.f) {
          formulas.set(sref, cell.f);
        }
      }
      return formulas;
    },
    currentSheetName,
  );

  return sheet;
}

describe('Cross-Sheet Cycle Detection', () => {
  it('should detect simple two-sheet cycle', async () => {
    // Sheet2!B1 references back to Sheet1!A1
    const remoteGrid: Grid = new Map();
    remoteGrid.set('B1', { v: '', f: '=Sheet1!A1' });

    const remotes = new Map([['SHEET2', remoteGrid]]);
    const sheet = createSheetWithRemotes(remotes);

    // Sheet1!A1 references Sheet2!B1 → cycle
    await sheet.setData({ r: 1, c: 1 }, '=Sheet2!B1');
    await sheet.recalculateCrossSheetFormulas();

    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('#REF!');
  });

  it('should detect transitive cycle across three sheets', async () => {
    const remote2: Grid = new Map();
    remote2.set('A1', { v: '', f: '=Sheet3!A1' });

    const remote3: Grid = new Map();
    remote3.set('A1', { v: '', f: '=Sheet1!A1' });

    const remotes = new Map([
      ['SHEET2', remote2],
      ['SHEET3', remote3],
    ]);
    const sheet = createSheetWithRemotes(remotes);

    // Sheet1!A1 → Sheet2!A1 → Sheet3!A1 → Sheet1!A1 (cycle)
    await sheet.setData({ r: 1, c: 1 }, '=Sheet2!A1');
    await sheet.recalculateCrossSheetFormulas();

    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('#REF!');
  });

  it('should not flag non-cyclic cross-sheet references', async () => {
    const remoteGrid: Grid = new Map();
    remoteGrid.set('B1', { v: '42' });

    const remotes = new Map([['SHEET2', remoteGrid]]);
    const sheet = createSheetWithRemotes(remotes);

    await sheet.setData({ r: 1, c: 1 }, '=Sheet2!B1');
    await sheet.recalculateCrossSheetFormulas();

    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('42');
  });

  it('should recover when cycle is broken', async () => {
    const remoteGrid: Grid = new Map();
    remoteGrid.set('B1', { v: '', f: '=Sheet1!A1' });

    const remotes = new Map([['SHEET2', remoteGrid]]);
    const sheet = createSheetWithRemotes(remotes);

    // Create cycle
    await sheet.setData({ r: 1, c: 1 }, '=Sheet2!B1');
    await sheet.recalculateCrossSheetFormulas();
    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('#REF!');

    // Break cycle: Sheet2!B1 becomes a plain value
    remoteGrid.set('B1', { v: '100' });

    // Force re-scan and recalculate
    sheet['crossSheetFormulaSrefs'] = null;
    await sheet.recalculateCrossSheetFormulas();
    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('100');
  });

  it('should work without FormulaResolver (backward compatible)', async () => {
    const store = new MemStore();
    const sheet = new Sheet(store);

    const remoteGrid: Grid = new Map();
    remoteGrid.set('B1', { v: '10' });

    // Only GridResolver, no FormulaResolver
    sheet.setGridResolver(
      (sheetName: string, refs: Set<Sref>): Grid | undefined => {
        if (sheetName === 'SHEET2') {
          const grid: Grid = new Map();
          for (const ref of refs) {
            const cell = remoteGrid.get(ref);
            if (cell) grid.set(ref, cell);
          }
          return grid;
        }
        return undefined;
      },
    );

    await sheet.setData({ r: 1, c: 1 }, '=Sheet2!B1');
    await sheet.recalculateCrossSheetFormulas();

    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('10');
  });
});

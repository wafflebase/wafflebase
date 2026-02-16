import { describe, it, expect } from 'vitest';
import { MemStore } from '../../src/store/memory';
import { Sheet } from '../../src/model/sheet';
import { Grid, Cell, Sref, GridResolver } from '../../src/model/types';

describe('Cross-Sheet Calculation', () => {
  it('should evaluate cross-sheet formula with GridResolver', async () => {
    const sheet = new Sheet(new MemStore());

    // Simulate another sheet with data at A1 = 42
    const resolver: GridResolver = (
      sheetName: string,
      refs: Set<Sref>,
    ): Grid | undefined => {
      if (sheetName === 'SHEET2') {
        const grid: Grid = new Map<Sref, Cell>();
        for (const ref of refs) {
          if (ref === 'A1') {
            grid.set(ref, { v: '42' });
          }
        }
        return grid;
      }
      return undefined;
    };

    sheet.setGridResolver(resolver);
    await sheet.setData({ r: 1, c: 1 }, '=Sheet2!A1');

    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('42');
  });

  it('should evaluate SUM with cross-sheet range and GridResolver', async () => {
    const sheet = new Sheet(new MemStore());

    const resolver: GridResolver = (
      sheetName: string,
      refs: Set<Sref>,
    ): Grid | undefined => {
      if (sheetName === 'SHEET2') {
        const data: Record<string, string> = { A1: '10', A2: '20', A3: '30' };
        const grid: Grid = new Map<Sref, Cell>();
        for (const ref of refs) {
          if (data[ref]) {
            grid.set(ref, { v: data[ref] });
          }
        }
        return grid;
      }
      return undefined;
    };

    sheet.setGridResolver(resolver);
    await sheet.setData({ r: 1, c: 1 }, '=SUM(Sheet2!A1:A3)');

    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('60');
  });

  it('should return empty for cross-sheet ref when sheet does not exist', async () => {
    const sheet = new Sheet(new MemStore());

    const resolver: GridResolver = (): Grid | undefined => {
      return undefined;
    };

    sheet.setGridResolver(resolver);
    await sheet.setData({ r: 1, c: 1 }, '=Sheet99!A1');

    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('');
  });

  it('should return empty for cross-sheet ref without GridResolver', async () => {
    const sheet = new Sheet(new MemStore());

    // No resolver set — cross-sheet data can't be resolved
    await sheet.setData({ r: 1, c: 1 }, '=Sheet2!A1');

    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('');
  });

  it('should mix local and cross-sheet refs', async () => {
    const sheet = new Sheet(new MemStore());

    const resolver: GridResolver = (
      sheetName: string,
      refs: Set<Sref>,
    ): Grid | undefined => {
      if (sheetName === 'SHEET2') {
        const grid: Grid = new Map<Sref, Cell>();
        for (const ref of refs) {
          if (ref === 'A1') {
            grid.set(ref, { v: '100' });
          }
        }
        return grid;
      }
      return undefined;
    };

    sheet.setGridResolver(resolver);
    await sheet.setData({ r: 1, c: 1 }, '50');
    await sheet.setData({ r: 1, c: 2 }, '=A1+Sheet2!A1');

    expect(await sheet.toDisplayString({ r: 1, c: 2 })).toBe('150');
  });

  it('should recalculate cross-sheet formulas when source data changes', async () => {
    const sheet = new Sheet(new MemStore());

    // Mutable external data source
    let externalValue = '100';
    const resolver: GridResolver = (
      sheetName: string,
      refs: Set<Sref>,
    ): Grid | undefined => {
      if (sheetName === 'SHEET2') {
        const grid: Grid = new Map<Sref, Cell>();
        for (const ref of refs) {
          if (ref === 'A1') {
            grid.set(ref, { v: externalValue });
          }
        }
        return grid;
      }
      return undefined;
    };

    sheet.setGridResolver(resolver);
    await sheet.setData({ r: 1, c: 1 }, '=SUM(Sheet2!A1)');
    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('100');

    // Simulate Sheet2!A1 changing externally
    externalValue = '999';
    // Without recalculation, stale value persists
    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('100');

    // After recalculation, the updated value is reflected
    await sheet.recalculateCrossSheetFormulas();
    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('999');
  });

  it('should preserve cell style during cross-sheet recalculation', async () => {
    const store = new MemStore();
    const sheet = new Sheet(store);

    let externalValue = '50';
    const resolver: GridResolver = (
      sheetName: string,
      refs: Set<Sref>,
    ): Grid | undefined => {
      if (sheetName === 'SHEET2') {
        const grid: Grid = new Map<Sref, Cell>();
        for (const ref of refs) {
          if (ref === 'A1') {
            grid.set(ref, { v: externalValue });
          }
        }
        return grid;
      }
      return undefined;
    };

    sheet.setGridResolver(resolver);
    await sheet.setData({ r: 1, c: 1 }, '=Sheet2!A1');
    // Apply a style to the cell
    await store.set(
      { r: 1, c: 1 },
      {
        v: '50',
        f: '=Sheet2!A1',
        s: { b: true },
      },
    );

    externalValue = '200';
    await sheet.recalculateCrossSheetFormulas();

    const cell = await sheet.getCell({ r: 1, c: 1 });
    expect(cell?.v).toBe('200');
    expect(cell?.f).toBe('=Sheet2!A1');
    expect(cell?.s?.b).toBe(true);
  });

  it('should recalculate local dependant chains after cross-sheet update', async () => {
    const sheet = new Sheet(new MemStore());

    let externalValue = '1';
    const resolver: GridResolver = (
      sheetName: string,
      refs: Set<Sref>,
    ): Grid | undefined => {
      if (sheetName !== 'SHEET2') return undefined;
      const grid: Grid = new Map<Sref, Cell>();
      for (const ref of refs) {
        if (ref === 'A1') {
          grid.set(ref, { v: externalValue });
        }
      }
      return grid;
    };

    sheet.setGridResolver(resolver);
    await sheet.setData({ r: 1, c: 1 }, '=Sheet2!A1'); // A1 = 1
    await sheet.setData({ r: 2, c: 1 }, '2'); // A2 = 2
    await sheet.setData({ r: 1, c: 2 }, '=SUM(A1:A2)'); // B1 = 3

    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('1');
    expect(await sheet.toDisplayString({ r: 1, c: 2 })).toBe('3');

    // Simulate Sheet2!A1 update and force cross-sheet recalculation.
    externalValue = '2';
    await sheet.recalculateCrossSheetFormulas();

    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('2');
    expect(await sheet.toDisplayString({ r: 1, c: 2 })).toBe('4');
  });
});

import { describe, it, expect } from 'vitest';
import {
  remapIndex,
  moveRef,
  moveFormula,
  moveGrid,
  moveDimensionMap,
} from '../../src/model/shifting';
import { Grid } from '../../src/model/types';
import { MemStore } from '../../src/store/memory';
import { Sheet } from '../../src/model/sheet';

describe('remapIndex', () => {
  describe('move forward (dst > src + count)', () => {
    it('should move source items to destination', () => {
      // Move row 2 (count=1) to before row 5
      // Row 2 → position 4 (dst - count = 5 - 1 = 4)
      expect(remapIndex(2, 2, 1, 5)).toBe(4);
    });

    it('should shift items between source and destination backward', () => {
      // Move row 2 to before row 5: rows 3,4 shift back by 1
      expect(remapIndex(3, 2, 1, 5)).toBe(2);
      expect(remapIndex(4, 2, 1, 5)).toBe(3);
    });

    it('should not change items outside the affected range', () => {
      expect(remapIndex(1, 2, 1, 5)).toBe(1);
      expect(remapIndex(5, 2, 1, 5)).toBe(5);
      expect(remapIndex(6, 2, 1, 5)).toBe(6);
    });

    it('should move multiple items forward', () => {
      // Move rows 2-3 (count=2) to before row 6
      // Row 2 → 4, Row 3 → 5
      expect(remapIndex(2, 2, 2, 6)).toBe(4);
      expect(remapIndex(3, 2, 2, 6)).toBe(5);
      // Rows 4,5 shift back by 2
      expect(remapIndex(4, 2, 2, 6)).toBe(2);
      expect(remapIndex(5, 2, 2, 6)).toBe(3);
    });
  });

  describe('move backward (dst < src)', () => {
    it('should move source items to destination', () => {
      // Move row 4 (count=1) to before row 2
      // Row 4 → position 2
      expect(remapIndex(4, 4, 1, 2)).toBe(2);
    });

    it('should shift items between destination and source forward', () => {
      // Move row 4 to before row 2: rows 2,3 shift forward by 1
      expect(remapIndex(2, 4, 1, 2)).toBe(3);
      expect(remapIndex(3, 4, 1, 2)).toBe(4);
    });

    it('should not change items outside the affected range', () => {
      expect(remapIndex(1, 4, 1, 2)).toBe(1);
      expect(remapIndex(5, 4, 1, 2)).toBe(5);
    });

    it('should move multiple items backward', () => {
      // Move rows 4-5 (count=2) to before row 2
      // Row 4 → 2, Row 5 → 3
      expect(remapIndex(4, 4, 2, 2)).toBe(2);
      expect(remapIndex(5, 4, 2, 2)).toBe(3);
      // Rows 2,3 shift forward by 2
      expect(remapIndex(2, 4, 2, 2)).toBe(4);
      expect(remapIndex(3, 4, 2, 2)).toBe(5);
    });
  });

  describe('no-op cases', () => {
    it('should return same index when dst equals src', () => {
      expect(remapIndex(2, 2, 1, 2)).toBe(2);
    });

    it('should return same index when dst equals src + count (dst at end of source)', () => {
      // dst = src + count is effectively a no-op for Sheet (handled by Sheet.moveCells guard)
      // remapIndex itself maps: i=2 → dst-count+(i-src) = 3-1+0 = 2
      expect(remapIndex(2, 2, 1, 3)).toBe(2);
    });
  });
});

describe('moveRef', () => {
  it('should remap row axis', () => {
    expect(moveRef({ r: 2, c: 1 }, 'row', 2, 1, 5)).toEqual({ r: 4, c: 1 });
  });

  it('should remap column axis', () => {
    expect(moveRef({ r: 1, c: 2 }, 'column', 2, 1, 5)).toEqual({ r: 1, c: 4 });
  });

  it('should not change unaffected axis', () => {
    expect(moveRef({ r: 1, c: 3 }, 'row', 2, 1, 5)).toEqual({ r: 1, c: 3 });
  });
});

describe('moveFormula', () => {
  it('should remap single references', () => {
    // Move row 2 to before row 5: A2 → A4, A3 → A2
    expect(moveFormula('=A2+A3', 'row', 2, 1, 5)).toBe('=A4+A2');
  });

  it('should remap range references', () => {
    expect(moveFormula('=SUM(A2:A4)', 'row', 2, 1, 5)).toBe('=SUM(A4:A3)');
  });

  it('should remap column references', () => {
    expect(moveFormula('=B1+C1', 'column', 2, 1, 5)).toBe('=D1+B1');
  });

  it('should remap multiple references', () => {
    expect(moveFormula('=A2+B3+C4', 'row', 2, 1, 5)).toBe('=A4+B2+C3');
  });
});

describe('moveGrid', () => {
  it('should remap cell positions on forward move', () => {
    const grid: Grid = new Map([
      ['A1', { v: '10' }],
      ['A2', { v: '20' }],
      ['A3', { v: '30' }],
      ['A4', { v: '40' }],
    ]);

    // Move row 2 to before row 5 (after row 4)
    const result = moveGrid(grid, 'row', 2, 1, 5);

    expect(result.get('A1')).toEqual({ v: '10' });
    expect(result.get('A2')).toEqual({ v: '30' }); // row 3 → 2
    expect(result.get('A3')).toEqual({ v: '40' }); // row 4 → 3
    expect(result.get('A4')).toEqual({ v: '20' }); // row 2 → 4
  });

  it('should remap cell positions on backward move', () => {
    const grid: Grid = new Map([
      ['A1', { v: '10' }],
      ['A2', { v: '20' }],
      ['A3', { v: '30' }],
      ['A4', { v: '40' }],
    ]);

    // Move row 4 to before row 2
    const result = moveGrid(grid, 'row', 4, 1, 2);

    expect(result.get('A1')).toEqual({ v: '10' });
    expect(result.get('A2')).toEqual({ v: '40' }); // row 4 → 2
    expect(result.get('A3')).toEqual({ v: '20' }); // row 2 → 3
    expect(result.get('A4')).toEqual({ v: '30' }); // row 3 → 4
  });

  it('should update formulas within moved cells', () => {
    const grid: Grid = new Map([
      ['A1', { v: '10' }],
      ['A2', { v: '20' }],
      ['A3', { v: '30', f: '=A1+A2' }],
    ]);

    // Move row 2 to before row 4 (after row 3)
    const result = moveGrid(grid, 'row', 2, 1, 4);

    // A3 had formula =A1+A2, now at A2 with formula =A1+A3
    expect(result.get('A2')?.f).toBe('=A1+A3');
  });
});

describe('moveDimensionMap', () => {
  it('should remap keys on forward move', () => {
    const map = new Map([[2, 80], [4, 120]]);
    // Move key 2 to before 5
    const result = moveDimensionMap(map, 2, 1, 5);

    expect(result.has(2)).toBe(false);
    expect(result.get(4)).toBe(80);  // key 2 → 4
    expect(result.get(3)).toBe(120); // key 4 → 3
  });

  it('should remap keys on backward move', () => {
    const map = new Map([[1, 50], [4, 120]]);
    // Move key 4 to before 2
    const result = moveDimensionMap(map, 4, 1, 2);

    expect(result.get(1)).toBe(50);
    expect(result.get(2)).toBe(120); // key 4 → 2
  });

  it('should handle empty map', () => {
    const map = new Map<number, number>();
    const result = moveDimensionMap(map, 2, 1, 5);
    expect(result.size).toBe(0);
  });
});

describe('Sheet.moveRows', () => {
  it('should move row data to new position (forward)', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 2, c: 1 }, '20');
    await sheet.setData({ r: 3, c: 1 }, '30');
    await sheet.setData({ r: 4, c: 1 }, '40');

    // Move row 2 to after row 4 (before row 5)
    await sheet.moveRows(2, 1, 5);

    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('10');
    expect(await sheet.toDisplayString({ r: 2, c: 1 })).toBe('30');
    expect(await sheet.toDisplayString({ r: 3, c: 1 })).toBe('40');
    expect(await sheet.toDisplayString({ r: 4, c: 1 })).toBe('20');
  });

  it('should move row data to new position (backward)', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 2, c: 1 }, '20');
    await sheet.setData({ r: 3, c: 1 }, '30');
    await sheet.setData({ r: 4, c: 1 }, '40');

    // Move row 4 to before row 2
    await sheet.moveRows(4, 1, 2);

    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('10');
    expect(await sheet.toDisplayString({ r: 2, c: 1 })).toBe('40');
    expect(await sheet.toDisplayString({ r: 3, c: 1 })).toBe('20');
    expect(await sheet.toDisplayString({ r: 4, c: 1 })).toBe('30');
  });

  it('should update formula references after move', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 2, c: 1 }, '20');
    await sheet.setData({ r: 3, c: 1 }, '=A1+A2');

    // Move row 2 to after row 3 (before row 4)
    await sheet.moveRows(2, 1, 4);

    // Row 3 (formula) → Row 2, Row 2 (data) → Row 3
    // Formula was =A1+A2, now at row 2, refs remapped: =A1+A3
    expect(await sheet.toInputString({ r: 2, c: 1 })).toBe('=A1+A3');
    expect(await sheet.toDisplayString({ r: 2, c: 1 })).toBe('30');
  });

  it('should be a no-op when dst is within source range', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 2, c: 1 }, '20');

    await sheet.moveRows(2, 1, 2);

    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('10');
    expect(await sheet.toDisplayString({ r: 2, c: 1 })).toBe('20');
  });
});

describe('Sheet.moveColumns', () => {
  it('should move column data to new position (forward)', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 1, c: 2 }, '20');
    await sheet.setData({ r: 1, c: 3 }, '30');
    await sheet.setData({ r: 1, c: 4 }, '40');

    // Move column 2 to after column 4 (before column 5)
    await sheet.moveColumns(2, 1, 5);

    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('10');
    expect(await sheet.toDisplayString({ r: 1, c: 2 })).toBe('30');
    expect(await sheet.toDisplayString({ r: 1, c: 3 })).toBe('40');
    expect(await sheet.toDisplayString({ r: 1, c: 4 })).toBe('20');
  });

  it('should update formula references after column move', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 1, c: 2 }, '20');
    await sheet.setData({ r: 1, c: 3 }, '=A1+B1');

    // Move column 2 to after column 3 (before column 4)
    await sheet.moveColumns(2, 1, 4);

    // Column 3 (formula) → Column 2, Column 2 (data) → Column 3
    expect(await sheet.toInputString({ r: 1, c: 2 })).toBe('=A1+C1');
    expect(await sheet.toDisplayString({ r: 1, c: 2 })).toBe('30');
  });
});

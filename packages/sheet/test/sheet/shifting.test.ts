import { describe, it, expect } from 'vitest';
import {
  shiftRef,
  shiftSref,
  shiftFormula,
  shiftGrid,
  shiftDimensionMap,
  relocateFormula,
  moveFormula,
  redirectFormula,
} from '../../src/model/shifting';
import { parseAbsRef, toAbsSref } from '../../src/model/coordinates';
import { Grid, Sref } from '../../src/model/types';

describe('shiftRef', () => {
  describe('insert (count > 0)', () => {
    it('should shift row refs at or after index', () => {
      expect(shiftRef({ r: 3, c: 1 }, 'row', 2, 1)).toEqual({ r: 4, c: 1 });
    });

    it('should shift row ref exactly at index', () => {
      expect(shiftRef({ r: 2, c: 1 }, 'row', 2, 1)).toEqual({ r: 3, c: 1 });
    });

    it('should not shift row refs before index', () => {
      expect(shiftRef({ r: 1, c: 1 }, 'row', 2, 1)).toEqual({ r: 1, c: 1 });
    });

    it('should shift column refs at or after index', () => {
      expect(shiftRef({ r: 1, c: 3 }, 'column', 2, 1)).toEqual({ r: 1, c: 4 });
    });

    it('should not shift column refs before index', () => {
      expect(shiftRef({ r: 1, c: 1 }, 'column', 2, 1)).toEqual({ r: 1, c: 1 });
    });

    it('should shift by count > 1', () => {
      expect(shiftRef({ r: 5, c: 1 }, 'row', 3, 3)).toEqual({ r: 8, c: 1 });
    });
  });

  describe('delete (count < 0)', () => {
    it('should return null for ref in deleted zone', () => {
      expect(shiftRef({ r: 2, c: 1 }, 'row', 2, -1)).toBeNull();
    });

    it('should return null for ref in multi-row deleted zone', () => {
      expect(shiftRef({ r: 3, c: 1 }, 'row', 2, -2)).toBeNull();
    });

    it('should shift row refs after deleted zone', () => {
      expect(shiftRef({ r: 4, c: 1 }, 'row', 2, -1)).toEqual({ r: 3, c: 1 });
    });

    it('should not shift row refs before deleted zone', () => {
      expect(shiftRef({ r: 1, c: 1 }, 'row', 2, -1)).toEqual({ r: 1, c: 1 });
    });

    it('should return null for column ref in deleted zone', () => {
      expect(shiftRef({ r: 1, c: 2 }, 'column', 2, -1)).toBeNull();
    });

    it('should shift column refs after deleted zone', () => {
      expect(shiftRef({ r: 1, c: 3 }, 'column', 2, -1)).toEqual({ r: 1, c: 2 });
    });
  });
});

describe('shiftSref', () => {
  it('should shift a string ref', () => {
    expect(shiftSref('A2', 'row', 2, 1)).toBe('A3');
  });

  it('should return null for deleted ref', () => {
    expect(shiftSref('A2', 'row', 2, -1)).toBeNull();
  });

  it('should shift column ref', () => {
    expect(shiftSref('B1', 'column', 2, 1)).toBe('C1');
  });
});

describe('shiftFormula', () => {
  it('should shift single reference in formula', () => {
    expect(shiftFormula('=A1+A2', 'row', 2, 1)).toBe('=A1+A3');
  });

  it('should shift multiple references in formula', () => {
    expect(shiftFormula('=A2+B2', 'row', 2, 1)).toBe('=A3+B3');
  });

  it('should shift range reference in formula', () => {
    expect(shiftFormula('=SUM(A2:A5)', 'row', 2, 1)).toBe('=SUM(A3:A6)');
  });

  it('should replace deleted ref with #REF!', () => {
    expect(shiftFormula('=A2+B1', 'row', 2, -1)).toBe('=#REF!+B1');
  });

  it('should replace deleted range endpoint with #REF!', () => {
    expect(shiftFormula('=SUM(A2:A3)', 'row', 2, -1)).toBe('=SUM(#REF!)');
  });

  it('should shift column references', () => {
    expect(shiftFormula('=B1+C1', 'column', 2, 1)).toBe('=C1+D1');
  });

  it('should not shift refs before index', () => {
    expect(shiftFormula('=A1+A3', 'row', 3, 1)).toBe('=A1+A4');
  });
});

describe('shiftGrid', () => {
  it('should shift all cells on insert', () => {
    const grid: Grid = new Map([
      ['A1', { v: '10' }],
      ['A2', { v: '20' }],
      ['A3', { v: '30' }],
    ]);

    const result = shiftGrid(grid, 'row', 2, 1);

    expect(result.get('A1')).toEqual({ v: '10' });
    expect(result.get('A3')).toEqual({ v: '20' });
    expect(result.get('A4')).toEqual({ v: '30' });
    expect(result.has('A2')).toBe(false);
    expect(result.size).toBe(3);
  });

  it('should remove deleted cells', () => {
    const grid: Grid = new Map([
      ['A1', { v: '10' }],
      ['A2', { v: '20' }],
      ['A3', { v: '30' }],
    ]);

    const result = shiftGrid(grid, 'row', 2, -1);

    expect(result.get('A1')).toEqual({ v: '10' });
    expect(result.get('A2')).toEqual({ v: '30' });
    expect(result.has('A3')).toBe(false);
    expect(result.size).toBe(2);
  });

  it('should update formulas within shifted cells', () => {
    const grid: Grid = new Map([
      ['A1', { v: '10' }],
      ['A2', { v: '20' }],
      ['A3', { v: '30', f: '=A1+A2' }],
    ]);

    const result = shiftGrid(grid, 'row', 2, 1);

    expect(result.get('A4')?.f).toBe('=A1+A3');
  });

  it('should shift column cells', () => {
    const grid: Grid = new Map([
      ['A1', { v: '10' }],
      ['B1', { v: '20' }],
      ['C1', { v: '30' }],
    ]);

    const result = shiftGrid(grid, 'column', 2, 1);

    expect(result.get('A1')).toEqual({ v: '10' });
    expect(result.get('C1')).toEqual({ v: '20' });
    expect(result.get('D1')).toEqual({ v: '30' });
    expect(result.has('B1')).toBe(false);
    expect(result.size).toBe(3);
  });
});

describe('relocateFormula', () => {
  it('should shift references by positive delta', () => {
    expect(relocateFormula('=A1+B2', 2, 1)).toBe('=B3+C4');
  });

  it('should shift range references', () => {
    expect(relocateFormula('=SUM(A1:B3)', 1, 1)).toBe('=SUM(B2:C4)');
  });

  it('should return #REF! when row goes below 1', () => {
    expect(relocateFormula('=A1+B2', -1, 0)).toBe('=#REF!+B1');
  });

  it('should return #REF! when column goes below 1', () => {
    expect(relocateFormula('=A1+B2', 0, -1)).toBe('=#REF!+A2');
  });

  it('should return #REF! for range when endpoint goes below 1', () => {
    expect(relocateFormula('=SUM(A1:B3)', -1, 0)).toBe('=SUM(#REF!)');
  });

  it('should be identity when delta is zero', () => {
    expect(relocateFormula('=A1+B2', 0, 0)).toBe('=A1+B2');
  });

  it('should shift negative deltas correctly', () => {
    expect(relocateFormula('=C3+D4', -1, -1)).toBe('=B2+C3');
  });

  it('should handle function calls with references', () => {
    expect(relocateFormula('=SUM(A1,B2,C3)', 1, 0)).toBe('=SUM(A2,B3,C4)');
  });
});

describe('shiftDimensionMap', () => {
  it('should shift keys at or after index on insert', () => {
    const map = new Map([
      [1, 50],
      [3, 80],
      [5, 120],
    ]);
    const result = shiftDimensionMap(map, 3, 1);

    expect(result.get(1)).toBe(50);
    expect(result.has(3)).toBe(false);
    expect(result.get(4)).toBe(80);
    expect(result.get(6)).toBe(120);
    expect(result.size).toBe(3);
  });

  it('should not shift keys before index on insert', () => {
    const map = new Map([
      [1, 50],
      [2, 80],
    ]);
    const result = shiftDimensionMap(map, 3, 1);

    expect(result.get(1)).toBe(50);
    expect(result.get(2)).toBe(80);
    expect(result.size).toBe(2);
  });

  it('should drop keys in deleted zone on delete', () => {
    const map = new Map([
      [1, 50],
      [2, 80],
      [3, 120],
    ]);
    const result = shiftDimensionMap(map, 2, -1);

    expect(result.get(1)).toBe(50);
    expect(result.get(2)).toBe(120); // key 3 shifted to 2
    expect(result.has(3)).toBe(false);
    expect(result.size).toBe(2);
  });

  it('should drop multiple keys in deleted zone', () => {
    const map = new Map([
      [2, 80],
      [3, 90],
      [5, 120],
    ]);
    const result = shiftDimensionMap(map, 2, -2);

    expect(result.has(2)).toBe(false);
    expect(result.get(3)).toBe(120); // key 5 shifted to 3
    expect(result.size).toBe(1);
  });

  it('should return empty map when all keys are in deleted zone', () => {
    const map = new Map([[2, 80]]);
    const result = shiftDimensionMap(map, 2, -1);

    expect(result.size).toBe(0);
  });

  it('should handle empty map', () => {
    const map = new Map<number, number>();
    const result = shiftDimensionMap(map, 2, 1);

    expect(result.size).toBe(0);
  });
});

describe('parseAbsRef / toAbsSref', () => {
  it('should round-trip A1 (no abs)', () => {
    const abs = parseAbsRef('A1');
    expect(abs).toEqual({ r: 1, c: 1, absCol: false, absRow: false });
    expect(toAbsSref(abs)).toBe('A1');
  });

  it('should round-trip $A1 (abs col only)', () => {
    const abs = parseAbsRef('$A1');
    expect(abs).toEqual({ r: 1, c: 1, absCol: true, absRow: false });
    expect(toAbsSref(abs)).toBe('$A1');
  });

  it('should round-trip A$1 (abs row only)', () => {
    const abs = parseAbsRef('A$1');
    expect(abs).toEqual({ r: 1, c: 1, absCol: false, absRow: true });
    expect(toAbsSref(abs)).toBe('A$1');
  });

  it('should round-trip $A$1 (both abs)', () => {
    const abs = parseAbsRef('$A$1');
    expect(abs).toEqual({ r: 1, c: 1, absCol: true, absRow: true });
    expect(toAbsSref(abs)).toBe('$A$1');
  });

  it('should handle multi-letter columns like $AB$10', () => {
    const abs = parseAbsRef('$AB$10');
    expect(abs.absCol).toBe(true);
    expect(abs.absRow).toBe(true);
    expect(abs.r).toBe(10);
    expect(abs.c).toBe(28); // AB = 28
    expect(toAbsSref(abs)).toBe('$AB$10');
  });
});

describe('absolute refs in relocateFormula', () => {
  it('should not shift absolute column', () => {
    expect(relocateFormula('=$A1+B2', 0, 1)).toBe('=$A1+C2');
  });

  it('should not shift absolute row', () => {
    expect(relocateFormula('=A$1+B2', 1, 0)).toBe('=A$1+B3');
  });

  it('should not shift fully absolute ref', () => {
    expect(relocateFormula('=$A$1+B2', 2, 1)).toBe('=$A$1+C4');
  });

  it('should preserve abs markers in range refs', () => {
    expect(relocateFormula('=SUM($A$1:B3)', 1, 1)).toBe('=SUM($A$1:C4)');
  });

  it('should preserve abs markers with zero delta', () => {
    expect(relocateFormula('=$A$1', 0, 0)).toBe('=$A$1');
  });
});

describe('absolute refs in shiftFormula', () => {
  it('should preserve abs markers while shifting', () => {
    // Insert row at 2: $A$1 stays at row 1 (before index), markers preserved
    expect(shiftFormula('=$A$1+A2', 'row', 2, 1)).toBe('=$A$1+A3');
  });

  it('should shift absolute ref value on insert (Excel behavior)', () => {
    // Insert row at 1: $A$1 shifts to $A$2 (value changes, markers stay)
    expect(shiftFormula('=$A$1', 'row', 1, 1)).toBe('=$A$2');
  });

  it('should preserve mixed abs markers in range', () => {
    expect(shiftFormula('=SUM($A2:B$5)', 'row', 2, 1)).toBe('=SUM($A3:B$6)');
  });
});

describe('absolute refs in moveFormula', () => {
  it('should preserve abs markers after move', () => {
    expect(moveFormula('=$A$1', 'row', 1, 1, 3)).toBe('=$A$2');
  });

  it('should preserve mixed abs markers', () => {
    // Moving row 1 (1 row) to before row 3: row 2 shifts backward to row 1
    expect(moveFormula('=$A1+B$2', 'row', 1, 1, 3)).toBe('=$A2+B$1');
  });
});

describe('absolute refs in redirectFormula', () => {
  it('should preserve abs markers after redirect', () => {
    const refMap = new Map<Sref, Sref>([['A1', 'B2']]);
    expect(redirectFormula('=$A$1', refMap)).toBe('=$B$2');
  });

  it('should preserve mixed abs markers after redirect', () => {
    // $A1 → redirect A1→C3: abs col flag preserved on new target C3 → $C3
    const refMap = new Map<Sref, Sref>([['A1', 'C3']]);
    expect(redirectFormula('=$A1', refMap)).toBe('=$C3');
  });

  it('should preserve abs markers in range redirect', () => {
    const refMap = new Map<Sref, Sref>([
      ['A1', 'B2'],
      ['C3', 'D4'],
    ]);
    expect(redirectFormula('=$A$1:$C$3', refMap)).toBe('=$B$2:$D$4');
  });
});

describe('cross-sheet refs in shift/move/relocate', () => {
  it('should NOT shift cross-sheet refs in shiftFormula', () => {
    expect(shiftFormula('=Sheet2!A1+A2', 'row', 2, 1)).toBe('=Sheet2!A1+A3');
  });

  it('should NOT shift cross-sheet range refs in shiftFormula', () => {
    expect(shiftFormula('=SUM(Sheet2!A1:A3)', 'row', 1, 1)).toBe(
      '=SUM(Sheet2!A1:A3)',
    );
  });

  it('should NOT relocate cross-sheet refs in relocateFormula', () => {
    expect(relocateFormula('=Sheet2!A1+A1', 1, 0)).toBe('=Sheet2!A1+A2');
  });

  it('should NOT relocate cross-sheet range refs in relocateFormula', () => {
    expect(relocateFormula('=SUM(Sheet2!A1:A3)+A1', 1, 0)).toBe(
      '=SUM(Sheet2!A1:A3)+A2',
    );
  });
});

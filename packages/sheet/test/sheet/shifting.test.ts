import { describe, it, expect } from 'vitest';
import { shiftRef, shiftSref, shiftFormula, shiftGrid, shiftDimensionMap } from '../../src/model/shifting';
import { Grid } from '../../src/model/types';

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

describe('shiftDimensionMap', () => {
  it('should shift keys at or after index on insert', () => {
    const map = new Map([[1, 50], [3, 80], [5, 120]]);
    const result = shiftDimensionMap(map, 3, 1);

    expect(result.get(1)).toBe(50);
    expect(result.has(3)).toBe(false);
    expect(result.get(4)).toBe(80);
    expect(result.get(6)).toBe(120);
    expect(result.size).toBe(3);
  });

  it('should not shift keys before index on insert', () => {
    const map = new Map([[1, 50], [2, 80]]);
    const result = shiftDimensionMap(map, 3, 1);

    expect(result.get(1)).toBe(50);
    expect(result.get(2)).toBe(80);
    expect(result.size).toBe(2);
  });

  it('should drop keys in deleted zone on delete', () => {
    const map = new Map([[1, 50], [2, 80], [3, 120]]);
    const result = shiftDimensionMap(map, 2, -1);

    expect(result.get(1)).toBe(50);
    expect(result.get(2)).toBe(120); // key 3 shifted to 2
    expect(result.has(3)).toBe(false);
    expect(result.size).toBe(2);
  });

  it('should drop multiple keys in deleted zone', () => {
    const map = new Map([[2, 80], [3, 90], [5, 120]]);
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

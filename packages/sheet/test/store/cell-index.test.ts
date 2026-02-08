import { describe, it, expect } from 'vitest';
import { CellIndex } from '../../src/store/cell-index';

describe('CellIndex', () => {
  it('should add and check cell existence', () => {
    const index = new CellIndex();
    index.add(1, 1);
    index.add(2, 3);

    expect(index.has(1, 1)).toBe(true);
    expect(index.has(2, 3)).toBe(true);
    expect(index.has(1, 2)).toBe(false);
    expect(index.has(3, 1)).toBe(false);
  });

  it('should remove cells', () => {
    const index = new CellIndex();
    index.add(1, 1);
    index.add(1, 2);
    index.remove(1, 1);

    expect(index.has(1, 1)).toBe(false);
    expect(index.has(1, 2)).toBe(true);
    expect(index.size).toBe(1);
  });

  it('should clean up empty sets when removing last cell in row/col', () => {
    const index = new CellIndex();
    index.add(5, 3);
    index.remove(5, 3);

    expect(index.getOccupiedColsInRow(5)).toBeUndefined();
    expect(index.getOccupiedRowsInCol(3)).toBeUndefined();
    expect(index.size).toBe(0);
  });

  it('should handle removing non-existent cell gracefully', () => {
    const index = new CellIndex();
    index.remove(99, 99);
    expect(index.size).toBe(0);
  });

  it('should clear all entries', () => {
    const index = new CellIndex();
    index.add(1, 1);
    index.add(2, 2);
    index.add(3, 3);
    index.clear();

    expect(index.has(1, 1)).toBe(false);
    expect(index.has(2, 2)).toBe(false);
    expect(index.size).toBe(0);
  });

  it('should rebuild from entries', () => {
    const index = new CellIndex();
    index.add(1, 1);
    index.add(99, 99);

    index.rebuild([
      [2, 3],
      [4, 5],
    ]);

    expect(index.has(1, 1)).toBe(false);
    expect(index.has(99, 99)).toBe(false);
    expect(index.has(2, 3)).toBe(true);
    expect(index.has(4, 5)).toBe(true);
    expect(index.size).toBe(2);
  });

  it('should report correct size', () => {
    const index = new CellIndex();
    expect(index.size).toBe(0);

    index.add(1, 1);
    expect(index.size).toBe(1);

    index.add(1, 2);
    index.add(2, 1);
    expect(index.size).toBe(3);

    // Adding duplicate should not increase size
    index.add(1, 1);
    expect(index.size).toBe(3);
  });

  describe('cellsInRange', () => {
    it('should yield only cells within range', () => {
      const index = new CellIndex();
      index.add(1, 1);
      index.add(2, 2);
      index.add(3, 3);
      index.add(5, 5);

      const cells = Array.from(
        index.cellsInRange([{ r: 1, c: 1 }, { r: 3, c: 3 }]),
      );

      expect(cells).toHaveLength(3);
      expect(cells).toContainEqual([1, 1]);
      expect(cells).toContainEqual([2, 2]);
      expect(cells).toContainEqual([3, 3]);
    });

    it('should yield nothing for empty range', () => {
      const index = new CellIndex();
      index.add(1, 1);

      const cells = Array.from(
        index.cellsInRange([{ r: 10, c: 10 }, { r: 20, c: 20 }]),
      );
      expect(cells).toHaveLength(0);
    });

    it('should filter by both row and column', () => {
      const index = new CellIndex();
      index.add(2, 1);
      index.add(2, 5);
      index.add(2, 10);

      const cells = Array.from(
        index.cellsInRange([{ r: 2, c: 3 }, { r: 2, c: 8 }]),
      );
      expect(cells).toHaveLength(1);
      expect(cells).toContainEqual([2, 5]);
    });

    it('should handle single-cell range', () => {
      const index = new CellIndex();
      index.add(3, 3);

      const cells = Array.from(
        index.cellsInRange([{ r: 3, c: 3 }, { r: 3, c: 3 }]),
      );
      expect(cells).toHaveLength(1);
      expect(cells).toContainEqual([3, 3]);
    });
  });

  describe('hasAnyInRange', () => {
    it('should return true when cells exist in range', () => {
      const index = new CellIndex();
      index.add(5, 5);

      expect(
        index.hasAnyInRange([{ r: 1, c: 1 }, { r: 10, c: 10 }]),
      ).toBe(true);
    });

    it('should return false when no cells in range', () => {
      const index = new CellIndex();
      index.add(1, 1);

      expect(
        index.hasAnyInRange([{ r: 5, c: 5 }, { r: 10, c: 10 }]),
      ).toBe(false);
    });

    it('should return false for empty index', () => {
      const index = new CellIndex();
      expect(
        index.hasAnyInRange([{ r: 1, c: 1 }, { r: 100, c: 100 }]),
      ).toBe(false);
    });
  });

  describe('getOccupiedColsInRow / getOccupiedRowsInCol', () => {
    it('should return occupied columns for a row', () => {
      const index = new CellIndex();
      index.add(1, 2);
      index.add(1, 5);
      index.add(1, 8);

      const cols = index.getOccupiedColsInRow(1);
      expect(cols).toBeDefined();
      expect(cols!.size).toBe(3);
      expect(cols!.has(2)).toBe(true);
      expect(cols!.has(5)).toBe(true);
      expect(cols!.has(8)).toBe(true);
    });

    it('should return occupied rows for a column', () => {
      const index = new CellIndex();
      index.add(3, 1);
      index.add(7, 1);

      const rows = index.getOccupiedRowsInCol(1);
      expect(rows).toBeDefined();
      expect(rows!.size).toBe(2);
      expect(rows!.has(3)).toBe(true);
      expect(rows!.has(7)).toBe(true);
    });

    it('should return undefined for empty row/col', () => {
      const index = new CellIndex();
      expect(index.getOccupiedColsInRow(1)).toBeUndefined();
      expect(index.getOccupiedRowsInCol(1)).toBeUndefined();
    });
  });
});

import { describe, it, expect } from 'vitest';
import { CellIndex } from '../../src/store/cell-index';
import { findEdgeWithIndex } from '../../src/store/find-edge';
import { Range } from '../../src/model/types';

// Standard dimension: rows 1..100, cols 1..26
const dim: Range = [{ r: 1, c: 1 }, { r: 100, c: 26 }];

function makeIndex(cells: Array<[number, number]>): CellIndex {
  const index = new CellIndex();
  for (const [r, c] of cells) {
    index.add(r, c);
  }
  return index;
}

describe('findEdgeWithIndex', () => {
  describe('empty sheet', () => {
    it('should go to boundary in all directions', () => {
      const index = makeIndex([]);

      expect(findEdgeWithIndex(index, { r: 5, c: 5 }, 'down', dim)).toEqual({ r: 100, c: 5 });
      expect(findEdgeWithIndex(index, { r: 5, c: 5 }, 'up', dim)).toEqual({ r: 1, c: 5 });
      expect(findEdgeWithIndex(index, { r: 5, c: 5 }, 'right', dim)).toEqual({ r: 5, c: 26 });
      expect(findEdgeWithIndex(index, { r: 5, c: 5 }, 'left', dim)).toEqual({ r: 5, c: 1 });
    });
  });

  describe('walk to end of consecutive block', () => {
    it('should walk down to end of block', () => {
      // Cells at rows 3,4,5 in col 1
      const index = makeIndex([[3, 1], [4, 1], [5, 1]]);
      const result = findEdgeWithIndex(index, { r: 3, c: 1 }, 'down', dim);
      expect(result).toEqual({ r: 5, c: 1 });
    });

    it('should walk up to end of block', () => {
      const index = makeIndex([[3, 1], [4, 1], [5, 1]]);
      const result = findEdgeWithIndex(index, { r: 5, c: 1 }, 'up', dim);
      expect(result).toEqual({ r: 3, c: 1 });
    });

    it('should walk right to end of block', () => {
      const index = makeIndex([[1, 3], [1, 4], [1, 5]]);
      const result = findEdgeWithIndex(index, { r: 1, c: 3 }, 'right', dim);
      expect(result).toEqual({ r: 1, c: 5 });
    });

    it('should walk left to end of block', () => {
      const index = makeIndex([[1, 3], [1, 4], [1, 5]]);
      const result = findEdgeWithIndex(index, { r: 1, c: 5 }, 'left', dim);
      expect(result).toEqual({ r: 1, c: 3 });
    });
  });

  describe('jump over gap to next block', () => {
    it('should jump down over gap', () => {
      // Two blocks: rows 2-3 and rows 7-8, col 1
      const index = makeIndex([[2, 1], [3, 1], [7, 1], [8, 1]]);
      // At end of first block → jump to start of next block
      const result = findEdgeWithIndex(index, { r: 3, c: 1 }, 'down', dim);
      expect(result).toEqual({ r: 7, c: 1 });
    });

    it('should jump up over gap', () => {
      const index = makeIndex([[2, 1], [3, 1], [7, 1], [8, 1]]);
      const result = findEdgeWithIndex(index, { r: 7, c: 1 }, 'up', dim);
      expect(result).toEqual({ r: 3, c: 1 });
    });

    it('should jump right over gap', () => {
      const index = makeIndex([[1, 2], [1, 3], [1, 10], [1, 11]]);
      const result = findEdgeWithIndex(index, { r: 1, c: 3 }, 'right', dim);
      expect(result).toEqual({ r: 1, c: 10 });
    });
  });

  describe('from empty cell', () => {
    it('should jump to next data block going down', () => {
      const index = makeIndex([[5, 1], [6, 1]]);
      const result = findEdgeWithIndex(index, { r: 1, c: 1 }, 'down', dim);
      expect(result).toEqual({ r: 5, c: 1 });
    });

    it('should jump to next data block going up', () => {
      const index = makeIndex([[2, 1], [3, 1]]);
      const result = findEdgeWithIndex(index, { r: 10, c: 1 }, 'up', dim);
      expect(result).toEqual({ r: 3, c: 1 });
    });

    it('should go to boundary if no data ahead', () => {
      const index = makeIndex([[2, 1]]);
      const result = findEdgeWithIndex(index, { r: 5, c: 1 }, 'down', dim);
      expect(result).toEqual({ r: 100, c: 1 });
    });
  });

  describe('single cell', () => {
    it('should go to boundary when already at the only cell', () => {
      const index = makeIndex([[5, 5]]);

      expect(findEdgeWithIndex(index, { r: 5, c: 5 }, 'down', dim)).toEqual({ r: 100, c: 5 });
      expect(findEdgeWithIndex(index, { r: 5, c: 5 }, 'up', dim)).toEqual({ r: 1, c: 5 });
      expect(findEdgeWithIndex(index, { r: 5, c: 5 }, 'right', dim)).toEqual({ r: 5, c: 26 });
      expect(findEdgeWithIndex(index, { r: 5, c: 5 }, 'left', dim)).toEqual({ r: 5, c: 1 });
    });
  });

  describe('at boundary', () => {
    it('should stay at boundary when already at edge', () => {
      const index = makeIndex([]);
      const result = findEdgeWithIndex(index, { r: 1, c: 1 }, 'up', dim);
      expect(result).toEqual({ r: 1, c: 1 });
    });

    it('should stay at boundary going left from col 1', () => {
      const index = makeIndex([]);
      const result = findEdgeWithIndex(index, { r: 1, c: 1 }, 'left', dim);
      expect(result).toEqual({ r: 1, c: 1 });
    });
  });

  describe('middle of block walks to end', () => {
    it('should walk from middle to end of block going down', () => {
      const index = makeIndex([[1, 1], [2, 1], [3, 1], [4, 1], [5, 1]]);
      const result = findEdgeWithIndex(index, { r: 3, c: 1 }, 'down', dim);
      expect(result).toEqual({ r: 5, c: 1 });
    });

    it('should walk from middle to end of block going up', () => {
      const index = makeIndex([[1, 1], [2, 1], [3, 1], [4, 1], [5, 1]]);
      const result = findEdgeWithIndex(index, { r: 3, c: 1 }, 'up', dim);
      expect(result).toEqual({ r: 1, c: 1 });
    });
  });
});

import { describe, it, expect } from 'vitest';
import { DimensionIndex } from '../../src/model/dimensions';

describe('DimensionIndex', () => {
  describe('getSize', () => {
    it('should return default size when no custom size is set', () => {
      const dim = new DimensionIndex(100);
      expect(dim.getSize(1)).toBe(100);
      expect(dim.getSize(5)).toBe(100);
    });

    it('should return custom size when set', () => {
      const dim = new DimensionIndex(100);
      dim.setSize(3, 200);
      expect(dim.getSize(3)).toBe(200);
      expect(dim.getSize(1)).toBe(100);
    });

    it('should clear custom size when set to default', () => {
      const dim = new DimensionIndex(100);
      dim.setSize(3, 200);
      dim.setSize(3, 100);
      expect(dim.hasCustomSizes()).toBe(false);
    });
  });

  describe('getOffset', () => {
    it('should compute offset with all default sizes', () => {
      const dim = new DimensionIndex(100);
      expect(dim.getOffset(1)).toBe(0);
      expect(dim.getOffset(2)).toBe(100);
      expect(dim.getOffset(3)).toBe(200);
      expect(dim.getOffset(5)).toBe(400);
    });

    it('should account for custom sizes before index', () => {
      const dim = new DimensionIndex(100);
      dim.setSize(2, 200);
      // index 1: offset 0
      // index 2: offset 100 (default for 1)
      // index 3: offset 100 + 200 = 300 (custom for 2)
      expect(dim.getOffset(1)).toBe(0);
      expect(dim.getOffset(2)).toBe(100);
      expect(dim.getOffset(3)).toBe(300);
      expect(dim.getOffset(4)).toBe(400);
    });

    it('should handle multiple custom sizes', () => {
      const dim = new DimensionIndex(23);
      dim.setSize(2, 50);
      dim.setSize(4, 10);
      // index 1: 0
      // index 2: 23
      // index 3: 23 + 50 = 73
      // index 4: 73 + 23 = 96
      // index 5: 96 + 10 = 106
      expect(dim.getOffset(1)).toBe(0);
      expect(dim.getOffset(2)).toBe(23);
      expect(dim.getOffset(3)).toBe(73);
      expect(dim.getOffset(4)).toBe(96);
      expect(dim.getOffset(5)).toBe(106);
    });
  });

  describe('findIndex', () => {
    it('should clamp negative offsets to index 1', () => {
      const dim = new DimensionIndex(100);
      dim.setSize(2, 200);
      expect(dim.findIndex(-1)).toBe(1);
      expect(dim.findIndex(-999)).toBe(1);
    });

    it('should find index with all default sizes', () => {
      const dim = new DimensionIndex(100);
      expect(dim.findIndex(0)).toBe(1);
      expect(dim.findIndex(50)).toBe(1);
      expect(dim.findIndex(100)).toBe(2);
      expect(dim.findIndex(250)).toBe(3);
    });

    it('should find index with custom sizes', () => {
      const dim = new DimensionIndex(100);
      dim.setSize(2, 200);
      // index 1: [0, 100)
      // index 2: [100, 300)
      // index 3: [300, 400)
      expect(dim.findIndex(0)).toBe(1);
      expect(dim.findIndex(99)).toBe(1);
      expect(dim.findIndex(100)).toBe(2);
      expect(dim.findIndex(299)).toBe(2);
      expect(dim.findIndex(300)).toBe(3);
      expect(dim.findIndex(399)).toBe(3);
      expect(dim.findIndex(400)).toBe(4);
    });

    it('should handle custom size at index 1', () => {
      const dim = new DimensionIndex(100);
      dim.setSize(1, 50);
      // index 1: [0, 50)
      // index 2: [50, 150)
      expect(dim.findIndex(0)).toBe(1);
      expect(dim.findIndex(49)).toBe(1);
      expect(dim.findIndex(50)).toBe(2);
      expect(dim.findIndex(149)).toBe(2);
      expect(dim.findIndex(150)).toBe(3);
    });
  });

  describe('shift', () => {
    it('should shift custom sizes on insert', () => {
      const dim = new DimensionIndex(100);
      dim.setSize(3, 200);
      dim.setSize(5, 150);

      dim.shift(3, 1);

      // Index 3 custom size should now be at 4
      expect(dim.getSize(3)).toBe(100);
      expect(dim.getSize(4)).toBe(200);
      // Index 5 custom size should now be at 6
      expect(dim.getSize(5)).toBe(100);
      expect(dim.getSize(6)).toBe(150);
    });

    it('should not shift custom sizes before insert index', () => {
      const dim = new DimensionIndex(100);
      dim.setSize(1, 50);
      dim.setSize(5, 200);

      dim.shift(3, 2);

      expect(dim.getSize(1)).toBe(50);
      expect(dim.getSize(7)).toBe(200);
    });

    it('should remove custom sizes in deleted zone', () => {
      const dim = new DimensionIndex(100);
      dim.setSize(2, 200);
      dim.setSize(3, 150);
      dim.setSize(5, 180);

      dim.shift(2, -2);

      // Index 2 and 3 deleted
      expect(dim.getSize(2)).toBe(100);
      expect(dim.getSize(3)).toBe(180); // was index 5, shifted by -2
    });

    it('should shift custom sizes after deleted zone', () => {
      const dim = new DimensionIndex(100);
      dim.setSize(5, 200);

      dim.shift(2, -1);

      expect(dim.getSize(4)).toBe(200);
      expect(dim.getSize(5)).toBe(100);
    });
  });
});

import { BadRequestException } from '@nestjs/common';
import { parseFilter, parsePivot } from './worksheet-filter-pivot';

const FILTER = { startRow: 0, endRow: 5, startCol: 0, endCol: 3, columns: {} };
const PIVOT = {
  id: 'p1',
  sourceTabId: 'tab-1',
  sourceRange: 'A1:C10',
  rowFields: [],
  columnFields: [],
  valueFields: [],
  filterFields: [],
  showTotals: { rows: true, columns: false },
};

describe('worksheet-filter-pivot validators', () => {
  describe('parseFilter', () => {
    it('accepts a valid filter', () => {
      expect(parseFilter({ filter: FILTER })).toMatchObject({
        startRow: 0,
        endRow: 5,
        startCol: 0,
        endCol: 3,
      });
    });
    it('returns null to clear (null or missing)', () => {
      expect(parseFilter({ filter: null })).toBeNull();
      expect(parseFilter({})).toBeNull();
    });
    it('rejects bad range bounds', () => {
      expect(() =>
        parseFilter({ filter: { ...FILTER, startRow: -1 } }),
      ).toThrow(BadRequestException);
    });
  });

  describe('parsePivot', () => {
    it('accepts a valid pivot', () => {
      expect(parsePivot({ pivot: PIVOT })).toMatchObject({
        id: 'p1',
        sourceTabId: 'tab-1',
        sourceRange: 'A1:C10',
      });
    });
    it('returns null to clear', () => {
      expect(parsePivot({ pivot: null })).toBeNull();
    });
    it('rejects a missing string field or non-array field', () => {
      expect(() => parsePivot({ pivot: { ...PIVOT, id: '' } })).toThrow(
        BadRequestException,
      );
      expect(() => parsePivot({ pivot: { ...PIVOT, rowFields: 'x' } })).toThrow(
        BadRequestException,
      );
    });
  });
});

import { BadRequestException } from '@nestjs/common';
import { parseFilter, parsePivot } from './worksheet-filter-pivot';

const FILTER = {
  startRow: 0,
  endRow: 5,
  startCol: 0,
  endCol: 3,
  columns: {},
  hiddenRows: [],
};
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
      // toEqual, not toMatchObject: a field the parser drops has to fail here.
      expect(parseFilter({ filter: FILTER })).toEqual({
        startRow: 0,
        endRow: 5,
        startCol: 0,
        endCol: 3,
        columns: {},
        hiddenRows: [],
      });
    });

    it('preserves hiddenRows, which is stored and never recomputed', () => {
      const parsed = parseFilter({
        filter: {
          ...FILTER,
          columns: { '2': { op: 'in', values: ['a'] } },
          hiddenRows: [3, 4, 7],
        },
      });
      expect(parsed?.hiddenRows).toEqual([3, 4, 7]);
      expect(parsed?.columns).toEqual({
        '2': { op: 'in', values: ['a'] },
      });
    });

    it('defaults an absent hiddenRows to an empty array', () => {
      const withoutHidden = {
        startRow: 0,
        endRow: 5,
        startCol: 0,
        endCol: 3,
        columns: {},
      };
      expect(parseFilter({ filter: withoutHidden })?.hiddenRows).toEqual([]);
    });

    it('rejects a non-array or non-integer hiddenRows', () => {
      expect(() =>
        parseFilter({ filter: { ...FILTER, hiddenRows: 3 } }),
      ).toThrow(BadRequestException);
      expect(() =>
        parseFilter({ filter: { ...FILTER, hiddenRows: [1, -2] } }),
      ).toThrow(BadRequestException);
      expect(() =>
        parseFilter({ filter: { ...FILTER, hiddenRows: [1, 2.5] } }),
      ).toThrow(BadRequestException);
      expect(() =>
        parseFilter({ filter: { ...FILTER, hiddenRows: ['3'] } }),
      ).toThrow(BadRequestException);
    });

    it('returns null only for an explicit null', () => {
      expect(parseFilter({ filter: null })).toBeNull();
    });

    it('rejects an omitted filter key instead of clearing', () => {
      // A body-less PUT (Express hands Nest `{}`) or a typo'd key must not
      // silently delete the stored filter.
      expect(() => parseFilter({})).toThrow(BadRequestException);
      expect(() => parseFilter({ fitler: FILTER })).toThrow(
        BadRequestException,
      );
      expect(() => parseFilter({ filter: undefined })).toThrow(
        BadRequestException,
      );
    });

    it('rejects bad range bounds', () => {
      expect(() =>
        parseFilter({ filter: { ...FILTER, startRow: -1 } }),
      ).toThrow(BadRequestException);
    });

    it('rejects an inverted range', () => {
      expect(() =>
        parseFilter({ filter: { ...FILTER, startRow: 5, endRow: 0 } }),
      ).toThrow(BadRequestException);
      expect(() =>
        parseFilter({ filter: { ...FILTER, startCol: 3, endCol: 1 } }),
      ).toThrow(BadRequestException);
      // A degenerate single row/column range is still a valid range.
      expect(() =>
        parseFilter({
          filter: { ...FILTER, startRow: 2, endRow: 2, startCol: 1, endCol: 1 },
        }),
      ).not.toThrow();
    });
  });

  describe('parsePivot', () => {
    it('accepts a valid pivot', () => {
      expect(parsePivot({ pivot: PIVOT })).toEqual(PIVOT);
    });
    it('returns null only for an explicit null', () => {
      expect(parsePivot({ pivot: null })).toBeNull();
    });
    it('rejects an omitted pivot key instead of clearing', () => {
      expect(() => parsePivot({})).toThrow(BadRequestException);
      expect(() => parsePivot({ pivot: undefined })).toThrow(
        BadRequestException,
      );
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

import { describe, expect, it } from 'vitest';
import { calculatePivot } from '../../src/model/pivot/calculate';
import { materialize } from '../../src/model/pivot/materialize';
import { parseSourceData } from '../../src/model/pivot/parse';
import type { Grid, PivotTableDefinition, Sref } from '../../src/model/core/types';
import { toSref, parseRange } from '../../src/model/core/coordinates';

/**
 * End-to-end pivot table tests that exercise the full pipeline:
 *   source grid → parseSourceData → calculatePivot → materialize → cells
 *
 * Uses a realistic sales dataset with multiple dimensions.
 */

// --- Sample data: sales by region, product, quarter ---
//
//   | Region | Product | Quarter | Revenue | Units |
//   |--------|---------|---------|---------|-------|
//   | East   | Widget  | Q1      | 1000    | 10    |
//   | East   | Widget  | Q2      | 1200    | 12    |
//   | East   | Gadget  | Q1      | 800     | 5     |
//   | East   | Gadget  | Q2      | 900     | 6     |
//   | West   | Widget  | Q1      | 1500    | 15    |
//   | West   | Widget  | Q2      | 1800    | 18    |
//   | West   | Gadget  | Q1      | 600     | 4     |
//   | West   | Gadget  | Q2      | 700     | 5     |

function buildGrid(data: string[][]): Grid {
  const grid: Grid = new Map();
  for (let r = 0; r < data.length; r++) {
    for (let c = 0; c < data[r].length; c++) {
      if (data[r][c] !== '') {
        grid.set(toSref({ r: r + 1, c: c + 1 }), { v: data[r][c] });
      }
    }
  }
  return grid;
}

const salesData = buildGrid([
  ['Region', 'Product', 'Quarter', 'Revenue', 'Units'],
  ['East', 'Widget', 'Q1', '1000', '10'],
  ['East', 'Widget', 'Q2', '1200', '12'],
  ['East', 'Gadget', 'Q1', '800', '5'],
  ['East', 'Gadget', 'Q2', '900', '6'],
  ['West', 'Widget', 'Q1', '1500', '15'],
  ['West', 'Widget', 'Q2', '1800', '18'],
  ['West', 'Gadget', 'Q1', '600', '4'],
  ['West', 'Gadget', 'Q2', '700', '5'],
]);

const sourceRange = 'A1:E9';

function cellValue(grid: Grid, r: number, c: number): string | undefined {
  return grid.get(toSref({ r, c }) as Sref)?.v;
}

describe('Pivot table end-to-end', () => {
  describe('parseSourceData', () => {
    it('extracts headers and records from source grid', () => {
      const range = parseRange(sourceRange);
      const { headers, records } = parseSourceData(salesData, range);
      expect(headers).toEqual(['Region', 'Product', 'Quarter', 'Revenue', 'Units']);
      expect(records).toHaveLength(8);
      expect(records[0]).toEqual(['East', 'Widget', 'Q1', '1000', '10']);
      expect(records[7]).toEqual(['West', 'Gadget', 'Q2', '700', '5']);
    });
  });

  describe('single row field + SUM value', () => {
    const def: PivotTableDefinition = {
      id: 'e2e-1',
      sourceTabId: 'tab-1',
      sourceRange,
      rowFields: [{ sourceColumn: 0, label: 'Region' }],
      columnFields: [],
      valueFields: [{ sourceColumn: 3, label: 'Revenue', aggregation: 'SUM' }],
      filterFields: [],
      showTotals: { rows: true, columns: false },
    };

    it('groups by Region and sums Revenue', () => {
      const result = calculatePivot(salesData, def);
      // Header row (first cell is empty, second has value field label)
      expect(result.cells[0][0].value).toBe('');
      expect(result.cells[0][1].value).toBe('SUM of Revenue');
      // East: 1000+1200+800+900 = 3900
      expect(result.cells[1][0].value).toBe('East');
      expect(result.cells[1][1].value).toBe('3900');
      // West: 1500+1800+600+700 = 4600
      expect(result.cells[2][0].value).toBe('West');
      expect(result.cells[2][1].value).toBe('4600');
      // Grand total: 8500
      expect(result.cells[3][0].value).toBe('Grand Total');
      expect(result.cells[3][1].value).toBe('8500');
    });

    it('materializes to styled cells', () => {
      const result = calculatePivot(salesData, def);
      const grid = materialize(result);
      // Column header should be bold
      expect(cellValue(grid, 1, 2)).toBe('SUM of Revenue');
      expect(grid.get(toSref({ r: 1, c: 2 }) as Sref)?.s?.b).toBe(true);
      // Row header should be bold
      expect(cellValue(grid, 2, 1)).toBe('East');
      expect(grid.get(toSref({ r: 2, c: 1 }) as Sref)?.s?.b).toBe(true);
      // Value cell should not be bold
      expect(cellValue(grid, 2, 2)).toBe('3900');
      const valueStyle = grid.get(toSref({ r: 2, c: 2 }) as Sref)?.s;
      expect(valueStyle?.b).toBeUndefined();
      // Grand total should be bold with gray background
      expect(cellValue(grid, 4, 1)).toBe('Grand Total');
      expect(grid.get(toSref({ r: 4, c: 1 }) as Sref)?.s?.b).toBe(true);
      expect(grid.get(toSref({ r: 4, c: 1 }) as Sref)?.s?.bg).toBeUndefined();
    });
  });

  describe('row + column fields (cross-tab)', () => {
    const def: PivotTableDefinition = {
      id: 'e2e-2',
      sourceTabId: 'tab-1',
      sourceRange,
      rowFields: [{ sourceColumn: 0, label: 'Region' }],
      columnFields: [{ sourceColumn: 2, label: 'Quarter' }],
      valueFields: [{ sourceColumn: 3, label: 'Revenue', aggregation: 'SUM' }],
      filterFields: [],
      showTotals: { rows: true, columns: true },
    };

    it('creates a cross-tab with row/column totals', () => {
      const result = calculatePivot(salesData, def);
      // Column headers (sorted ascending by default)
      expect(result.cells[0][1].value).toBe('Q1');
      expect(result.cells[0][2].value).toBe('Q2');
      // East Q1: 1000+800=1800, East Q2: 1200+900=2100
      expect(result.cells[1][0].value).toBe('East');
      expect(result.cells[1][1].value).toBe('1800');
      expect(result.cells[1][2].value).toBe('2100');
      // West Q1: 1500+600=2100, West Q2: 1800+700=2500
      expect(result.cells[2][0].value).toBe('West');
      expect(result.cells[2][1].value).toBe('2100');
      expect(result.cells[2][2].value).toBe('2500');
    });
  });

  describe('multi-level row fields', () => {
    const def: PivotTableDefinition = {
      id: 'e2e-3',
      sourceTabId: 'tab-1',
      sourceRange,
      rowFields: [
        { sourceColumn: 0, label: 'Region' },
        { sourceColumn: 1, label: 'Product' },
      ],
      columnFields: [],
      valueFields: [{ sourceColumn: 3, label: 'Revenue', aggregation: 'SUM' }],
      filterFields: [],
      showTotals: { rows: false, columns: false },
    };

    it('nests Product under Region with joined labels', () => {
      const result = calculatePivot(salesData, def);
      // Multi-level row fields produce "Region / Product" labels
      const rows = result.cells.slice(1); // skip header
      const rowLabels = rows.map((r) => r[0].value);
      expect(rowLabels).toContain('East / Gadget');
      expect(rowLabels).toContain('East / Widget');
      expect(rowLabels).toContain('West / Gadget');
      expect(rowLabels).toContain('West / Widget');

      // East > Gadget: 800+900=1700
      const eastGadget = rows.find((r) => r[0].value === 'East / Gadget');
      expect(eastGadget?.[1].value).toBe('1700');
      // West > Widget: 1500+1800=3300
      const westWidget = rows.find((r) => r[0].value === 'West / Widget');
      expect(westWidget?.[1].value).toBe('3300');
    });
  });

  describe('multiple aggregations', () => {
    const def: PivotTableDefinition = {
      id: 'e2e-4',
      sourceTabId: 'tab-1',
      sourceRange,
      rowFields: [{ sourceColumn: 0, label: 'Region' }],
      columnFields: [],
      valueFields: [
        { sourceColumn: 3, label: 'Revenue', aggregation: 'SUM' },
        { sourceColumn: 3, label: 'Revenue', aggregation: 'AVERAGE' },
        { sourceColumn: 4, label: 'Units', aggregation: 'COUNT' },
      ],
      filterFields: [],
      showTotals: { rows: false, columns: false },
    };

    it('calculates SUM, AVERAGE, COUNT side by side', () => {
      const result = calculatePivot(salesData, def);
      // Headers
      expect(result.cells[0][1].value).toBe('SUM of Revenue');
      expect(result.cells[0][2].value).toBe('AVERAGE of Revenue');
      expect(result.cells[0][3].value).toBe('COUNT of Units');
      // East: SUM=3900, AVG=975, COUNT=4
      expect(result.cells[1][1].value).toBe('3900');
      expect(result.cells[1][2].value).toBe('975');
      expect(result.cells[1][3].value).toBe('4');
    });
  });

  describe('filter + sort', () => {
    it('filters out rows and respects descending sort', () => {
      const def: PivotTableDefinition = {
        id: 'e2e-5',
        sourceTabId: 'tab-1',
        sourceRange,
        rowFields: [{ sourceColumn: 1, label: 'Product', sort: 'desc' }],
        columnFields: [],
        valueFields: [{ sourceColumn: 4, label: 'Units', aggregation: 'SUM' }],
        filterFields: [{ sourceColumn: 0, label: 'Region', hiddenValues: ['West'] }],
        showTotals: { rows: false, columns: false },
      };
      const result = calculatePivot(salesData, def);
      // Only East data, descending Product order: Widget, Gadget
      expect(result.cells[1][0].value).toBe('Widget');
      expect(result.cells[2][0].value).toBe('Gadget');
      // East Widget units: 10+12=22
      expect(result.cells[1][1].value).toBe('22');
      // East Gadget units: 5+6=11
      expect(result.cells[2][1].value).toBe('11');
    });
  });

  describe('no totals', () => {
    it('omits grand total rows/columns when disabled', () => {
      const def: PivotTableDefinition = {
        id: 'e2e-6',
        sourceTabId: 'tab-1',
        sourceRange,
        rowFields: [{ sourceColumn: 0, label: 'Region' }],
        columnFields: [{ sourceColumn: 2, label: 'Quarter' }],
        valueFields: [{ sourceColumn: 3, label: 'Revenue', aggregation: 'SUM' }],
        filterFields: [],
        showTotals: { rows: false, columns: false },
      };
      const result = calculatePivot(salesData, def);
      // 1 header + 2 data rows = 3 (no grand total row)
      expect(result.cells).toHaveLength(3);
      // 1 label col + 2 quarter cols = 3 (no grand total column)
      expect(result.cells[0]).toHaveLength(3);
    });
  });

  describe('empty value fields', () => {
    it('returns empty result when no value fields', () => {
      const def: PivotTableDefinition = {
        id: 'e2e-7',
        sourceTabId: 'tab-1',
        sourceRange,
        rowFields: [{ sourceColumn: 0, label: 'Region' }],
        columnFields: [],
        valueFields: [],
        filterFields: [],
        showTotals: { rows: false, columns: false },
      };
      const result = calculatePivot(salesData, def);
      expect(result.cells).toHaveLength(0);
      expect(result.rowCount).toBe(0);
      expect(result.colCount).toBe(0);
    });
  });
});

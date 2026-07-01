import { describe, expect, it } from 'vitest';
import { calculatePivot } from '../../src/model/pivot/calculate';
import type {
  Cell,
  Grid,
  PivotTableDefinition,
} from '../../src/model/core/types';
import { toSref } from '../../src/model/core/coordinates';

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

describe('calculatePivot', () => {
  const sourceGrid = buildGrid([
    ['Dept', 'Quarter', 'Revenue'],
    ['Eng', 'Q1', '100'],
    ['Sales', 'Q1', '200'],
    ['Eng', 'Q2', '150'],
    ['Sales', 'Q2', '250'],
  ]);

  it('calculates pivot with row and column fields', () => {
    const def: PivotTableDefinition = {
      id: 'p1', sourceTabId: 'tab-1', sourceRange: 'A1:C5',
      rowFields: [{ sourceColumn: 0, label: 'Dept' }],
      columnFields: [{ sourceColumn: 1, label: 'Quarter' }],
      valueFields: [{ sourceColumn: 2, label: 'Revenue', aggregation: 'SUM' }],
      filterFields: [],
      showTotals: { rows: true, columns: true },
    };
    const result = calculatePivot(sourceGrid, def);
    expect(result.cells[0][0].value).toBe('');
    expect(result.cells[0][1].value).toBe('Q1');
    expect(result.cells[0][2].value).toBe('Q2');
    expect(result.cells[1][0].value).toBe('Eng');
    expect(result.cells[1][1].value).toBe('100');
    expect(result.cells[1][2].value).toBe('150');
    expect(result.cells[2][0].value).toBe('Sales');
    expect(result.cells[2][1].value).toBe('200');
  });

  it('calculates pivot with rows only', () => {
    const def: PivotTableDefinition = {
      id: 'p2', sourceTabId: 'tab-1', sourceRange: 'A1:C5',
      rowFields: [{ sourceColumn: 0, label: 'Dept' }],
      columnFields: [],
      valueFields: [{ sourceColumn: 2, label: 'Revenue', aggregation: 'SUM' }],
      filterFields: [],
      showTotals: { rows: true, columns: false },
    };
    const result = calculatePivot(sourceGrid, def);
    expect(result.cells[0][1].value).toBe('SUM of Revenue');
    expect(result.cells[1][0].value).toBe('Eng');
    expect(result.cells[1][1].value).toBe('250');
    expect(result.cells[2][0].value).toBe('Sales');
    expect(result.cells[2][1].value).toBe('450');
  });

  it('applies filters before calculation', () => {
    const def: PivotTableDefinition = {
      id: 'p3', sourceTabId: 'tab-1', sourceRange: 'A1:C5',
      rowFields: [{ sourceColumn: 0, label: 'Dept' }],
      columnFields: [],
      valueFields: [{ sourceColumn: 2, label: 'Revenue', aggregation: 'SUM' }],
      filterFields: [{ sourceColumn: 0, label: 'Dept', hiddenValues: ['Sales'] }],
      showTotals: { rows: false, columns: false },
    };
    const result = calculatePivot(sourceGrid, def);
    expect(result.cells).toHaveLength(2);
    expect(result.cells[1][0].value).toBe('Eng');
    expect(result.cells[1][1].value).toBe('250');
  });

  it('handles multiple value fields', () => {
    const def: PivotTableDefinition = {
      id: 'p4', sourceTabId: 'tab-1', sourceRange: 'A1:C5',
      rowFields: [{ sourceColumn: 0, label: 'Dept' }],
      columnFields: [],
      valueFields: [
        { sourceColumn: 2, label: 'Revenue', aggregation: 'SUM' },
        { sourceColumn: 2, label: 'Revenue', aggregation: 'COUNT' },
      ],
      filterFields: [],
      showTotals: { rows: false, columns: false },
    };
    const result = calculatePivot(sourceGrid, def);
    expect(result.cells[0][1].value).toBe('SUM of Revenue');
    expect(result.cells[0][2].value).toBe('COUNT of Revenue');
    expect(result.cells[1][1].value).toBe('250');
    expect(result.cells[1][2].value).toBe('2');
  });
});

describe('calculatePivot format inheritance', () => {
  // Date row field (col 0, formatted), currency value field (col 2, formatted).
  const styledGrid: Grid = new Map();
  const rows: Array<[string, string, string]> = [
    ['Date', 'Region', 'Amount'],
    ['2026-07-01', 'East', '100'],
    ['2026-07-01', 'West', '200'],
    ['2026-07-02', 'East', '150'],
  ];
  for (let r = 0; r < rows.length; r++) {
    const styleFor = (c: number): Cell['s'] => {
      if (r === 0) return undefined; // headers unformatted
      if (c === 0) return { nf: 'date' };
      if (c === 2) return { nf: 'currency', cu: 'USD' };
      return undefined;
    };
    for (let c = 0; c < rows[r].length; c++) {
      const s = styleFor(c);
      styledGrid.set(
        toSref({ r: r + 1, c: c + 1 }),
        s ? { v: rows[r][c], s } : { v: rows[r][c] },
      );
    }
  }

  it('inherits the source date format on single row-field labels', () => {
    const def: PivotTableDefinition = {
      id: 'f1', sourceTabId: 'tab-1', sourceRange: 'A1:C4',
      rowFields: [{ sourceColumn: 0, label: 'Date' }],
      columnFields: [],
      valueFields: [{ sourceColumn: 2, label: 'Amount', aggregation: 'SUM' }],
      filterFields: [],
      showTotals: { rows: false, columns: false },
    };
    const result = calculatePivot(styledGrid, def);
    // Row 0 is the header row; data rows start at index 1.
    expect(result.cells[1][0]).toMatchObject({
      value: '2026-07-01',
      type: 'rowHeader',
      format: { nf: 'date' },
    });
    expect(result.cells[2][0].format).toEqual({ nf: 'date' });
  });

  it('inherits the source currency format on SUM value cells', () => {
    const def: PivotTableDefinition = {
      id: 'f2', sourceTabId: 'tab-1', sourceRange: 'A1:C4',
      rowFields: [{ sourceColumn: 0, label: 'Date' }],
      columnFields: [],
      valueFields: [{ sourceColumn: 2, label: 'Amount', aggregation: 'SUM' }],
      filterFields: [],
      showTotals: { rows: true, columns: false },
    };
    const result = calculatePivot(styledGrid, def);
    expect(result.cells[1][1]).toMatchObject({
      type: 'value',
      format: { nf: 'currency', cu: 'USD' },
    });
    // Grand total row inherits the value format too.
    const totalRow = result.cells[result.cells.length - 1];
    expect(totalRow[0].value).toBe('Grand Total');
    expect(totalRow[1].format).toEqual({ nf: 'currency', cu: 'USD' });
  });

  it('keeps COUNT value cells plain (no inherited format)', () => {
    const def: PivotTableDefinition = {
      id: 'f3', sourceTabId: 'tab-1', sourceRange: 'A1:C4',
      rowFields: [{ sourceColumn: 0, label: 'Date' }],
      columnFields: [],
      valueFields: [{ sourceColumn: 2, label: 'Amount', aggregation: 'COUNT' }],
      filterFields: [],
      showTotals: { rows: false, columns: false },
    };
    const result = calculatePivot(styledGrid, def);
    expect(result.cells[1][1].type).toBe('value');
    expect(result.cells[1][1].format).toBeUndefined();
  });

  it('does not format composite labels from multiple row fields', () => {
    const def: PivotTableDefinition = {
      id: 'f4', sourceTabId: 'tab-1', sourceRange: 'A1:C4',
      rowFields: [
        { sourceColumn: 0, label: 'Date' },
        { sourceColumn: 1, label: 'Region' },
      ],
      columnFields: [],
      valueFields: [{ sourceColumn: 2, label: 'Amount', aggregation: 'SUM' }],
      filterFields: [],
      showTotals: { rows: false, columns: false },
    };
    const result = calculatePivot(styledGrid, def);
    // Composite "2026-07-01 / East" label must not carry a date format.
    expect(result.cells[1][0].value).toContain(' / ');
    expect(result.cells[1][0].format).toBeUndefined();
  });

  it('inherits the date format on single column-field headers', () => {
    const def: PivotTableDefinition = {
      id: 'f5', sourceTabId: 'tab-1', sourceRange: 'A1:C4',
      rowFields: [{ sourceColumn: 1, label: 'Region' }],
      columnFields: [{ sourceColumn: 0, label: 'Date' }],
      valueFields: [{ sourceColumn: 2, label: 'Amount', aggregation: 'SUM' }],
      filterFields: [],
      showTotals: { rows: false, columns: false },
    };
    const result = calculatePivot(styledGrid, def);
    // Header row, first column is the empty corner; col headers follow.
    expect(result.cells[0][1]).toMatchObject({
      type: 'colHeader',
      format: { nf: 'date' },
    });
  });
});

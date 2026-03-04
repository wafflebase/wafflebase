import { describe, expect, it } from 'vitest';
import { calculatePivot } from '../../src/model/pivot/calculate';
import type { Grid, PivotTableDefinition } from '../../src/model/types';
import { toSref } from '../../src/model/coordinates';

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

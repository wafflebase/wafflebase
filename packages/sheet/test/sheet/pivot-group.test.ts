import { describe, expect, it } from 'vitest';
import { buildGroups, applyFilters } from '../../src/model/pivot/group';
import type { PivotField, PivotFilterField, PivotRecord } from '../../src/model/types';

const records: PivotRecord[] = [
  ['Alice', 'Eng', 'Q1', '100'],
  ['Bob', 'Sales', 'Q2', '200'],
  ['Charlie', 'Eng', 'Q1', '150'],
  ['Dave', 'Sales', 'Q1', '300'],
  ['Eve', 'Eng', 'Q2', '250'],
];

describe('applyFilters', () => {
  it('removes records matching hidden values', () => {
    const filters: PivotFilterField[] = [
      { sourceColumn: 1, label: 'Dept', hiddenValues: ['Sales'] },
    ];
    const result = applyFilters(records, filters);
    expect(result).toHaveLength(3);
    expect(result.every((r) => r[1] === 'Eng')).toBe(true);
  });

  it('returns all records when no filters', () => {
    expect(applyFilters(records, [])).toHaveLength(5);
  });

  it('applies multiple filters with AND logic', () => {
    const filters: PivotFilterField[] = [
      { sourceColumn: 1, label: 'Dept', hiddenValues: ['Sales'] },
      { sourceColumn: 2, label: 'Quarter', hiddenValues: ['Q2'] },
    ];
    expect(applyFilters(records, filters)).toHaveLength(2);
  });
});

describe('buildGroups', () => {
  it('builds single-level groups sorted ascending', () => {
    const fields: PivotField[] = [{ sourceColumn: 1, label: 'Dept', sort: 'asc' }];
    const root = buildGroups(records, fields);
    expect(root.children).toHaveLength(2);
    expect(root.children[0].value).toBe('Eng');
    expect(root.children[1].value).toBe('Sales');
    expect(root.children[0].records).toEqual([0, 2, 4]);
  });

  it('builds single-level groups sorted descending', () => {
    const fields: PivotField[] = [{ sourceColumn: 1, label: 'Dept', sort: 'desc' }];
    const root = buildGroups(records, fields);
    expect(root.children[0].value).toBe('Sales');
  });

  it('builds multi-level groups', () => {
    const fields: PivotField[] = [
      { sourceColumn: 1, label: 'Dept' },
      { sourceColumn: 2, label: 'Quarter' },
    ];
    const root = buildGroups(records, fields);
    const eng = root.children.find((n) => n.value === 'Eng')!;
    expect(eng.children).toHaveLength(2);
    expect(eng.children[0].value).toBe('Q1');
    expect(eng.children[0].records).toEqual([0, 2]);
  });

  it('returns root with all record indices when no fields', () => {
    const root = buildGroups(records, []);
    expect(root.records).toEqual([0, 1, 2, 3, 4]);
    expect(root.children).toHaveLength(0);
  });
});

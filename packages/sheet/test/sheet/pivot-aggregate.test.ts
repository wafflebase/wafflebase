import { describe, expect, it } from 'vitest';
import { aggregateValues } from '../../src/model/pivot/aggregate';
import type { PivotRecord, PivotValueField } from '../../src/model/types';

const records: PivotRecord[] = [
  ['Alice', '100'],
  ['Bob', '200'],
  ['Charlie', ''],
  ['Dave', '300'],
  ['Eve', 'N/A'],
];

const sumField: PivotValueField = { sourceColumn: 1, label: 'Amount', aggregation: 'SUM' };

describe('aggregateValues', () => {
  it('SUM adds numeric values, skips non-numeric', () => {
    expect(aggregateValues(records, [0, 1, 2, 3, 4], sumField)).toBe('600');
  });
  it('COUNT counts numeric values only', () => {
    const f: PivotValueField = { ...sumField, aggregation: 'COUNT' };
    expect(aggregateValues(records, [0, 1, 2, 3, 4], f)).toBe('3');
  });
  it('COUNTA counts non-empty values', () => {
    const f: PivotValueField = { ...sumField, aggregation: 'COUNTA' };
    expect(aggregateValues(records, [0, 1, 2, 3, 4], f)).toBe('4');
  });
  it('AVERAGE computes mean of numeric values', () => {
    const f: PivotValueField = { ...sumField, aggregation: 'AVERAGE' };
    expect(aggregateValues(records, [0, 1, 3], f)).toBe('200');
  });
  it('MIN finds smallest numeric value', () => {
    const f: PivotValueField = { ...sumField, aggregation: 'MIN' };
    expect(aggregateValues(records, [0, 1, 3], f)).toBe('100');
  });
  it('MAX finds largest numeric value', () => {
    const f: PivotValueField = { ...sumField, aggregation: 'MAX' };
    expect(aggregateValues(records, [0, 1, 3], f)).toBe('300');
  });
  it('returns empty string when no numeric values for SUM', () => {
    expect(aggregateValues(records, [2, 4], sumField)).toBe('');
  });
  it('handles subset of indices', () => {
    expect(aggregateValues(records, [0, 1], sumField)).toBe('300');
  });
});

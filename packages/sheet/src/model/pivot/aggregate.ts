import type { PivotRecord, PivotValueField } from '../types';

/**
 * `aggregateValues` computes an aggregated value for the given records and
 * value field.
 *
 * - COUNT: returns the count of all indices (includes empty cells).
 * - COUNTA: returns the count of non-empty values at the field's source column.
 * - SUM / AVERAGE / MIN / MAX: parses values to numbers with `Number(v)`,
 *   skipping `NaN` and empty strings. Returns '' when no valid numeric values
 *   exist.
 */
export function aggregateValues(
  records: PivotRecord[],
  indices: number[],
  field: PivotValueField,
): string {
  const { sourceColumn, aggregation } = field;

  if (aggregation === 'COUNT') {
    return String(indices.length);
  }

  if (aggregation === 'COUNTA') {
    let count = 0;
    for (const i of indices) {
      if (records[i][sourceColumn] !== '') {
        count++;
      }
    }
    return String(count);
  }

  // Numeric aggregations: SUM, AVERAGE, MIN, MAX
  const nums: number[] = [];
  for (const i of indices) {
    const v = records[i][sourceColumn];
    if (v === '') continue;
    const n = Number(v);
    if (Number.isNaN(n)) continue;
    nums.push(n);
  }

  if (nums.length === 0) {
    return '';
  }

  switch (aggregation) {
    case 'SUM': {
      let sum = 0;
      for (const n of nums) sum += n;
      return String(sum);
    }
    case 'AVERAGE': {
      let sum = 0;
      for (const n of nums) sum += n;
      return String(sum / nums.length);
    }
    case 'MIN':
      return String(Math.min(...nums));
    case 'MAX':
      return String(Math.max(...nums));
  }
}

import { FilterCondition, FilterState, Range } from '../core/types';
import { cloneRange } from '../core/coordinates';

/**
 * `normalizeFilterText` converts runtime cell/filter values into plain strings.
 * Yorkie may expose wrapped primitive objects at runtime.
 */
export function normalizeFilterText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'object') {
    const withValue = value as { value?: unknown; toJSON?: () => unknown };
    if (withValue.value !== undefined && withValue.value !== value) {
      return normalizeFilterText(withValue.value);
    }
    if (typeof withValue.toJSON === 'function') {
      try {
        const jsonValue = withValue.toJSON.call(value);
        if (jsonValue !== value) {
          return normalizeFilterText(jsonValue);
        }
      } catch {
        // Ignore and fall back to string conversion.
      }
    }
  }
  return String(value);
}

/**
 * `normalizeFilterCondition` normalizes and validates a filter condition.
 */
export function normalizeFilterCondition(
  condition: FilterCondition,
): FilterCondition | undefined {
  const op = condition.op;
  if (op === 'in') {
    const values = Array.from(
      new Set(
        (condition.values || []).map((value) =>
          normalizeFilterText(value).trim(),
        ),
      ),
    );
    return { op, values };
  }

  if (op === 'isEmpty' || op === 'isNotEmpty') {
    return { op };
  }

  const value = normalizeFilterText(condition.value).trim();
  if (value.length === 0) {
    return undefined;
  }
  return { op, value };
}

/**
 * `matchesFilterCondition` checks whether a cell text satisfies a condition.
 */
export function matchesFilterCondition(
  value: string,
  condition: FilterCondition,
): boolean {
  const normalizedText = normalizeFilterText(value).trim();
  const normalizedValue = normalizedText.toLowerCase();
  const conditionValue = normalizeFilterText(condition.value)
    .trim()
    .toLowerCase();

  switch (condition.op) {
    case 'in':
      return new Set(
        (condition.values || []).map((item) =>
          normalizeFilterText(item).trim(),
        ),
      ).has(normalizedText);
    case 'contains':
      return normalizedValue.includes(conditionValue);
    case 'notContains':
      return !normalizedValue.includes(conditionValue);
    case 'equals':
      return normalizedValue === conditionValue;
    case 'notEquals':
      return normalizedValue !== conditionValue;
    case 'isEmpty':
      return normalizedValue.length === 0;
    case 'isNotEmpty':
      return normalizedValue.length > 0;
    default:
      return true;
  }
}

/**
 * `shiftFilterBoundary` remaps an index after insertion/deletion.
 */
export function shiftFilterBoundary(
  indexValue: number,
  index: number,
  count: number,
): number {
  if (count > 0) {
    return indexValue >= index ? indexValue + count : indexValue;
  }

  const absCount = Math.abs(count);
  if (indexValue >= index && indexValue < index + absCount) {
    return index;
  }
  if (indexValue >= index + absCount) {
    return indexValue + count;
  }
  return indexValue;
}

/**
 * `buildFilterStatePayload` builds the serializable filter state from runtime data.
 */
export function buildFilterStatePayload(
  filterRange: Range | undefined,
  filterColumns: Map<number, FilterCondition>,
  hiddenRows: Set<number>,
  isColumnInFilter: (col: number) => boolean,
): FilterState | undefined {
  if (!filterRange) return undefined;

  const columns: Record<string, FilterCondition> = {};
  const sortedColumns = Array.from(filterColumns.entries()).sort(
    (a, b) => a[0] - b[0],
  );
  for (const [col, condition] of sortedColumns) {
    if (!isColumnInFilter(col)) continue;
    columns[String(col)] = { ...condition };
  }

  return {
    range: cloneRange(filterRange),
    columns,
    hiddenRows: Array.from(hiddenRows).sort((a, b) => a - b),
  };
}

/**
 * `normalizeFilterColumnsToRange` removes criteria outside the active filter range.
 * Mutates the given `filterColumns` map in place.
 */
export function normalizeFilterColumnsToRange(
  filterRange: Range | undefined,
  filterColumns: Map<number, FilterCondition>,
  isColumnInFilter: (col: number) => boolean,
): void {
  if (!filterRange) {
    filterColumns.clear();
    return;
  }

  for (const col of filterColumns.keys()) {
    if (!isColumnInFilter(col)) {
      filterColumns.delete(col);
    }
  }
}

/**
 * `pruneHiddenRowsOutsideFilter` keeps hidden rows within filter data rows only.
 * Returns the pruned set.
 */
export function pruneHiddenRowsOutsideFilter(
  filterRange: Range | undefined,
  hiddenRows: Set<number>,
): Set<number> {
  if (!filterRange) {
    return new Set();
  }

  const dataStart = filterRange[0].r + 1;
  const dataEnd = filterRange[1].r;
  const next = new Set<number>();
  for (const row of hiddenRows) {
    if (row >= dataStart && row <= dataEnd) {
      next.add(row);
    }
  }
  return next;
}

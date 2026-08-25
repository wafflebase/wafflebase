import { BadRequestException } from '@nestjs/common';
import type {
  PivotTableDefinition,
  WorksheetFilterState,
} from '@wafflebase/sheets';

function asObject(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BadRequestException(message);
  }
  return value as Record<string, unknown>;
}

function nonNegInt(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new BadRequestException(`${name} must be a non-negative integer`);
  }
  return value;
}

/**
 * Validate a `{ filter: WorksheetFilterState | null }` body. `null` clears the
 * filter. The range bounds are validated; per-column conditions are stored as
 * given (structural check only), matching the docs-content write path.
 */
export function parseFilter(body: unknown): WorksheetFilterState | null {
  const b = asObject(body, 'body must be an object { filter: {...} | null }');
  const filter = b.filter;
  if (filter === null || filter === undefined) return null;
  const f = asObject(filter, 'filter must be an object or null');
  const columns = asObject(f.columns ?? {}, 'filter.columns must be an object');
  return {
    startRow: nonNegInt(f.startRow, 'filter.startRow'),
    endRow: nonNegInt(f.endRow, 'filter.endRow'),
    startCol: nonNegInt(f.startCol, 'filter.startCol'),
    endCol: nonNegInt(f.endCol, 'filter.endCol'),
    columns,
  } as WorksheetFilterState;
}

/**
 * Validate a `{ pivot: PivotTableDefinition | null }` body. `null` clears the
 * pivot. Top-level identity/source fields, the four field arrays, and
 * `showTotals` are validated; the field entries themselves are stored as given.
 */
export function parsePivot(body: unknown): PivotTableDefinition | null {
  const b = asObject(body, 'body must be an object { pivot: {...} | null }');
  const pivot = b.pivot;
  if (pivot === null || pivot === undefined) return null;
  const p = asObject(pivot, 'pivot must be an object or null');
  const str = (value: unknown, name: string): string => {
    if (typeof value !== 'string' || value.length === 0) {
      throw new BadRequestException(`pivot.${name} must be a non-empty string`);
    }
    return value;
  };
  const arr = (value: unknown, name: string): unknown[] => {
    if (!Array.isArray(value)) {
      throw new BadRequestException(`pivot.${name} must be an array`);
    }
    return value;
  };
  const showTotals = asObject(
    p.showTotals ?? {},
    'pivot.showTotals must be an object { rows, columns }',
  );
  const bool = (value: unknown, name: string): boolean => {
    if (typeof value !== 'boolean') {
      throw new BadRequestException(`pivot.showTotals.${name} must be a boolean`);
    }
    return value;
  };
  return {
    id: str(p.id, 'id'),
    sourceTabId: str(p.sourceTabId, 'sourceTabId'),
    sourceRange: str(p.sourceRange, 'sourceRange'),
    rowFields: arr(p.rowFields ?? [], 'rowFields'),
    columnFields: arr(p.columnFields ?? [], 'columnFields'),
    valueFields: arr(p.valueFields ?? [], 'valueFields'),
    filterFields: arr(p.filterFields ?? [], 'filterFields'),
    showTotals: {
      rows: bool(showTotals.rows ?? false, 'rows'),
      columns: bool(showTotals.columns ?? false, 'columns'),
    },
  } as PivotTableDefinition;
}

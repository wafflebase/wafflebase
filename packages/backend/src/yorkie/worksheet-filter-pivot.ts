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

function nonNegIntArray(value: unknown, name: string): number[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new BadRequestException(
      `${name} must be an array of non-negative integers`,
    );
  }
  return value.map((entry, i) => nonNegInt(entry, `${name}[${i}]`));
}

/**
 * Validate a `{ filter: WorksheetFilterState | null }` body. `null` clears the
 * filter; an omitted `filter` key is a 400, not a clear, so a typo'd or empty
 * body cannot silently wipe the worksheet's filter. The range bounds are
 * validated (including that they are not inverted); per-column conditions are
 * stored as given (structural check only), matching the docs-content write
 * path.
 *
 * `hiddenRows` is **stored as given and is never recomputed** from the column
 * conditions — `Sheet.loadFilterState` trusts the persisted array verbatim. A
 * caller that supplies conditions but omits `hiddenRows` therefore gets an
 * inert filter: the editor shows the dropdowns armed and the conditions set,
 * but every row still visible.
 */
export function parseFilter(body: unknown): WorksheetFilterState | null {
  const b = asObject(body, 'body must be an object { filter: {...} | null }');
  const filter = b.filter;
  if (filter === undefined) {
    throw new BadRequestException("'filter' must be an object or null");
  }
  if (filter === null) return null;
  const f = asObject(filter, "'filter' must be an object or null");
  const columns = asObject(f.columns ?? {}, 'filter.columns must be an object');
  const startRow = nonNegInt(f.startRow, 'filter.startRow');
  const endRow = nonNegInt(f.endRow, 'filter.endRow');
  const startCol = nonNegInt(f.startCol, 'filter.startCol');
  const endCol = nonNegInt(f.endCol, 'filter.endCol');
  // An inverted pair is not a crash — the sole reader hands it to `toRange`,
  // which normalizes with Math.min/Math.max — but the bounds are echoed back
  // verbatim by GET, so accepting one would make this validator's contract a
  // lie rather than merely lenient.
  if (endRow < startRow || endCol < startCol) {
    throw new BadRequestException(
      'filter range must not be inverted: filter.endRow >= filter.startRow ' +
        'and filter.endCol >= filter.startCol',
    );
  }
  // No blanket `as WorksheetFilterState`: the object is checked against the
  // type field by field, so a field added to `WorksheetFilterState` later
  // fails the build here instead of being silently dropped at runtime. The one
  // cast is `columns`, whose element type is deliberately unchecked (above).
  return {
    startRow,
    endRow,
    startCol,
    endCol,
    columns: columns as WorksheetFilterState['columns'],
    hiddenRows: nonNegIntArray(f.hiddenRows, 'filter.hiddenRows'),
  };
}

/**
 * Validate a `{ pivot: PivotTableDefinition | null }` body. `null` clears the
 * pivot; an omitted `pivot` key is a 400, not a clear. Top-level
 * identity/source fields, the four field arrays, and `showTotals` are
 * validated; the field entries themselves are stored as given.
 */
export function parsePivot(body: unknown): PivotTableDefinition | null {
  const b = asObject(body, 'body must be an object { pivot: {...} | null }');
  const pivot = b.pivot;
  if (pivot === undefined) {
    throw new BadRequestException("'pivot' must be an object or null");
  }
  if (pivot === null) return null;
  const p = asObject(pivot, "'pivot' must be an object or null");
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
      throw new BadRequestException(
        `pivot.showTotals.${name} must be a boolean`,
      );
    }
    return value;
  };
  // As in `parseFilter`, no blanket cast: only the array *element* types are
  // deliberately unchecked, so each array carries its own narrow cast and a
  // field added to `PivotTableDefinition` later fails the build here.
  return {
    id: str(p.id, 'id'),
    sourceTabId: str(p.sourceTabId, 'sourceTabId'),
    sourceRange: str(p.sourceRange, 'sourceRange'),
    rowFields: arr(
      p.rowFields ?? [],
      'rowFields',
    ) as PivotTableDefinition['rowFields'],
    columnFields: arr(
      p.columnFields ?? [],
      'columnFields',
    ) as PivotTableDefinition['columnFields'],
    valueFields: arr(
      p.valueFields ?? [],
      'valueFields',
    ) as PivotTableDefinition['valueFields'],
    filterFields: arr(
      p.filterFields ?? [],
      'filterFields',
    ) as PivotTableDefinition['filterFields'],
    showTotals: {
      rows: bool(showTotals.rows ?? false, 'rows'),
      columns: bool(showTotals.columns ?? false, 'columns'),
    },
  };
}

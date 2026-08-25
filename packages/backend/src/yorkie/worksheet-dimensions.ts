import { BadRequestException } from '@nestjs/common';
import type { CellStyle } from '@wafflebase/sheets';
import { parseCellStyle } from './cell-style';

/**
 * Column/row styles and dimension sizes are stored on the worksheet as maps
 * keyed by the 1-based column/row index rendered as a string (`"1"` = column A
 * / the first row), matching the frontend store. A PUT body carries such a map
 * whose values are either a new value or `null` to clear that index, so a
 * single call can set some indices and reset others.
 */
export type StyleEntries = Map<string, CellStyle | null>;
export type SizeEntries = Map<string, number | null>;

function assertObjectBody(body: unknown, field: string): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException(`body must be an object { ${field}: {...} }`);
  }
  const map = (body as Record<string, unknown>)[field];
  if (typeof map !== 'object' || map === null || Array.isArray(map)) {
    throw new BadRequestException(`'${field}' must be an object map`);
  }
  return map as Record<string, unknown>;
}

function assertIndexKey(key: string, field: string): void {
  if (!/^[1-9]\d*$/.test(key)) {
    throw new BadRequestException(
      `'${field}' keys must be 1-based integer indices; got "${key}"`,
    );
  }
}

/**
 * Validate a `{ [field]: { [index]: CellStyle | null } }` body for column or
 * row styles. Each style is validated with `parseCellStyle`; `null` marks the
 * index for deletion.
 */
export function parseIndexKeyedStyles(body: unknown, field: string): StyleEntries {
  const map = assertObjectBody(body, field);
  const entries: StyleEntries = new Map();
  for (const [key, value] of Object.entries(map)) {
    assertIndexKey(key, field);
    entries.set(key, value === null ? null : parseCellStyle(value));
  }
  return entries;
}

/**
 * Validate a `{ [field]: { [index]: number | null } }` body for column widths
 * or row heights. Each size must be a positive finite number; `null` clears the
 * index (reverting it to the default dimension).
 */
export function parseIndexKeyedSizes(body: unknown, field: string): SizeEntries {
  const map = assertObjectBody(body, field);
  const entries: SizeEntries = new Map();
  for (const [key, value] of Object.entries(map)) {
    assertIndexKey(key, field);
    if (value === null) {
      entries.set(key, null);
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new BadRequestException(
        `'${field}["${key}"]' must be a positive number or null`,
      );
    }
    entries.set(key, value);
  }
  return entries;
}

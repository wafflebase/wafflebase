import { BadRequestException } from '@nestjs/common';
import type { MergeSpan } from '@wafflebase/sheets';

function assertNonNegInt(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new BadRequestException(`${name} must be a non-negative integer`);
  }
  return value;
}

function assertObject(body: unknown, message: string): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException(message);
  }
  return body as Record<string, unknown>;
}

/** Validate a freeze-pane body `{ rows, cols }` (both optional, default 0). */
export function parseFreeze(body: unknown): { rows: number; cols: number } {
  const b = assertObject(body, 'freeze body must be an object { rows, cols }');
  return {
    rows: assertNonNegInt(b.rows ?? 0, 'rows'),
    cols: assertNonNegInt(b.cols ?? 0, 'cols'),
  };
}

/** Validate a hidden body `{ rows: number[], columns: number[] }` (0-based indices). */
export function parseHidden(body: unknown): {
  rows: number[];
  columns: number[];
} {
  const b = assertObject(body, 'hidden body must be an object { rows, columns }');
  const arr = (value: unknown, name: string): number[] => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      throw new BadRequestException(`${name} must be an array of integers`);
    }
    return value.map((x, i) => assertNonNegInt(x, `${name}[${i}]`));
  };
  return { rows: arr(b.rows, 'rows'), columns: arr(b.columns, 'columns') };
}

/**
 * Validate a merges body `{ merges: { "<cellRef>": { rs, cs } } }`. Each span's
 * row/col span must be an integer >= 1. Returns the sanitized merges map.
 */
export function parseMerges(body: unknown): Record<string, MergeSpan> {
  const b = assertObject(
    body,
    "merges body must be an object with a 'merges' map",
  );
  const merges = assertObject(
    b.merges,
    "'merges' must be an object keyed by cell ref (e.g. { \"A1\": { rs, cs } })",
  );
  const out: Record<string, MergeSpan> = {};
  for (const [ref, span] of Object.entries(merges)) {
    const s = assertObject(span, `merges['${ref}'] must be an object { rs, cs }`);
    const rs = s.rs;
    const cs = s.cs;
    if (
      typeof rs !== 'number' ||
      !Number.isInteger(rs) ||
      rs < 1 ||
      typeof cs !== 'number' ||
      !Number.isInteger(cs) ||
      cs < 1
    ) {
      throw new BadRequestException(
        `merges['${ref}'] must have integer rs >= 1 and cs >= 1`,
      );
    }
    out[ref] = { rs, cs };
  }
  return out;
}

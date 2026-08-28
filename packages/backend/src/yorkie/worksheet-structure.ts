import { BadRequestException } from '@nestjs/common';
import { parseRange, parseRef } from '@wafflebase/sheets';
import type { Axis, Range } from '@wafflebase/sheets';

/**
 * The engine's grid bounds (`Dimensions` in `sheets/model/worksheet/sheet.ts`),
 * restated here for the same reason `worksheet-settings.ts` restates them:
 * every other writer of a range is bounded by a selection or by the grid
 * itself, while this API takes the range straight from the caller.
 */
const MaxRows = 1000000;
const MaxColumns = 18278;

/**
 * Ceiling on the cells one clear-range request may cover.
 *
 * `toRefsFromRanges` yields one ref per cell and the controller's loop runs
 * synchronously inside `doc.update`, so the area of the range is wall-clock
 * time with the whole Node process blocked — not a large edit, a stalled
 * server. The grid bound alone does not help: a full-grid `A1:ZZZ1000000` is
 * inside the grid and still 1.8e10 cells. Measured here at ~1e6 cells per
 * 0.5s (ref generation plus the `getWorksheetCell` lookup), that is about two
 * and a half hours of blocking from a ~20-byte body.
 *
 * At this cap the worst case is roughly half a second, and 1e6 cells is far
 * above anything the editor clears from a selection (a full 26-column A:Z
 * wipe of 38k rows is inside it), so a real bulk clear still goes through in
 * one call.
 */
const MaxClearedCells = 1000000;

/**
 * Validate a `{ range: "A1:C10" }` body for a clear-range action and return the
 * parsed `Range`, **normalized** so `from` is the top-left corner. A single-cell
 * reference (`"A1"`) is accepted and treated as a 1x1 range. A malformed
 * reference is rejected with a 400 (the engine parser throws a plain Error,
 * which is wrapped here).
 *
 * Normalization happens before the bound checks, not after: `parseRange` keeps
 * the endpoints in the order they were written, so `"C3:A1"` and
 * `"XFD1048576:A1"` both arrive reversed while `toRefsFromRanges` walks the
 * same area either way. Checking the raw endpoints would let a reversed range
 * carry the out-of-grid corner through in `range[0]`.
 */
export function parseClearRange(body: unknown): Range {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('body must be an object { range: "A1:C10" }');
  }
  const ref = (body as Record<string, unknown>).range;
  if (typeof ref !== 'string' || ref.length === 0) {
    throw new BadRequestException(
      "'range' must be a non-empty A1 range string",
    );
  }

  let parsed: Range;
  try {
    if (ref.includes(':')) {
      parsed = parseRange(ref);
    } else {
      const single = parseRef(ref);
      parsed = [single, { ...single }];
    }
  } catch {
    throw new BadRequestException(
      `'range' is not a valid A1 range; got "${ref}"`,
    );
  }

  const from = {
    r: Math.min(parsed[0].r, parsed[1].r),
    c: Math.min(parsed[0].c, parsed[1].c),
  };
  const to = {
    r: Math.max(parsed[0].r, parsed[1].r),
    c: Math.max(parsed[0].c, parsed[1].c),
  };

  if (from.r < 1 || from.c < 1 || to.r > MaxRows || to.c > MaxColumns) {
    throw new BadRequestException(
      `'range' is outside the grid (rows 1..${MaxRows}, columns 1..${MaxColumns}); got "${ref}"`,
    );
  }

  const area = (to.r - from.r + 1) * (to.c - from.c + 1);
  if (area > MaxClearedCells) {
    throw new BadRequestException(
      `'range' covers ${area} cells, above the ${MaxClearedCells} limit; got "${ref}"`,
    );
  }

  return [from, to];
}

/** A validated row/column insert, delete, or move request. */
export type AxisShift = { axis: Axis; index: number; count: number };
export type AxisMove = {
  axis: Axis;
  srcIndex: number;
  count: number;
  dstIndex: number;
};

function assertBody(body: unknown, shape: string): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException(`body must be an object ${shape}`);
  }
  return body as Record<string, unknown>;
}

function parseAxis(raw: unknown): Axis {
  if (raw !== 'row' && raw !== 'column') {
    throw new BadRequestException('\'axis\' must be "row" or "column"');
  }
  return raw;
}

/** The 1-based index bound for an axis: rows and columns differ. */
function axisLimit(axis: Axis): number {
  return axis === 'row' ? MaxRows : MaxColumns;
}

function parseIndex(raw: unknown, field: string, axis: Axis): number {
  const limit = axisLimit(axis);
  if (
    typeof raw !== 'number' ||
    !Number.isInteger(raw) ||
    raw < 1 ||
    raw > limit
  ) {
    throw new BadRequestException(
      `'${field}' must be an integer in 1..${limit} for axis "${axis}"`,
    );
  }
  return raw;
}

/**
 * `count` is bounded by the axis length for the same reason `clear` bounds its
 * area: the shift runs synchronously inside `doc.update`, and every inserted
 * row rewrites the formulas and anchors below it.
 */
function parseCount(raw: unknown, axis: Axis): number {
  const limit = axisLimit(axis);
  if (
    typeof raw !== 'number' ||
    !Number.isInteger(raw) ||
    raw < 1 ||
    raw > limit
  ) {
    throw new BadRequestException(
      `'count' must be an integer in 1..${limit} for axis "${axis}"`,
    );
  }
  return raw;
}

/**
 * Validate `{ axis, index, count }` for an insert or a delete. `count` is
 * always positive here; the caller negates it for a delete, matching the
 * engine's `applyWorksheetShift` convention (positive inserts, negative
 * deletes).
 */
export function parseAxisShift(body: unknown): AxisShift {
  const b = assertBody(body, '{ axis, index, count }');
  const axis = parseAxis(b.axis);
  return {
    axis,
    index: parseIndex(b.index, 'index', axis),
    count: parseCount(b.count, axis),
  };
}

/**
 * Validate `{ axis, srcIndex, count, dstIndex }` for a move. A destination
 * inside the moved block is rejected: the engine treats `dstIndex` as the
 * position the block lands *before*, so a target within `[src, src+count)`
 * describes moving a block into itself and has no meaningful result.
 */
export function parseAxisMove(body: unknown): AxisMove {
  const b = assertBody(body, '{ axis, srcIndex, count, dstIndex }');
  const axis = parseAxis(b.axis);
  const srcIndex = parseIndex(b.srcIndex, 'srcIndex', axis);
  const count = parseCount(b.count, axis);
  const dstIndex = parseIndex(b.dstIndex, 'dstIndex', axis);

  if (dstIndex > srcIndex && dstIndex < srcIndex + count) {
    throw new BadRequestException(
      `'dstIndex' (${dstIndex}) falls inside the moved block ` +
        `[${srcIndex}, ${srcIndex + count - 1}]`,
    );
  }
  return { axis, srcIndex, count, dstIndex };
}

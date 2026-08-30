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
 * Ceiling on the axis entries one request may materialize.
 *
 * `rowOrder`/`colOrder` are dense CRDT arrays — covering visual row N costs N
 * array entries — and `insertWorksheetAxis` back-fills the axis out to `index`
 * before minting `count` new IDs, all synchronously inside `doc.update`. The
 * grid bound alone does not help, exactly as it does not for `clear`:
 * `{ index: 1000000, count: 1 }` is inside the grid, spans one row, and still
 * asks for a million entries. Measured against a real `yorkie.Document`:
 * 10,000 entries ~80ms, 50,000 ~1.3s, 200,000 ~17.6s — the cost is quadratic
 * in the axis length, so a full 1e6 is the ~7 minutes `axis-id-selection.md`
 * records — and spreading ~100,000 ids into `order.splice` throws
 * `RangeError: Maximum call stack size exceeded` before any of it lands.
 *
 * Worse, the axis-id alphabet is 36^4 ≈ 1.68M ids (`createWorksheetAxisId`),
 * so an axis pushed past that many entries makes the id retry loop
 * non-terminating: an uninterruptible hang of the whole process, not a slow
 * request.
 *
 * 10,000 is `MaxAxisCoverage` in `sheets/model/worksheet/sheet.ts`, the budget
 * the editor's own selection path uses to extend an axis, so this API grows an
 * axis by no more per call than the UI does and the worst case stays under a
 * tenth of a second.
 */
export const MaxAxisEntries = 10000;

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

/**
 * The last index a request touches must be inside the grid, not just its
 * endpoints. `index` and `count` are each inside the axis on their own, and
 * `{ index: 1000000, count: 2 }` still describes row 1,000,001 — a coordinate
 * the engine's `Dimensions` cannot address, so the cells written there are
 * unreachable from every other API.
 */
function assertSpan(
  axis: Axis,
  start: number,
  count: number,
  field: string,
): void {
  const limit = axisLimit(axis);
  const last = start + count - 1;
  if (last > limit) {
    throw new BadRequestException(
      `'${field}' (${start}) plus 'count' (${count}) reaches ${last}, ` +
        `past the ${limit} limit for axis "${axis}"`,
    );
  }
}

/**
 * Reject a request that would grow an axis past the grid, or past
 * {@link MaxAxisEntries} in one call.
 *
 * This is the half of the bound the parser cannot make. `count` is in the
 * body, but the entries a request actually *materializes* depend on how long
 * the axis already is — `{ index: 1000000, count: 1 }` costs one entry on a
 * full sheet and 999,999 on an empty one — and only the controller sees that,
 * inside `doc.update`. Call it before the first mutation; a throw there rolls
 * the whole update back.
 *
 * The grid half is what makes the bound cumulative. Each request is legal in
 * isolation, so without it, repeated inserts walk the axis past `MaxRows` and
 * on towards the id-space exhaustion hang.
 */
export function assertAxisGrowth(
  axis: Axis,
  currentLength: number,
  requiredLength: number,
): void {
  const limit = axisLimit(axis);
  if (requiredLength > limit) {
    throw new BadRequestException(
      `the request would extend the ${axis} axis to ${requiredLength}, ` +
        `past the ${limit} limit`,
    );
  }
  const growth = requiredLength - currentLength;
  if (growth > MaxAxisEntries) {
    throw new BadRequestException(
      `the request would add ${growth} ${axis} entries, above the ` +
        `${MaxAxisEntries} limit (the axis is ${currentLength} long)`,
    );
  }
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
 * `count` cannot exceed the axis itself. This is a shape check only — it is
 * the grid bound, and the grid bound caps no work, which is precisely what
 * `parseClearRange` says about its own area check. The bound that caps work is
 * {@link assertAxisGrowth}, applied by the controller where the axis's current
 * length is visible.
 *
 * `count` is deliberately *not* capped at {@link MaxAxisEntries} here: a delete
 * materializes nothing (it only splices entries out), so
 * `{ index: 1, count: 1000000 }` — "delete every row" — must stay legal.
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
  const index = parseIndex(b.index, 'index', axis);
  const count = parseCount(b.count, axis);
  assertSpan(axis, index, count, 'index');
  return { axis, index, count };
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
  assertSpan(axis, srcIndex, count, 'srcIndex');

  if (dstIndex > srcIndex && dstIndex < srcIndex + count) {
    throw new BadRequestException(
      `'dstIndex' (${dstIndex}) falls inside the moved block ` +
        `[${srcIndex}, ${srcIndex + count - 1}]`,
    );
  }
  return { axis, srcIndex, count, dstIndex };
}

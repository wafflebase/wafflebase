import { BadRequestException } from '@nestjs/common';
import { parseRange, parseRef } from '@wafflebase/sheets';
import type { Range } from '@wafflebase/sheets';

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

import { BadRequestException } from '@nestjs/common';
import { parseRef, toSref, type MergeSpan } from '@wafflebase/sheets';

/**
 * The engine's grid bounds (`Dimensions` in `sheets/model/worksheet/sheet.ts`).
 * Every other writer of these fields is bounded by a selection or by the grid
 * itself; this API is the first one a caller drives directly, so it has to
 * restate the bound rather than inherit it.
 */
const MaxRows = 1000000;
const MaxColumns = 18278;

/**
 * Ceiling on the cells one merge may cover.
 *
 * `Sheet.rebuildMergeCoverMap()` walks `rs * cs` on every document load and
 * puts one Map entry per covered cell, so an unbounded span is not a large
 * merge — it is a document nobody can open again. The grid bound alone does
 * not help: a single `rs: 1000000, cs: 18278` span is inside the grid and
 * still 1.8e10 iterations. This is far above any merge the editor can produce
 * from a drag, and low enough that the worst case stays interactive.
 */
const MaxMergedCells = 100000;

function assertInt(
  value: unknown,
  name: string,
  { min, max }: { min: number; max: number },
): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new BadRequestException(`${name} must be an integer`);
  }
  if (value < min || value > max) {
    throw new BadRequestException(`${name} must be between ${min} and ${max}`);
  }
  return value;
}

function assertObject(body: unknown, message: string): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException(message);
  }
  return body as Record<string, unknown>;
}

/**
 * Validate a freeze-pane body `{ rows, cols }` (both optional, default 0).
 *
 * Bounded by the grid: the frozen quadrants render every frozen row and column
 * without viewport clipping, so an out-of-grid freeze allocates per frame and
 * the UI never paints — which also means the user cannot reach the freeze menu
 * to undo it.
 */
export function parseFreeze(body: unknown): { rows: number; cols: number } {
  const b = assertObject(body, 'freeze body must be an object { rows, cols }');
  return {
    rows: assertInt(b.rows ?? 0, 'rows', { min: 0, max: MaxRows }),
    cols: assertInt(b.cols ?? 0, 'cols', { min: 0, max: MaxColumns }),
  };
}

/**
 * Validate a hidden body `{ rows: number[], columns: number[] }`.
 *
 * Indices are **1-based**, matching the A1 refs the rest of the v1 API speaks
 * and `Sheet.loadHiddenState`, which keeps only `>= 1`. A 0 is rejected rather
 * than accepted-and-dropped: silently ignoring it is what makes every index
 * look off by one.
 */
export function parseHidden(body: unknown): {
  rows: number[];
  columns: number[];
} {
  const b = assertObject(body, 'hidden body must be an object { rows, columns }');
  const arr = (value: unknown, name: string, max: number): number[] => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      throw new BadRequestException(`${name} must be an array of integers`);
    }
    return value.map((x, i) =>
      assertInt(x, `${name}[${i}]`, { min: 1, max }),
    );
  };
  return {
    rows: arr(b.rows, 'rows', MaxRows),
    columns: arr(b.columns, 'columns', MaxColumns),
  };
}

/**
 * Validate a merges body `{ merges: { "<cellRef>": { rs, cs } } }`.
 *
 * The key must **round-trip** through the engine's own helpers —
 * `toSref(parseRef(ref)) === ref` — rather than merely survive `parseRef`.
 * Two reasons, both load-bearing:
 *
 * - `rebuildMergeCoverMap` calls `parseRef` on every key with no try/catch, so
 *   a key this validator accepts and `parseRef` rejects is not a bad request.
 *   It is a tab that throws on load for every collaborator, permanently,
 *   recoverable only through another API call.
 * - `parseRef` is deliberately lenient: it scans to the first digit, so
 *   `"A1:B2"` parses as `A1` without throwing. Storing that as a key then puts
 *   an entry in `mergeCoverMap` pointing at an anchor that is not a cell,
 *   because the `sref === anchorSref` guard never matches. Round-tripping is
 *   what rejects it.
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
  // A plain object is safe here only because `parseRef` runs on every key
  // first: `__proto__` is not a cell reference, so it is rejected before it
  // could assign a prototype instead of an own key. Do not relax the key check
  // without revisiting that.
  const out: Record<string, MergeSpan> = {};
  for (const [ref, span] of Object.entries(merges)) {
    let anchor: { r: number; c: number };
    try {
      anchor = parseRef(ref);
    } catch {
      throw new BadRequestException(
        `merges['${ref}'] key must be a cell reference such as "A1"`,
      );
    }
    if (toSref(anchor) !== ref) {
      throw new BadRequestException(
        `merges['${ref}'] key must be a plain cell reference such as "A1"`,
      );
    }
    if (anchor.r > MaxRows || anchor.c > MaxColumns) {
      throw new BadRequestException(`merges['${ref}'] key is outside the grid`);
    }

    const s = assertObject(span, `merges['${ref}'] must be an object { rs, cs }`);
    const rs = assertInt(s.rs, `merges['${ref}'].rs`, {
      min: 1,
      max: MaxRows - anchor.r + 1,
    });
    const cs = assertInt(s.cs, `merges['${ref}'].cs`, {
      min: 1,
      max: MaxColumns - anchor.c + 1,
    });
    if (rs * cs > MaxMergedCells) {
      throw new BadRequestException(
        `merges['${ref}'] covers ${rs * cs} cells, above the ${MaxMergedCells} limit`,
      );
    }

    out[ref] = { rs, cs };
  }
  return out;
}

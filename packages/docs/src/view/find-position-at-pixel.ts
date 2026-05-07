import type { DocumentLayout } from './layout.js';

/**
 * Hit-test result for `findPositionAtPixel`. Mirrors the triple
 * `paginatedPixelToPosition` returns so the page-shaped wrapper can
 * delegate to this helper without losing the `lineAffinity` field its
 * callers (Cursor, TextEditor) need to keep cursor placement on the
 * visually-clicked line at line boundaries.
 *
 * `DocPosition` from `model/types.ts` only carries `{ blockId, offset }`;
 * affinity is a hit-test-derived field (you can't recover it from the
 * position alone), so it lives on the result type rather than on the
 * model type.
 */
export interface PixelPosition {
  blockId: string;
  offset: number;
  lineAffinity: 'forward' | 'backward';
}

/**
 * Hit-test a layout-local `(x, y)` against a `DocumentLayout` and return
 * the document position the pixel falls on, or `null` if the pixel is
 * outside every block.
 *
 * `(0, 0)` is the top-left of `layout.blocks[0]` — every `LayoutBlock`
 * carries its absolute `y` in the layout (and `x === 0` for body blocks),
 * so the helper walks blocks → lines → runs → chars in a single
 * coordinate system. It does NOT clamp: clicks above the first block,
 * below the last block, or to the right/left of any line return `null`
 * (relative to the line — the block-finding step is strict-y, the
 * line-finding step is strict-y, the run-finding step still does the
 * "before start of line" / "past end of line" snapping the docs
 * cursor-placement code expects).
 *
 * The caller (slides text-boxes, the paginated wrapper) is responsible
 * for translating pointer pixels into layout-local coords before
 * delegating here. The paginated wrapper additionally handles its own
 * page clamping (clicks in the page gap snap to the nearest page) and
 * row-split awareness for tables.
 *
 * Behaviour preserved verbatim from the layout-shaped portion of
 * `paginatedPixelToPosition`:
 *  - Empty line (`line.runs.length === 0`): returns `{ offset: 0,
 *    lineAffinity: 'backward' }` for the block. Tables (whose layout
 *    line carries no runs) hit this path.
 *  - Click before line start: returns `charsBeforeLine`.
 *  - Click inside a run: binary search on `run.charOffsets`, snap to
 *    the nearer character boundary.
 *  - Click past line end on a wrapped (non-last) line: returns
 *    `endOffset` minus trailing-space count (so the caret doesn't slide
 *    onto the next visual line by clicking beyond the soft-wrap).
 *  - Affinity: `forward` only when we're at a line boundary AND the
 *    clicked line is not the first line in the block.
 */
export function findPositionAtPixel(
  layout: DocumentLayout,
  x: number,
  y: number,
): PixelPosition | null {
  if (layout.blocks.length === 0) return null;

  // Find target block by strict-y. We do NOT clamp: the wrapper handles
  // clicks above the first block / below the last block (it has page-
  // shaped knowledge — gap snapping, last-page clamping). A standalone
  // text-box caller wants `null` so it can decide whether to drop the
  // caret at end-of-content or ignore the click entirely.
  let targetBlockIndex = -1;
  for (let bi = 0; bi < layout.blocks.length; bi++) {
    const lb = layout.blocks[bi];
    if (y >= lb.y && y < lb.y + lb.height) {
      targetBlockIndex = bi;
      break;
    }
  }
  if (targetBlockIndex === -1) return null;

  const lb = layout.blocks[targetBlockIndex];
  const localY = y - lb.y;

  // Find target line within the block by strict-y.
  let targetLineIndex = -1;
  for (let li = 0; li < lb.lines.length; li++) {
    const line = lb.lines[li];
    if (localY >= line.y && localY < line.y + line.height) {
      targetLineIndex = li;
      break;
    }
  }
  if (targetLineIndex === -1) return null;

  const line = lb.lines[targetLineIndex];

  // Empty line — tables (whose body is rendered separately), horizontal
  // rules, page breaks, and any blocks that laid out as a runs-less line
  // all land here. Return offset 0 so callers don't crash on table
  // clicks; table-aware editors layer their own hit-test on top.
  if (line.runs.length === 0) {
    return { blockId: lb.block.id, offset: 0, lineAffinity: 'backward' };
  }

  // Count chars before this line in the block. Used for both the
  // "before start of line" and "past end of line" return paths and as
  // the boundary value for affinity.
  let charsBeforeLine = 0;
  for (let li = 0; li < targetLineIndex; li++) {
    for (const r of lb.lines[li].runs) {
      charsBeforeLine += r.charEnd - r.charStart;
    }
  }

  // Affinity is determined by which visual line was clicked: if the
  // resolved offset equals the boundary between two lines, 'forward'
  // keeps the cursor on the clicked (later) line. The first line in a
  // block has no prior boundary, so it's always 'backward' there.
  const affinityForOffset = (offset: number): 'forward' | 'backward' =>
    targetLineIndex > 0 && offset === charsBeforeLine ? 'forward' : 'backward';

  // Layout-local x is relative to the layout origin. Body blocks have
  // `lb.x === 0`, so subtracting `lb.x` here is a no-op today but keeps
  // the math correct if a future layout pass starts indenting blocks.
  const localX = x - lb.x;

  // Before start of line (clicked in the leading margin / indent).
  const firstRun = line.runs[0];
  if (localX < firstRun.x) {
    const offset = charsBeforeLine;
    return {
      blockId: lb.block.id,
      offset,
      lineAffinity: affinityForOffset(offset),
    };
  }

  // Find character within a run. Walks runs in order, then binary-
  // searches on `run.charOffsets` (cumulative widths) for the boundary
  // closest to `localRunX`.
  let charsBeforeRun = 0;
  for (const run of line.runs) {
    if (localX >= run.x && localX <= run.x + run.width) {
      const localRunX = localX - run.x;
      let charOffset = 0;
      const offsets = run.charOffsets;
      if (offsets.length > 0 && localRunX > 0) {
        let lo = 0;
        let hi = offsets.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (offsets[mid] < localRunX) {
            lo = mid + 1;
          } else {
            hi = mid;
          }
        }
        // `lo` is the first index where `offsets[lo] >= localRunX`.
        // Snap to nearest: compare midpoint between prev and current.
        const prev = lo > 0 ? offsets[lo - 1] : 0;
        charOffset = (localRunX - prev < offsets[lo] - localRunX) ? lo : lo + 1;
      }
      const clampedOffset = Math.min(charOffset, run.text.length);
      const offset = charsBeforeLine + charsBeforeRun + clampedOffset;
      return {
        blockId: lb.block.id,
        offset,
        lineAffinity: affinityForOffset(offset),
      };
    }
    charsBeforeRun += run.text.length;
  }

  // Past end of line. Sum the line's char count to get the end offset.
  const lineCharCount = line.runs.reduce(
    (sum, r) => sum + (r.charEnd - r.charStart),
    0,
  );
  let endOffset = charsBeforeLine + lineCharCount;

  // Wrapped (non-last) lines: trim trailing spaces so a click past the
  // soft-wrap doesn't slide the caret onto the next visual line. The
  // last line in a block keeps its trailing spaces — they're real
  // content the user can land between.
  const isLastLineInBlock = targetLineIndex === lb.lines.length - 1;
  if (!isLastLineInBlock && line.runs.length > 0) {
    const lastRun = line.runs[line.runs.length - 1];
    let trim = 0;
    for (let i = lastRun.text.length - 1; i >= 0; i--) {
      if (lastRun.text[i] === ' ') trim++;
      else break;
    }
    endOffset -= trim;
  }

  return {
    blockId: lb.block.id,
    offset: endOffset,
    lineAffinity: 'backward',
  };
}

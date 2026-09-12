import { Axis, MergeSpan, Range, Ref, Sref } from '../core/types';
import { parseRef, toSref } from '../core/coordinates';
import { remapIndex } from './shifting';

/**
 * `toMergeRange` returns the covered range for a merge anchor and span.
 */
export function toMergeRange(anchor: Ref, span: MergeSpan): Range {
  return [
    { r: anchor.r, c: anchor.c },
    { r: anchor.r + span.rs - 1, c: anchor.c + span.cs - 1 },
  ];
}

/**
 * `isRefInMerge` returns whether `ref` is inside the merged range.
 */
export function isRefInMerge(ref: Ref, anchor: Ref, span: MergeSpan): boolean {
  return (
    ref.r >= anchor.r &&
    ref.r <= anchor.r + span.rs - 1 &&
    ref.c >= anchor.c &&
    ref.c <= anchor.c + span.cs - 1
  );
}

/**
 * `shiftMergeAxis` shifts a merged interval along one axis for insert/delete.
 * Returns null when the merge is fully deleted.
 */
function shiftMergeAxis(
  start: number,
  end: number,
  index: number,
  count: number,
): [number, number] | null {
  if (count > 0) {
    if (index <= start) return [start + count, end + count];
    if (index <= end) return [start, end + count];
    return [start, end];
  }

  const absCount = Math.abs(count);
  const delStart = index;
  const delEnd = index + absCount - 1;

  if (delEnd < start) return [start + count, end + count];
  if (delStart > end) return [start, end];

  const overlapStart = Math.max(start, delStart);
  const overlapEnd = Math.min(end, delEnd);
  const removed = overlapEnd - overlapStart + 1;
  const remaining = end - start + 1 - removed;
  if (remaining <= 0) return null;

  if (delStart <= start) {
    return [delStart, delStart + remaining - 1];
  }
  return [start, start + remaining - 1];
}

/**
 * `shiftMerge` shifts a merge anchor/span for insert/delete operations.
 */
export function shiftMerge(
  anchor: Ref,
  span: MergeSpan,
  axis: Axis,
  index: number,
  count: number,
): { anchor: Ref; span: MergeSpan } | null {
  const rowRange = shiftMergeAxis(
    anchor.r,
    anchor.r + span.rs - 1,
    axis === 'row' ? index : Number.NEGATIVE_INFINITY,
    axis === 'row' ? count : 0,
  );
  if (!rowRange) return null;

  const colRange = shiftMergeAxis(
    anchor.c,
    anchor.c + span.cs - 1,
    axis === 'column' ? index : Number.NEGATIVE_INFINITY,
    axis === 'column' ? count : 0,
  );
  if (!colRange) return null;

  const [startRow, endRow] = rowRange;
  const [startCol, endCol] = colRange;
  const rs = endRow - startRow + 1;
  const cs = endCol - startCol + 1;
  if (rs <= 1 && cs <= 1) return null;

  return {
    anchor: { r: startRow, c: startCol },
    span: { rs, cs },
  };
}

/**
 * `moveMerge` remaps a merge for row/column move operations.
 */
export function moveMerge(
  anchor: Ref,
  span: MergeSpan,
  axis: Axis,
  src: number,
  count: number,
  dst: number,
): { anchor: Ref; span: MergeSpan } | null {
  const end = axis === 'row' ? anchor.r + span.rs - 1 : anchor.c + span.cs - 1;
  const start = axis === 'row' ? anchor.r : anchor.c;

  const mappedStart = remapIndex(start, src, count, dst);
  const mappedEnd = remapIndex(end, src, count, dst);
  const newStart = Math.min(mappedStart, mappedEnd);
  const newEnd = Math.max(mappedStart, mappedEnd);
  const newLen = newEnd - newStart + 1;

  if (axis === 'row') {
    const rs = newLen;
    const cs = span.cs;
    if (rs <= 1 && cs <= 1) return null;
    return {
      anchor: { r: newStart, c: anchor.c },
      span: { rs, cs },
    };
  }

  const rs = span.rs;
  const cs = newLen;
  if (rs <= 1 && cs <= 1) return null;
  return {
    anchor: { r: anchor.r, c: newStart },
    span: { rs, cs },
  };
}

/**
 * `shiftMergeMap` shifts a merge map after row/column insert/delete.
 */
export function shiftMergeMap(
  merges: Map<Sref, MergeSpan>,
  axis: Axis,
  index: number,
  count: number,
): Map<Sref, MergeSpan> {
  const next = new Map<Sref, MergeSpan>();
  for (const [anchorSref, span] of merges) {
    const anchor = parseRef(anchorSref);
    const shifted = shiftMerge(anchor, span, axis, index, count);
    if (!shifted) continue;
    next.set(toSref(shifted.anchor), shifted.span);
  }
  return next;
}

/**
 * `moveMergeMap` remaps a merge map after row/column move.
 */
export function moveMergeMap(
  merges: Map<Sref, MergeSpan>,
  axis: Axis,
  src: number,
  count: number,
  dst: number,
): Map<Sref, MergeSpan> {
  const next = new Map<Sref, MergeSpan>();
  for (const [anchorSref, span] of merges) {
    const anchor = parseRef(anchorSref);
    const moved = moveMerge(anchor, span, axis, src, count, dst);
    if (!moved) continue;
    next.set(toSref(moved.anchor), moved.span);
  }
  return next;
}

/**
 * `crossesFreezePane` returns whether a range straddles a frozen row or column
 * boundary. A merged block that does is not drawable — the renderer paints the
 * frozen pane and the scrolling body from a single block — so it is the state
 * merging, pasting, moving and reordering all refuse to create.
 */
export function crossesFreezePane(
  range: Range,
  frozenRows: number,
  frozenCols: number,
): boolean {
  const crossesRows =
    frozenRows > 0 && range[0].r <= frozenRows && range[1].r > frozenRows;
  const crossesCols =
    frozenCols > 0 && range[0].c <= frozenCols && range[1].c > frozenCols;
  return crossesRows || crossesCols;
}

/**
 * `snapFreezePastMerges` grows the given freeze counts until no merged block
 * straddles either boundary. Growing one boundary can pull a further block
 * across it, so a naive version repeats until stable — but that is quadratic in
 * the merge count, and the merge map is caller-supplied (the v1 worksheet API
 * writes it wholesale), while this runs synchronously inside `doc.update` on
 * every freeze and on every insert/delete that shifts view state. So it sweeps
 * each axis once in start order instead.
 *
 * That one sweep is exact: the line only ever grows, and it grows only from a
 * block whose start is already at or before it. Once the sweep reaches a block
 * starting past the line, every remaining block starts no earlier, so none of
 * them can straddle and the line is settled — hence the `break`. Every block
 * already visited ended at or before the line when it was visited, and the line
 * has only grown since.
 *
 * Freezing is the one path that reaches a straddling block without moving one,
 * so it snaps the line rather than refusing the gesture: the whole block ends
 * up frozen, which is what the user asked for plus the rows the layout makes
 * inseparable from them.
 */
export function snapFreezePastMerges(
  merges: Iterable<[Sref, MergeSpan]>,
  frozenRows: number,
  frozenCols: number,
): { frozenRows: number; frozenCols: number } {
  const ranges: Array<Range> = [];
  for (const [anchorSref, span] of merges) {
    ranges.push(toMergeRange(parseRef(anchorSref), span));
  }

  const sweep = (
    line: number,
    start: (range: Range) => number,
    end: (range: Range) => number,
  ): number => {
    if (line <= 0) return line;
    let snapped = line;
    for (const range of [...ranges].sort((a, b) => start(a) - start(b))) {
      if (start(range) > snapped) break;
      if (end(range) > snapped) snapped = end(range);
    }
    return snapped;
  };

  return {
    frozenRows: sweep(
      frozenRows,
      (range) => range[0].r,
      (range) => range[1].r,
    ),
    frozenCols: sweep(
      frozenCols,
      (range) => range[0].c,
      (range) => range[1].c,
    ),
  };
}

/**
 * `isMergeSplitByMove` returns true when move source partially intersects a merge.
 */
export function isMergeSplitByMove(
  anchor: Ref,
  span: MergeSpan,
  axis: Axis,
  src: number,
  count: number,
): boolean {
  const start = axis === 'row' ? anchor.r : anchor.c;
  const end = axis === 'row' ? anchor.r + span.rs - 1 : anchor.c + span.cs - 1;
  const srcEnd = src + count - 1;
  const overlaps = !(end < src || start > srcEnd);
  if (!overlaps) return false;
  const fullyInside = start >= src && end <= srcEnd;
  return !fullyInside;
}

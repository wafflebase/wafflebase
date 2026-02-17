import { Axis, MergeSpan, Range, Ref, Sref } from './types';
import { parseRef, toSref } from './coordinates';
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

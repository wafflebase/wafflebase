import { Axis, CellStyle, Range } from './types';

export type RangeStylePatch = {
  range: Range;
  style: CellStyle;
};

type Interval = [number, number];

/**
 * Removes undefined keys from a style patch and returns undefined if empty.
 */
export function normalizeStylePatch(
  style: Partial<CellStyle>,
): CellStyle | undefined {
  const normalized: Partial<Record<keyof CellStyle, CellStyle[keyof CellStyle]>> =
    {};
  for (const key of Object.keys(style) as Array<keyof CellStyle>) {
    const value = style[key];
    if (value !== undefined) {
      normalized[key] = value as CellStyle[keyof CellStyle];
    }
  }
  return Object.keys(normalized).length > 0
    ? (normalized as CellStyle)
    : undefined;
}

/**
 * Applies a style patch on top of an existing style object.
 */
export function mergeStylePatch(
  base: CellStyle | undefined,
  patch: Partial<CellStyle>,
): CellStyle | undefined {
  const next: Partial<Record<keyof CellStyle, CellStyle[keyof CellStyle]>> = base
    ? { ...base }
    : {};
  let changed = false;
  for (const key of Object.keys(patch) as Array<keyof CellStyle>) {
    const value = patch[key];
    if (value === undefined) {
      continue;
    }
    next[key] = value as CellStyle[keyof CellStyle];
    changed = true;
  }

  if (Object.keys(next).length === 0) {
    return undefined;
  }
  if (!base && !changed) {
    return undefined;
  }
  return next as CellStyle;
}

function normalizeRange(range: Range): Range {
  const top = Math.min(range[0].r, range[1].r);
  const left = Math.min(range[0].c, range[1].c);
  const bottom = Math.max(range[0].r, range[1].r);
  const right = Math.max(range[0].c, range[1].c);
  return [
    { r: top, c: left },
    { r: bottom, c: right },
  ];
}

/**
 * Creates a deep copy of a range-style patch with normalized coordinates.
 */
export function cloneRangeStylePatch(patch: RangeStylePatch): RangeStylePatch {
  return {
    range: normalizeRange(patch.range),
    style: { ...patch.style },
  };
}

/**
 * Normalizes range coordinates and drops patches with no concrete style values.
 */
export function normalizeRangeStylePatch(
  patch: RangeStylePatch,
): RangeStylePatch | undefined {
  const style = normalizeStylePatch(patch.style);
  if (!style) {
    return undefined;
  }
  return {
    range: normalizeRange(patch.range),
    style,
  };
}

/**
 * Compares two style objects by key/value pairs.
 */
export function stylesEqual(a: CellStyle, b: CellStyle): boolean {
  const aKeys = Object.keys(a) as Array<keyof CellStyle>;
  const bKeys = Object.keys(b) as Array<keyof CellStyle>;
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  for (const key of aKeys) {
    if (a[key] !== b[key]) {
      return false;
    }
  }
  return true;
}

function containsRange(outer: Range, inner: Range): boolean {
  return (
    outer[0].r <= inner[0].r &&
    outer[0].c <= inner[0].c &&
    outer[1].r >= inner[1].r &&
    outer[1].c >= inner[1].c
  );
}

/**
 * Drops older patches whose style keys are fully shadowed by later patches
 * that contain their range. Individual keys are pruned; if all keys are
 * removed, the entire patch is dropped.
 */
export function pruneShadowedRangeStylePatches(
  patches: RangeStylePatch[],
): RangeStylePatch[] {
  const keptReversed: RangeStylePatch[] = [];

  for (let i = patches.length - 1; i >= 0; i--) {
    const normalized = normalizeRangeStylePatch(patches[i]);
    if (!normalized) {
      continue;
    }

    const prunedStyle: Partial<
      Record<keyof CellStyle, CellStyle[keyof CellStyle]>
    > = {};

    for (const key of Object.keys(normalized.style) as Array<keyof CellStyle>) {
      let keyShadowed = false;
      for (const later of keptReversed) {
        if (!containsRange(later.range, normalized.range)) {
          continue;
        }
        if (key in later.style) {
          keyShadowed = true;
          break;
        }
      }
      if (!keyShadowed) {
        prunedStyle[key] = normalized.style[key] as CellStyle[keyof CellStyle];
      }
    }

    if (Object.keys(prunedStyle).length > 0) {
      keptReversed.push(
        cloneRangeStylePatch({
          range: normalized.range,
          style: prunedStyle as CellStyle,
        }),
      );
    }
  }

  return keptReversed.reverse();
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length <= 1) {
    return intervals;
  }

  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const merged: Interval[] = [];

  for (const curr of sorted) {
    const prev = merged[merged.length - 1];
    if (!prev) {
      merged.push([curr[0], curr[1]]);
      continue;
    }
    if (curr[0] <= prev[1] + 1) {
      prev[1] = Math.max(prev[1], curr[1]);
      continue;
    }
    merged.push([curr[0], curr[1]]);
  }

  return merged;
}

function shiftInterval(
  start: number,
  end: number,
  index: number,
  count: number,
): Interval[] {
  if (count === 0) {
    return [[start, end]];
  }

  if (count > 0) {
    if (end < index) {
      return [[start, end]];
    }
    if (start >= index) {
      return [[start + count, end + count]];
    }
    // Insertion inside a styled interval expands the interval so inserted
    // rows/columns inherit the same style range.
    return [[start, end + count]];
  }

  const absCount = Math.abs(count);
  const deletedEnd = index + absCount - 1;
  const intervals: Interval[] = [];

  if (start < index) {
    intervals.push([start, Math.min(end, index - 1)]);
  }

  if (end > deletedEnd) {
    intervals.push([Math.max(start, deletedEnd + 1) + count, end + count]);
  }

  return mergeIntervals(intervals.filter(([s, e]) => s <= e));
}

function moveInterval(
  start: number,
  end: number,
  src: number,
  count: number,
  dst: number,
): Interval[] {
  const srcEnd = src + count;
  const segments: Array<{ start: number; end: number; delta: number }> = [];

  if (dst <= src) {
    segments.push({ start: Number.NEGATIVE_INFINITY, end: dst - 1, delta: 0 });
    segments.push({ start: dst, end: src - 1, delta: count });
    segments.push({ start: src, end: srcEnd - 1, delta: dst - src });
    segments.push({ start: srcEnd, end: Number.POSITIVE_INFINITY, delta: 0 });
  } else {
    segments.push({ start: Number.NEGATIVE_INFINITY, end: src - 1, delta: 0 });
    segments.push({
      start: src,
      end: srcEnd - 1,
      delta: dst - count - src,
    });
    segments.push({ start: srcEnd, end: dst - 1, delta: -count });
    segments.push({ start: dst, end: Number.POSITIVE_INFINITY, delta: 0 });
  }

  const mapped: Interval[] = [];
  for (const segment of segments) {
    const segmentStart = Math.max(start, segment.start);
    const segmentEnd = Math.min(end, segment.end);
    if (segmentStart > segmentEnd) {
      continue;
    }
    mapped.push([
      segmentStart + segment.delta,
      segmentEnd + segment.delta,
    ]);
  }

  return mergeIntervals(mapped);
}

function patchesFromIntervals(
  patch: RangeStylePatch,
  axis: Axis,
  intervals: Interval[],
): RangeStylePatch[] {
  const next: RangeStylePatch[] = [];

  for (const [start, end] of intervals) {
    if (axis === 'row') {
      next.push({
        range: [
          { r: start, c: patch.range[0].c },
          { r: end, c: patch.range[1].c },
        ],
        style: { ...patch.style },
      });
      continue;
    }

    next.push({
      range: [
        { r: patch.range[0].r, c: start },
        { r: patch.range[1].r, c: end },
      ],
      style: { ...patch.style },
    });
  }

  return next;
}

/**
 * Merges consecutive patches with the same style along a row or column axis.
 */
export function coalesceAdjacentRangeStylePatches(
  patches: RangeStylePatch[],
  axis: Axis,
): RangeStylePatch[] {
  if (patches.length <= 1) {
    return patches.map(cloneRangeStylePatch);
  }

  const coalesced: RangeStylePatch[] = [];
  for (const patch of patches) {
    const normalized = normalizeRangeStylePatch(patch);
    if (!normalized) {
      continue;
    }

    const prev = coalesced[coalesced.length - 1];
    if (!prev || !stylesEqual(prev.style, normalized.style)) {
      coalesced.push(normalized);
      continue;
    }

    if (axis === 'row') {
      const sameCols =
        prev.range[0].c === normalized.range[0].c &&
        prev.range[1].c === normalized.range[1].c;
      const adjacentRows = normalized.range[0].r <= prev.range[1].r + 1;
      if (!sameCols || !adjacentRows) {
        coalesced.push(normalized);
        continue;
      }
      prev.range[0].r = Math.min(prev.range[0].r, normalized.range[0].r);
      prev.range[1].r = Math.max(prev.range[1].r, normalized.range[1].r);
      continue;
    }

    const sameRows =
      prev.range[0].r === normalized.range[0].r &&
      prev.range[1].r === normalized.range[1].r;
    const adjacentCols = normalized.range[0].c <= prev.range[1].c + 1;
    if (!sameRows || !adjacentCols) {
      coalesced.push(normalized);
      continue;
    }
    prev.range[0].c = Math.min(prev.range[0].c, normalized.range[0].c);
    prev.range[1].c = Math.max(prev.range[1].c, normalized.range[1].c);
  }

  return coalesced;
}

/**
 * Applies row/column insert-delete shifts to style patch ranges.
 */
export function shiftRangeStylePatches(
  patches: RangeStylePatch[],
  axis: Axis,
  index: number,
  count: number,
): RangeStylePatch[] {
  const shifted: RangeStylePatch[] = [];

  for (const patch of patches) {
    const normalized = normalizeRangeStylePatch(patch);
    if (!normalized) {
      continue;
    }
    const intervals =
      axis === 'row'
        ? shiftInterval(
            normalized.range[0].r,
            normalized.range[1].r,
            index,
            count,
          )
        : shiftInterval(
            normalized.range[0].c,
            normalized.range[1].c,
            index,
            count,
          );
    shifted.push(...patchesFromIntervals(normalized, axis, intervals));
  }

  return pruneShadowedRangeStylePatches(
    coalesceAdjacentRangeStylePatches(shifted, axis),
  );
}

/**
 * Applies row/column move operations to style patch ranges.
 */
export function moveRangeStylePatches(
  patches: RangeStylePatch[],
  axis: Axis,
  src: number,
  count: number,
  dst: number,
): RangeStylePatch[] {
  const moved: RangeStylePatch[] = [];

  for (const patch of patches) {
    const normalized = normalizeRangeStylePatch(patch);
    if (!normalized) {
      continue;
    }
    const intervals =
      axis === 'row'
        ? moveInterval(
            normalized.range[0].r,
            normalized.range[1].r,
            src,
            count,
            dst,
          )
        : moveInterval(
            normalized.range[0].c,
            normalized.range[1].c,
            src,
            count,
            dst,
          );
    moved.push(...patchesFromIntervals(normalized, axis, intervals));
  }

  return pruneShadowedRangeStylePatches(
    coalesceAdjacentRangeStylePatches(moved, axis),
  );
}

/**
 * Intersects style patches with a clip range.
 */
export function clipRangeStylePatches(
  patches: RangeStylePatch[],
  clipRange: Range,
): RangeStylePatch[] {
  const normalizedClip = normalizeRange(clipRange);
  const clipped: RangeStylePatch[] = [];

  for (const patch of patches) {
    const normalized = normalizeRangeStylePatch(patch);
    if (!normalized) {
      continue;
    }

    const startRow = Math.max(normalized.range[0].r, normalizedClip[0].r);
    const endRow = Math.min(normalized.range[1].r, normalizedClip[1].r);
    const startCol = Math.max(normalized.range[0].c, normalizedClip[0].c);
    const endCol = Math.min(normalized.range[1].c, normalizedClip[1].c);
    if (startRow > endRow || startCol > endCol) {
      continue;
    }

    clipped.push({
      range: [
        { r: startRow, c: startCol },
        { r: endRow, c: endCol },
      ],
      style: { ...normalized.style },
    });
  }

  return clipped;
}

/**
 * Translates style patch ranges by row and column deltas.
 */
export function translateRangeStylePatches(
  patches: RangeStylePatch[],
  rowDelta: number,
  colDelta: number,
): RangeStylePatch[] {
  const translated: RangeStylePatch[] = [];

  for (const patch of patches) {
    const normalized = normalizeRangeStylePatch(patch);
    if (!normalized) {
      continue;
    }

    const startRow = normalized.range[0].r + rowDelta;
    const endRow = normalized.range[1].r + rowDelta;
    const startCol = normalized.range[0].c + colDelta;
    const endCol = normalized.range[1].c + colDelta;
    if (endRow < 1 || endCol < 1) {
      continue;
    }

    translated.push({
      range: [
        { r: Math.max(1, startRow), c: Math.max(1, startCol) },
        { r: Math.max(1, endRow), c: Math.max(1, endCol) },
      ],
      style: { ...normalized.style },
    });
  }

  return translated;
}

/**
 * Resolves the effective style at a cell by applying matching patches in order.
 */
export function resolveRangeStyleAt(
  patches: RangeStylePatch[],
  row: number,
  col: number,
): CellStyle | undefined {
  let resolved: CellStyle | undefined;

  for (const patch of patches) {
    if (
      row < patch.range[0].r ||
      row > patch.range[1].r ||
      col < patch.range[0].c ||
      col > patch.range[1].c
    ) {
      continue;
    }
    resolved = mergeStylePatch(resolved, patch.style);
  }

  return resolved;
}

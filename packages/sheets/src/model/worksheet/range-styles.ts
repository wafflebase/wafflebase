import { toRange } from '../core/coordinates';
import { Axis, CellStyle, Range } from '../core/types';

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

/**
 * Creates a deep copy of a range-style patch with normalized coordinates.
 */
export function cloneRangeStylePatch(patch: RangeStylePatch): RangeStylePatch {
  return {
    range: toRange(patch.range[0], patch.range[1]),
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
    range: toRange(patch.range[0], patch.range[1]),
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
 * Builds a stable, order-independent key for a style so equal styles collapse
 * to the same rectangle regardless of key insertion order.
 */
function styleKey(style: CellStyle): string {
  const keys = Object.keys(style).sort();
  return keys
    .map((k) => `${k}:${JSON.stringify(style[k as keyof CellStyle])}`)
    .join('|');
}

// Above this bounding-box cell count the tiler (which materializes the grid)
// falls back to the cheap adjacent merge. This runs client-side during import,
// so the cap is sized to bound peak memory (~one Map entry per cell); a
// degenerate sheet with a lone styled cell far from the data, or a genuinely
// huge densely-styled range, degrades to the prior behavior rather than
// OOM-ing the tab. Real imports stay orders of magnitude below this.
const MAXIMAL_TILING_CELL_CAP = 1_000_000;

/**
 * Recompacts range-style patches into a minimal-ish set of non-overlapping
 * rectangles via greedy maximal-rectangle tiling.
 *
 * The importer emits one 1×1 patch per styled cell; a two-pass adjacent merge
 * (`coalesceAdjacentRangeStylePatches`) only fuses perfectly-aligned neighbors,
 * so a table with a header row *and* a label column (no whole row/column is a
 * single style) stays fragmented into thousands of rectangles — each an
 * expensive CRDT subtree once stored in Yorkie. This resolves every cell to the
 * exact style `resolveRangeStyleAt` would (folding overlapping patches key by
 * key, in order), then tiles same-style regions into maximal rectangles,
 * cutting the patch count — and the resulting document size — dramatically.
 *
 * The output is non-overlapping, so apply order no longer matters; cells with
 * no style stay unstyled (gaps are never covered).
 */
export function coalesceRangeStylePatchesMaximal(
  patches: RangeStylePatch[],
): RangeStylePatch[] {
  // Normalize once up front (drops empty-style patches and normalizes ranges)
  // and take the bounding box, so the area cap is checked *before* the grid is
  // materialized rather than after.
  const normalized: RangeStylePatch[] = [];
  let minR = Infinity;
  let minC = Infinity;
  let maxR = 0;
  let maxC = 0;
  for (const patch of patches) {
    const n = normalizeRangeStylePatch(patch);
    if (!n) {
      continue;
    }
    normalized.push(n);
    minR = Math.min(minR, n.range[0].r);
    minC = Math.min(minC, n.range[0].c);
    maxR = Math.max(maxR, n.range[1].r);
    maxC = Math.max(maxC, n.range[1].c);
  }

  if (normalized.length === 0) {
    return [];
  }
  // A single normalized patch is already one rectangle — no tiling needed.
  if (normalized.length === 1) {
    return normalized;
  }

  const area = (maxR - minR + 1) * (maxC - minC + 1);
  if (area > MAXIMAL_TILING_CELL_CAP) {
    return coalesceAdjacentRangeStylePatches(
      coalesceAdjacentRangeStylePatches(normalized, 'column'),
      'row',
    );
  }

  // Resolve each styled cell to its final style key, folding overlapping
  // patches key by key in apply order — identical to `resolveRangeStyleAt`.
  // For the importer's disjoint 1×1 patches each cell is touched once, so the
  // merge branch never runs and this stays a plain last-write assignment.
  const cellKey = new Map<string, string>();
  const styleByKey = new Map<string, CellStyle>();
  for (const patch of normalized) {
    const patchKey = styleKey(patch.style);
    if (!styleByKey.has(patchKey)) {
      styleByKey.set(patchKey, patch.style);
    }
    const [start, end] = patch.range;
    for (let r = start.r; r <= end.r; r += 1) {
      for (let c = start.c; c <= end.c; c += 1) {
        const id = `${r},${c}`;
        const existing = cellKey.get(id);
        if (existing === undefined) {
          cellKey.set(id, patchKey);
          continue;
        }
        // Overlap: merge the earlier style under the later one, key by key.
        const merged = mergeStylePatch(styleByKey.get(existing), patch.style);
        if (!merged) {
          cellKey.delete(id);
          continue;
        }
        const mergedKey = styleKey(merged);
        if (!styleByKey.has(mergedKey)) {
          styleByKey.set(mergedKey, merged);
        }
        cellKey.set(id, mergedKey);
      }
    }
  }

  if (cellKey.size === 0) {
    return [];
  }

  const used = new Set<string>();
  const result: RangeStylePatch[] = [];
  for (let r = minR; r <= maxR; r += 1) {
    for (let c = minC; c <= maxC; c += 1) {
      const id = `${r},${c}`;
      if (used.has(id)) {
        continue;
      }
      const key = cellKey.get(id);
      if (key === undefined) {
        continue;
      }

      // Extend right along the same style.
      let endC = c;
      while (
        endC + 1 <= maxC &&
        !used.has(`${r},${endC + 1}`) &&
        cellKey.get(`${r},${endC + 1}`) === key
      ) {
        endC += 1;
      }

      // Extend down while the full [c..endC] band matches the style.
      let endR = r;
      for (let nextR = r + 1; nextR <= maxR; nextR += 1) {
        let bandMatches = true;
        for (let cc = c; cc <= endC; cc += 1) {
          const nid = `${nextR},${cc}`;
          if (used.has(nid) || cellKey.get(nid) !== key) {
            bandMatches = false;
            break;
          }
        }
        if (!bandMatches) {
          break;
        }
        endR = nextR;
      }

      for (let rr = r; rr <= endR; rr += 1) {
        for (let cc = c; cc <= endC; cc += 1) {
          used.add(`${rr},${cc}`);
        }
      }
      result.push({
        range: [{ r, c }, { r: endR, c: endC }],
        style: { ...(styleByKey.get(key) as CellStyle) },
      });
    }
  }

  return result;
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
  const normalizedClip = toRange(clipRange[0], clipRange[1]);
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
 * Subtracts a range from a patch, returning 0–4 remaining rectangles.
 *
 * The subtraction carves out the intersection and keeps up to four strips:
 *   - top:    rows above the hole
 *   - bottom: rows below the hole
 *   - left:   columns left of the hole (within overlapping rows)
 *   - right:  columns right of the hole (within overlapping rows)
 */
export function subtractRange(
  patch: RangeStylePatch,
  hole: Range,
): RangeStylePatch[] {
  const p = toRange(patch.range[0], patch.range[1]);
  const h = toRange(hole[0], hole[1]);

  // No intersection — return the patch unchanged.
  if (p[0].r > h[1].r || p[1].r < h[0].r || p[0].c > h[1].c || p[1].c < h[0].c) {
    return [{ range: [{ ...p[0] }, { ...p[1] }], style: { ...patch.style } }];
  }

  const results: RangeStylePatch[] = [];

  // Top strip
  if (p[0].r < h[0].r) {
    results.push({
      range: [{ r: p[0].r, c: p[0].c }, { r: h[0].r - 1, c: p[1].c }],
      style: { ...patch.style },
    });
  }

  // Bottom strip
  if (p[1].r > h[1].r) {
    results.push({
      range: [{ r: h[1].r + 1, c: p[0].c }, { r: p[1].r, c: p[1].c }],
      style: { ...patch.style },
    });
  }

  // Overlapping row band
  const overlapTop = Math.max(p[0].r, h[0].r);
  const overlapBottom = Math.min(p[1].r, h[1].r);

  // Left strip (within overlapping rows)
  if (p[0].c < h[0].c) {
    results.push({
      range: [{ r: overlapTop, c: p[0].c }, { r: overlapBottom, c: h[0].c - 1 }],
      style: { ...patch.style },
    });
  }

  // Right strip (within overlapping rows)
  if (p[1].c > h[1].c) {
    results.push({
      range: [{ r: overlapTop, c: h[1].c + 1 }, { r: overlapBottom, c: p[1].c }],
      style: { ...patch.style },
    });
  }

  return results;
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

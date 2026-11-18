import { boundingBox, type Frame, type Point } from '@wafflebase/slides';

/**
 * Placement for elements an agent adds or arranges without giving
 * coordinates: lay a batch out as a grid and put the grid somewhere it
 * covers nothing. The interactive sticky flow aims at the viewport centre
 * (`frontend/src/app/board/sticky.ts#freeStickyCenter`); an agent has no
 * viewport, so this aims beside the existing content instead.
 */

/** Space between grid cells — the sticky flow's own gap. */
export const AGENT_GRID_GAP = 24;

/** Space between a placed batch and the content it steps away from. */
export const AGENT_PLACE_GAP = 96;

/** How many rings the free-space search walks before giving up. */
const MAX_RINGS = 24;

export interface Size {
  w: number;
  h: number;
}

/** Columns for `count` cells: a near-square grid, wider than tall. */
export function gridColumns(count: number): number {
  return Math.max(1, Math.ceil(Math.sqrt(count)));
}

/** The outer size of a `count`-cell grid of `cell`-sized cells. */
export function gridSize(
  count: number,
  cell: Size,
  columns: number = gridColumns(count),
  gap: number = AGENT_GRID_GAP,
): Size {
  const cols = Math.max(1, Math.min(columns, Math.max(1, count)));
  const rows = Math.max(1, Math.ceil(count / cols));
  return { w: cols * cell.w + (cols - 1) * gap, h: rows * cell.h + (rows - 1) * gap };
}

/** Top-left corners of a grid's cells, in reading order. */
export function gridOrigins(
  count: number,
  origin: Point,
  cell: Size,
  columns: number = gridColumns(count),
  gap: number = AGENT_GRID_GAP,
): Point[] {
  const cols = Math.max(1, columns);
  const out: Point[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      x: origin.x + (i % cols) * (cell.w + gap),
      y: origin.y + Math.floor(i / cols) * (cell.h + gap),
    });
  }
  return out;
}

/** The axis-aligned box around `frames`, or `undefined` when there are none. */
export function contentBounds(frames: readonly Frame[]): Frame | undefined {
  if (frames.length === 0) return undefined;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const f of frames) {
    const b = boundingBox(f);
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, rotation: 0 };
}

type Box = { x: number; y: number; w: number; h: number };

function overlaps(a: Box, b: Box, margin: number): boolean {
  return (
    a.x < b.x + b.w + margin &&
    b.x < a.x + a.w + margin &&
    a.y < b.y + b.h + margin &&
    b.y < a.y + a.h + margin
  );
}

/** 0, 1, -1, 2, -2, … : nearest first, the positive side first. */
function offsetRank(k: number): number {
  return k === 0 ? 0 : k > 0 ? 2 * k - 1 : -2 * k;
}

/** Candidate offsets ring by ring, each ring in reading order (nearest first). */
function ringOrder(rings: number): { i: number; j: number }[] {
  const out: { i: number; j: number }[] = [];
  for (let r = 0; r <= rings; r++) {
    const ring: { i: number; j: number }[] = [];
    for (let j = -r; j <= r; j++) {
      for (let i = -r; i <= r; i++) {
        if (Math.max(Math.abs(i), Math.abs(j)) === r) ring.push({ i, j });
      }
    }
    ring.sort(
      (a, b) => offsetRank(a.j) - offsetRank(b.j) || offsetRank(a.i) - offsetRank(b.i),
    );
    out.push(...ring);
  }
  return out;
}

const RING_ORDER = ringOrder(MAX_RINGS);

/**
 * The candidate steps `k` in `[-MAX_RINGS, MAX_RINGS]` along one axis whose
 * span `[aim + k·step, aim + k·step + len]` comes within `gap` of
 * `[b0, b0 + bLen]` — the one-axis half of {@link overlaps}, evaluated with
 * the same float expressions. Both conditions are monotone in `k`, so the
 * blocked steps are one range: estimated arithmetically, then settled
 * against the exact predicate (a bounded walk). `null` when none is blocked.
 */
function blockedSteps(
  aim: number,
  step: number,
  len: number,
  b0: number,
  bLen: number,
  gap: number,
): [number, number] | null {
  const R = MAX_RINGS;
  const before = (k: number) => aim + k * step < b0 + bLen + gap;
  const after = (k: number) => b0 < aim + k * step + len + gap;
  let lo = Math.min(R + 1, Math.max(-R, Math.ceil((b0 - len - gap - aim) / step)));
  let hi = Math.min(R, Math.max(-R - 1, Math.floor((b0 + bLen + gap - aim) / step)));
  if (Number.isNaN(lo) || Number.isNaN(hi)) return null;
  while (lo > -R && after(lo - 1)) lo--;
  while (lo <= R && !after(lo)) lo++;
  while (hi < R && before(hi + 1)) hi++;
  while (hi >= -R && !before(hi)) hi--;
  return lo <= hi ? [lo, hi] : null;
}

/**
 * Where a `size` box aimed at top-left `aim` goes so that it covers
 * nothing in `occupied` (keeping `gap` clear around it). Tries `aim`, then
 * rings of box-sized steps around it in reading order — the search the
 * sticky flow runs, with the whole batch as the unit. Past the last ring it
 * lands just right of everything.
 *
 * Every candidate sits on one lattice (`aim` + whole steps), so each box
 * marks the rectangle of candidates it blocks in a 2D difference array
 * instead of being tested against every candidate: O(boxes + candidates),
 * not their product, on a board of any size. The result is the same as
 * testing each candidate against each box.
 */
export function findFreeRect(
  occupied: readonly Frame[],
  size: Size,
  aim: Point,
  gap: number = AGENT_GRID_GAP,
): Point {
  const boxes = occupied.map((f) => boundingBox(f));
  const stepX = size.w + gap;
  const stepY = size.h + gap;
  if (!(stepX > 0 && stepY > 0 && Number.isFinite(aim.x) && Number.isFinite(aim.y))) {
    return findFreeRectBrute(boxes, size, aim, gap);
  }
  const R = MAX_RINGS;
  const D = 2 * R + 1;
  const W = D + 1;
  const diff = new Int32Array(W * W);
  for (const b of boxes) {
    const xs = blockedSteps(aim.x, stepX, size.w, b.x, b.w, gap);
    if (!xs) continue;
    const ys = blockedSteps(aim.y, stepY, size.h, b.y, b.h, gap);
    if (!ys) continue;
    const [i0, i1] = [xs[0] + R, xs[1] + R + 1];
    const [j0, j1] = [ys[0] + R, ys[1] + R + 1];
    diff[j0 * W + i0]++;
    diff[j0 * W + i1]--;
    diff[j1 * W + i0]--;
    diff[j1 * W + i1]++;
  }
  // 2D prefix sum: diff[j][i] becomes how many boxes block candidate (i, j).
  for (let j = 0; j < D; j++) {
    for (let i = 0; i < D; i++) {
      const k = j * W + i;
      if (i > 0) diff[k] += diff[k - 1];
      if (j > 0) diff[k] += diff[k - W];
      if (i > 0 && j > 0) diff[k] -= diff[k - W - 1];
    }
  }
  for (const { i, j } of RING_ORDER) {
    if (diff[(j + R) * W + (i + R)] === 0) {
      return { x: aim.x + i * stepX, y: aim.y + j * stepY };
    }
  }
  const right = boxes.reduce((m, b) => Math.max(m, b.x + b.w), aim.x);
  return { x: right + AGENT_PLACE_GAP, y: aim.y };
}

/** The candidate-by-box search, for a degenerate size or aim the lattice cannot index. */
function findFreeRectBrute(boxes: readonly Box[], size: Size, aim: Point, gap: number): Point {
  const stepX = size.w + gap;
  const stepY = size.h + gap;
  for (const { i, j } of RING_ORDER) {
    const p = { x: aim.x + i * stepX, y: aim.y + j * stepY };
    const box: Box = { x: p.x, y: p.y, w: size.w, h: size.h };
    if (!boxes.some((b) => overlaps(box, b, gap))) return p;
  }
  const right = boxes.reduce((m, b) => Math.max(m, b.x + b.w), aim.x);
  return { x: right + AGENT_PLACE_GAP, y: aim.y };
}

/**
 * The default aim for a batch with no position: just right of the existing
 * content, top-aligned with it — "in free space, next to what is there".
 * An empty board aims at the world origin.
 */
export function besideContent(occupied: readonly Frame[]): Point {
  const bounds = contentBounds(occupied);
  if (!bounds) return { x: 0, y: 0 };
  return { x: bounds.x + bounds.w + AGENT_PLACE_GAP, y: bounds.y };
}

/** Which side of an element `besideFrame` places a box on. */
export type Side = 'right' | 'left' | 'below' | 'above';

/** Top-left of a `size` box placed `gap` away from `frame` on `side`, top/left-aligned. */
export function besideFrame(
  frame: Frame,
  size: Size,
  side: Side = 'right',
  gap: number = AGENT_PLACE_GAP / 2,
): Point {
  const b = boundingBox(frame);
  switch (side) {
    case 'left':
      return { x: b.x - gap - size.w, y: b.y };
    case 'below':
      return { x: b.x, y: b.y + b.h + gap };
    case 'above':
      return { x: b.x, y: b.y - gap - size.h };
    default:
      return { x: b.x + b.w + gap, y: b.y };
  }
}

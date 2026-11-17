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

/**
 * Where a `size` box aimed at top-left `aim` goes so that it covers
 * nothing in `occupied` (keeping `gap` clear around it). Tries `aim`, then
 * rings of box-sized steps around it in reading order — the search the
 * sticky flow runs, with the whole batch as the unit. Past the last ring it
 * lands just right of everything.
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
  const free = (p: Point) => {
    const box: Box = { x: p.x, y: p.y, w: size.w, h: size.h };
    return !boxes.some((b) => overlaps(box, b, gap));
  };
  for (let r = 0; r <= MAX_RINGS; r++) {
    const ring: { i: number; j: number }[] = [];
    for (let j = -r; j <= r; j++) {
      for (let i = -r; i <= r; i++) {
        if (Math.max(Math.abs(i), Math.abs(j)) === r) ring.push({ i, j });
      }
    }
    ring.sort(
      (a, b) => offsetRank(a.j) - offsetRank(b.j) || offsetRank(a.i) - offsetRank(b.i),
    );
    for (const { i, j } of ring) {
      const p = { x: aim.x + i * stepX, y: aim.y + j * stepY };
      if (free(p)) return p;
    }
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

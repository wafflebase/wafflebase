/**
 * Tick + label drawing for ruler canvases. Pure renderer — no DOM,
 * no layout knowledge (pages, slides). The caller fills backgrounds
 * and decorations (indent handles, guide markers); `drawTicks` adds
 * tick marks and integer-unit labels within the measured region.
 *
 * Coordinates are canvas pixels. The caller pre-scales `grid` for
 * the active zoom factor (slides) or passes the unscaled grid
 * (docs at implicit zoom 1).
 */

import type { GridConfig } from './unit.js';

export type TickDensity = 'full' | 'half-only' | 'major' | 'major-thinned';

export interface TickHeights {
  major: number;
  half: number;
  minor: number;
}

export interface DrawTicksOpts {
  ctx: CanvasRenderingContext2D;
  axis: 'h' | 'v';
  /** Canvas-px coord where the measured region begins on this axis. */
  start: number;
  /** Canvas-px length of the measured region on this axis. */
  length: number;
  /** Grid steps in canvas-px space (pre-scaled by the caller). */
  grid: GridConfig;
  /** Stroke + fill color. Caller may also set context state ahead of the call. */
  color?: string;
  /** Label font; defaults to '9px Arial'. */
  labelFont?: string;
  /** Density override; defaults to 'full'. */
  density?: TickDensity;
  /** Ruler thickness in px; defaults to 20. */
  rulerSize?: number;
  /**
   * Per-kind tick lengths in px. Defaults to docs proportions (10 / 7
   * / 4 for a 20-px ruler). Slim rulers (e.g. slides at 14 px) pass
   * smaller values so ticks + labels coexist without overlap.
   */
  tickHeights?: TickHeights;
  /**
   * Inset (in px) for the horizontal ruler's label baseline, measured
   * from the top edge of the ruler canvas. Defaults to 1 — the docs
   * ruler reserves an extra pixel of breathing room. Slim rulers may
   * pass 0 to keep labels from colliding with the major tick.
   */
  labelInset?: number;
  /**
   * Inset (in px) for the rotated label of the vertical ruler,
   * measured from the inner edge of the ruler canvas. Defaults to 6
   * to match the docs ruler. Slim rulers pass a smaller value.
   */
  verticalLabelInset?: number;
}

const DEFAULT_TICK_HEIGHTS: TickHeights = { major: 10, half: 7, minor: 4 };
const DEFAULT_LABEL_FONT = '9px Arial';
const DEFAULT_RULER_SIZE = 20;
const DEFAULT_LABEL_INSET = 1;
const DEFAULT_VERTICAL_LABEL_INSET = 6;

type TickKind = 'major' | 'half' | 'minor';

function classify(i: number, subdivisions: number): TickKind {
  if (i % subdivisions === 0) return 'major';
  if (subdivisions % 2 === 0 && i % (subdivisions / 2) === 0) return 'half';
  return 'minor';
}

function shouldDraw(kind: TickKind, density: TickDensity): boolean {
  if (density === 'full') return true;
  if (density === 'half-only') return kind !== 'minor';
  return kind === 'major';
}

function labelIntervalForDensity(density: TickDensity): number {
  return density === 'major-thinned' ? 2 : 1;
}

export function drawTicks(opts: DrawTicksOpts): void {
  const {
    ctx, axis, start, length, grid,
    color,
    labelFont = DEFAULT_LABEL_FONT,
    density = 'full',
    rulerSize = DEFAULT_RULER_SIZE,
    tickHeights = DEFAULT_TICK_HEIGHTS,
    labelInset = DEFAULT_LABEL_INSET,
    verticalLabelInset = DEFAULT_VERTICAL_LABEL_INSET,
  } = opts;
  const { subdivisions, minorStepPx } = grid;

  if (color) {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
  }
  ctx.font = labelFont;
  ctx.lineWidth = 1;

  const endTick = Math.ceil(length / minorStepPx);
  const labelEvery = labelIntervalForDensity(density);

  const tickLength = (kind: TickKind): number =>
    kind === 'major' ? tickHeights.major
    : kind === 'half' ? tickHeights.half
    : tickHeights.minor;

  if (axis === 'h') {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.beginPath();
    for (let i = 0; i <= endTick; i++) {
      const raw = start + i * minorStepPx;
      if (raw < start || raw > start + length) continue;

      const kind = classify(i, subdivisions);
      if (!shouldDraw(kind, density)) continue;

      const x = Math.round(raw) + 0.5;
      const h = tickLength(kind);
      ctx.moveTo(x, rulerSize);
      ctx.lineTo(x, rulerSize - h);
    }
    ctx.stroke();

    for (let i = subdivisions; i <= endTick; i += subdivisions) {
      const raw = start + i * minorStepPx;
      if (raw < start || raw > start + length) continue;
      const unitIndex = i / subdivisions;
      if (unitIndex % labelEvery !== 0) continue;
      const x = Math.round(raw) + 0.5;
      ctx.fillText(String(unitIndex), x, labelInset);
    }
    return;
  }

  // Vertical
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= endTick; i++) {
    const raw = start + i * minorStepPx;
    if (raw < start || raw > start + length) continue;

    const kind = classify(i, subdivisions);
    if (!shouldDraw(kind, density)) continue;

    const y = Math.round(raw) + 0.5;
    const w = tickLength(kind);
    ctx.beginPath();
    ctx.moveTo(rulerSize, y);
    ctx.lineTo(rulerSize - w, y);
    ctx.stroke();
  }

  for (let i = subdivisions; i <= endTick; i += subdivisions) {
    const raw = start + i * minorStepPx;
    if (raw < start || raw > start + length) continue;
    const unitIndex = i / subdivisions;
    if (unitIndex % labelEvery !== 0) continue;
    const y = Math.round(raw) + 0.5;
    ctx.save();
    // Rotated labels for the vertical ruler. `verticalLabelInset`
    // controls how far inward the label center sits from the ruler's
    // inner edge — docs uses 6 (default), slim rulers use a smaller
    // value so labels stay clear of the ticks.
    ctx.translate(verticalLabelInset, y);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(String(unitIndex), 0, 0);
    ctx.restore();
  }
}

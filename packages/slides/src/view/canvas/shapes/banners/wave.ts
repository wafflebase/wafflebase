// packages/slides/src/view/canvas/shapes/banners/wave.ts
import type { AdjustmentHandle, AdjustmentSpec, PathBuilder } from '../builder';
import { adj } from '../builder';
import { DEFAULT_ARC_SEGMENTS } from '../curves';

/**
 * `wave` — a horizontal band whose top and bottom edges follow one
 * sine period of equal phase, so the band keeps a constant vertical
 * thickness. OOXML's preset has two adjustments:
 *
 *   [0] adj1 — wave amplitude as ‰ of height (`pin 0 adj1 20000`).
 *   [1] adj2 — horizontal pitch/skew (`pin -10000 adj2 10000`).
 *
 * We honour adj1 (amplitude) and store adj2 for OOXML round-trip but
 * render an un-skewed wave — the skew is a cosmetic refinement, not a
 * structural one, and an un-skewed wave already reads as the same
 * shape. Curves use the shared polyline approximation so JSDOM's
 * partial `quadraticCurveTo`/`bezierCurveTo` support is never touched.
 */
export const WAVE_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  {
    name: 'Wave amplitude',
    defaultValue: 12500,
    min: 0,
    max: 20000,
    format: (v) => `${(v / 1000).toFixed(1)}%`,
  },
  { name: 'Wave pitch', defaultValue: 0, min: -10000, max: 10000 },
];

const DEF_WAVE_AMP = 12500;
const WAVE_MAX_AMP = 20000;

/** Build an N-period sine wave band. Shared by `wave` and `doubleWave`. */
export function buildWaveBand(
  { w, h }: { w: number; h: number },
  adjustments: number[] | undefined,
  periods: number,
  defaultAmp: number,
  maxAmp: number = WAVE_MAX_AMP,
): Path2D {
  const a = Math.max(0, Math.min(maxAmp, adj(adjustments, 0, defaultAmp)));
  const amp = (h * a) / 100000;
  const segments = DEFAULT_ARC_SEGMENTS;
  const top = (x: number) =>
    amp - amp * Math.sin((periods * 2 * Math.PI * x) / w);
  const bottom = (x: number) =>
    h - amp - amp * Math.sin((periods * 2 * Math.PI * x) / w);

  const path = new Path2D();
  path.moveTo(0, top(0));
  for (let i = 1; i <= segments; i++) {
    const x = (w * i) / segments;
    path.lineTo(x, top(x));
  }
  path.lineTo(w, bottom(w));
  for (let i = segments - 1; i >= 0; i--) {
    const x = (w * i) / segments;
    path.lineTo(x, bottom(x));
  }
  path.closePath();
  return path;
}

export const buildWave: PathBuilder = (size, adjustments) =>
  buildWaveBand(size, adjustments, 1, DEF_WAVE_AMP);

/** Amplitude handle: vertical drag at the left edge controls adj1. */
export function waveAmplitudeHandle(
  defaultAmp: number,
  maxAmp: number = WAVE_MAX_AMP,
): AdjustmentHandle {
  return {
    position: ({ h }, adjustments) => {
      const a = adjustments[0] ?? defaultAmp;
      return { x: 0, y: (h * a) / 100000 };
    },
    apply: ({ h }, start, pointer) => {
      const y = Math.max(0, Math.min(h, pointer.y));
      const raw = h > 0 ? Math.round((y / h) * 100000) : defaultAmp;
      return [Math.max(0, Math.min(maxAmp, raw)), start[1] ?? 0];
    },
  };
}

export const WAVE_HANDLES: readonly AdjustmentHandle[] = [
  waveAmplitudeHandle(DEF_WAVE_AMP),
];

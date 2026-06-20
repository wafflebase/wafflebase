// packages/slides/src/view/canvas/shapes/banners/double-wave.ts
import type { AdjustmentHandle, AdjustmentSpec, PathBuilder } from '../builder';
import { buildWaveBand, waveAmplitudeHandle } from './wave';

/**
 * `doubleWave` — like `wave` but with two sine periods across the
 * width. OOXML clamps the amplitude lower (`pin 0 adj1 12500`) and
 * defaults it to 6250 because two periods at full amplitude would
 * self-intersect. Reuses `buildWaveBand` / `waveAmplitudeHandle`.
 */
const DEF_DOUBLE_WAVE_AMP = 6250;
const DOUBLE_WAVE_MAX_AMP = 12500;

export const DOUBLE_WAVE_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  {
    name: 'Wave amplitude',
    defaultValue: DEF_DOUBLE_WAVE_AMP,
    min: 0,
    max: DOUBLE_WAVE_MAX_AMP,
    format: (v) => `${(v / 1000).toFixed(1)}%`,
  },
  { name: 'Wave pitch', defaultValue: 0, min: -10000, max: 10000 },
];

export const buildDoubleWave: PathBuilder = (size, adjustments) =>
  buildWaveBand(
    size,
    adjustments,
    2,
    DEF_DOUBLE_WAVE_AMP,
    DOUBLE_WAVE_MAX_AMP,
  );

export const DOUBLE_WAVE_HANDLES: readonly AdjustmentHandle[] = [
  waveAmplitudeHandle(DEF_DOUBLE_WAVE_AMP, DOUBLE_WAVE_MAX_AMP),
];

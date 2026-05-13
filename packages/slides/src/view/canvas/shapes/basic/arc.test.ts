import { describe, it, expect } from 'vitest';
import '../../test-canvas-env';
import { ARC_ADJUSTMENTS, buildArc } from './arc';

describe('buildArc', () => {
  it('produces a Path2D (geometry covered by the registry snapshot)', () => {
    // `arc` is an open path; the test canvas shim has no
    // `isPointInStroke`. The registry snapshot pins the exact ops.
    expect(buildArc({ w: 100, h: 100 })).toBeInstanceOf(Path2D);
  });

  it('defaults match OOXML preset (270°, 0°)', () => {
    expect(ARC_ADJUSTMENTS[0].defaultValue).toBe(16200000);
    expect(ARC_ADJUSTMENTS[1].defaultValue).toBe(0);
  });
});

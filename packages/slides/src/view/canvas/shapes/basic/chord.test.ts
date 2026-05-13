import { describe, it, expect } from 'vitest';
import '../../test-canvas-env';
import { createTestCanvas } from '../../test-canvas-env';
import { buildChord, CHORD_ADJUSTMENTS } from './chord';

describe('buildChord', () => {
  it('renders a segment that excludes the pivot', () => {
    const path = buildChord({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // Default 270°→0°. Centre is on the chord — outside the segment.
    expect(ctx.isPointInPath(path, 50, 50)).toBe(false);
    // NE point — well inside the crescent.
    expect(ctx.isPointInPath(path, 75, 25)).toBe(true);
  });

  it('defaults match OOXML preset (270°, 0°)', () => {
    expect(CHORD_ADJUSTMENTS[0].defaultValue).toBe(16200000);
    expect(CHORD_ADJUSTMENTS[1].defaultValue).toBe(0);
  });
});

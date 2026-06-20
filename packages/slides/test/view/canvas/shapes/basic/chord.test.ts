import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildChord, CHORD_ADJUSTMENTS } from '../../../../../src/view/canvas/shapes/basic/chord';

describe('buildChord', () => {
  it('renders the large default segment (45°→270°)', () => {
    const path = buildChord({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // 225° major segment — the centre is inside it.
    expect(ctx.isPointInPath(path, 50, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 30, 60)).toBe(true);
    // Outside the disc entirely.
    expect(ctx.isPointInPath(path, 95, 95)).toBe(false);
  });

  it('defaults match OOXML preset (45°, 270°)', () => {
    expect(CHORD_ADJUSTMENTS[0].defaultValue).toBe(2700000);
    expect(CHORD_ADJUSTMENTS[1].defaultValue).toBe(16200000);
  });
});

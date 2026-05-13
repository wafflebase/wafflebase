import { describe, it, expect } from 'vitest';
import '../../test-canvas-env';
import { createTestCanvas } from '../../test-canvas-env';
import { buildFrame, FRAME_ADJUSTMENTS, FRAME_HANDLES } from './frame';

describe('buildFrame', () => {
  it('fills the border but leaves the interior unfilled (even-odd winding)', () => {
    // Test shim's `nonzero` is approximated as "any-subpath-hit"; use
    // evenodd to assert the hollow contract that browser non-zero
    // winding would also produce (outer CW + inner CCW = 0 inside).
    const path = buildFrame({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // Border at top-left.
    expect(ctx.isPointInPath(path, 2, 50, 'evenodd')).toBe(true);
    // Interior (well inside the 12.5% border).
    expect(ctx.isPointInPath(path, 50, 50, 'evenodd')).toBe(false);
  });

  it('default thickness matches the OOXML preset (12500)', () => {
    expect(FRAME_ADJUSTMENTS[0].defaultValue).toBe(12500);
  });
});

describe('FRAME_HANDLES', () => {
  it('default places the diamond at the inner-corner inset', () => {
    const p = FRAME_HANDLES[0].position({ w: 100, h: 100 }, [12500]);
    expect(p.x).toBeCloseTo(12.5, 1);
    expect(p.y).toBe(0);
  });
});

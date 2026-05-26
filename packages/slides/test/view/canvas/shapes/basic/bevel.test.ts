import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { BEVEL_ADJUSTMENTS, buildBevel, BEVEL_HANDLES } from '../../../../../src/view/canvas/shapes/basic/bevel';

describe('buildBevel', () => {
  it('fills the bevel border but leaves the interior unfilled (even-odd)', () => {
    // Same caveat as `frame.test.ts`: shim's nonzero is "any-hit", so
    // we assert via evenodd to match browser non-zero behaviour for
    // outer CW + inner CCW.
    const path = buildBevel({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // Border at top.
    expect(ctx.isPointInPath(path, 50, 2, 'evenodd')).toBe(true);
    // Centre — net winding 0.
    expect(ctx.isPointInPath(path, 50, 50, 'evenodd')).toBe(false);
  });

  it('default size is 12500', () => {
    expect(BEVEL_ADJUSTMENTS[0].defaultValue).toBe(12500);
  });
});

describe('BEVEL_HANDLES', () => {
  it('exposes one top-edge handle', () => {
    expect(BEVEL_HANDLES.length).toBe(1);
  });
});

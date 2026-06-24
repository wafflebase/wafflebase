import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildPlus, PLUS_HANDLES } from '../../../../../src/view/canvas/shapes/basic/plus';

describe('buildPlus', () => {
  it('produces a cross whose default arm band is ~50% of the frame', () => {
    // OOXML: x1 = ss*adj/100000 = 25 at adj=25000 on a 100×100 frame,
    // so the vertical arm spans x∈[25,75] — a 50%-wide band. The old
    // builder treated adj as the arm thickness (~25%, x∈[37.5,62.5]),
    // so x=30 was OUTSIDE the arm there but is INSIDE now.
    const path = buildPlus({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // Centre is always filled.
    expect(ctx.isPointInPath(path, 50, 50)).toBe(true);
    // Vertical arm at x=30 (in [25,75]) — proves the 50% band.
    expect(ctx.isPointInPath(path, 30, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 70, 50)).toBe(true);
    // Horizontal arm at y=30 (in [25,75]).
    expect(ctx.isPointInPath(path, 50, 30)).toBe(true);
    // Just inside the left edge of the vertical arm band.
    expect(ctx.isPointInPath(path, 26, 50)).toBe(true);
    // Just outside it (x < x1=25) → in a corner cut-out.
    expect(ctx.isPointInPath(path, 20, 20)).toBe(false);
    // Corner is empty.
    expect(ctx.isPointInPath(path, 5, 5)).toBe(false);
  });

  it('handle paints at the edge inset x1 = ss*adj/100000', () => {
    expect(PLUS_HANDLES).toHaveLength(1);
    // ss = min(120, 100) = 100; x1 = 25% * 100 = 25.
    const p = PLUS_HANDLES[0].position({ w: 120, h: 100 }, [25000]);
    expect(p).toEqual({ x: 25, y: 0 });
  });
});

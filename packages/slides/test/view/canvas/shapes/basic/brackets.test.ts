import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildLeftBracket } from '../../../../../src/view/canvas/shapes/basic/left-bracket';
import { buildRightBracket } from '../../../../../src/view/canvas/shapes/basic/right-bracket';
import { buildLeftBrace } from '../../../../../src/view/canvas/shapes/basic/left-brace';
import { buildRightBrace } from '../../../../../src/view/canvas/shapes/basic/right-brace';

const ctx = createTestCanvas(400, 400).getContext('2d');

// Brackets and braces are open paths. The renderer skips fill for
// these kinds (see OPEN_PATH_KINDS in shape-renderer.ts), but
// isPointInPath() still auto-closes the path with an implicit edge
// from end → start, so we can probe the auto-closed polygon to
// verify the outline geometry. Tests use max-radius adjustments to
// produce arcs large enough to distinguish from a plain rect.
describe('brackets', () => {
  it('leftBracket carves the top-left and bottom-left corners', () => {
    // adj=50000 → r = min(40, 200)/2 = 20. The TL arc passes near
    // (5, 5) (midpoint of Bezier from (20, 0) via (0,0) to (0, 20)),
    // so points well above/left of that arc are outside the
    // auto-closed polygon — a plain rect would have them inside.
    const path = buildLeftBracket({ w: 40, h: 200 }, [50000]);
    expect(ctx.isPointInPath(path, 1, 1)).toBe(false);
    expect(ctx.isPointInPath(path, 1, 199)).toBe(false);
    // Interior away from the arcs is inside.
    expect(ctx.isPointInPath(path, 35, 100)).toBe(true);
  });

  it('rightBracket carves the top-right and bottom-right corners', () => {
    // Mirror of the leftBracket case — at adj=50000 (max radius),
    // r = min(40, 200)/2 = 20. The carved arcs sit at the TR and BR
    // corners, so points just inside those corners (39, 1) /
    // (39, 199) are outside the auto-closed polygon while a point
    // away from the arcs remains inside.
    const path = buildRightBracket({ w: 40, h: 200 }, [50000]);
    expect(ctx.isPointInPath(path, 39, 1)).toBe(false);
    expect(ctx.isPointInPath(path, 39, 199)).toBe(false);
    expect(ctx.isPointInPath(path, 5, 100)).toBe(true);
  });

  it('default-radius bracket is non-degenerate', () => {
    // Sanity check that default geometry doesn't collapse.
    const path = buildLeftBracket({ w: 40, h: 200 });
    expect(ctx.isPointInPath(path, 35, 100)).toBe(true);
  });
});

describe('braces', () => {
  it('leftBrace spine sits at w/2 — points on either side differ', () => {
    const path = buildLeftBrace({ w: 60, h: 200 });
    // To the right of the spine (auto-closed via right edge x=w).
    expect(ctx.isPointInPath(path, 45, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 45, 150)).toBe(true);
    // To the left of the spine (where the open "{" gap lives).
    expect(ctx.isPointInPath(path, 5, 100)).toBe(false);
  });

  it('rightBrace spine sits at w/2 — mirror of leftBrace', () => {
    const path = buildRightBrace({ w: 60, h: 200 });
    expect(ctx.isPointInPath(path, 15, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 15, 150)).toBe(true);
    expect(ctx.isPointInPath(path, 55, 100)).toBe(false);
  });
});

describe('degenerate frames', () => {
  it('does not throw on 0×0 or near-zero sizes', () => {
    for (const build of [
      buildLeftBracket,
      buildRightBracket,
      buildLeftBrace,
      buildRightBrace,
    ]) {
      expect(() => build({ w: 0, h: 0 })).not.toThrow();
      expect(() => build({ w: 2, h: 2 })).not.toThrow();
    }
  });
});

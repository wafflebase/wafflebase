import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import {
  buildFoldedCorner,
  FOLDED_CORNER_ADJUSTMENTS,
  FOLDED_CORNER_HANDLES,
} from '../../../../../src/view/canvas/shapes/basic/folded-corner';

describe('buildFoldedCorner', () => {
  it('folds the bottom-right (SE) corner, leaving NE intact (OOXML)', () => {
    const path = buildFoldedCorner({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 50)).toBe(true);
    // Top-right corner is now a full square corner.
    expect(ctx.isPointInPath(path, 97, 3)).toBe(true);
    // Bottom-right corner is folded away.
    expect(ctx.isPointInPath(path, 98, 98)).toBe(false);
  });

  it('default fold is 16667', () => {
    expect(FOLDED_CORNER_ADJUSTMENTS[0].defaultValue).toBe(16667);
  });
});

describe('FOLDED_CORNER_HANDLES', () => {
  it('exposes one bottom-edge handle near the folded SE corner', () => {
    expect(FOLDED_CORNER_HANDLES.length).toBe(1);
    const p = FOLDED_CORNER_HANDLES[0].position({ w: 100, h: 100 }, [16667]);
    expect(p.y).toBeGreaterThan(50); // south half (bottom edge)
    expect(p.x).toBeGreaterThan(50); // east half
  });
});

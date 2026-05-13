import { describe, it, expect } from 'vitest';
import '../../test-canvas-env';
import { createTestCanvas } from '../../test-canvas-env';
import {
  buildFoldedCorner,
  FOLDED_CORNER_ADJUSTMENTS,
  FOLDED_CORNER_HANDLES,
} from './folded-corner';

describe('buildFoldedCorner', () => {
  it('fills the main rectangle (excluding the missing NE corner)', () => {
    const path = buildFoldedCorner({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 5, 5)).toBe(true);
  });

  it('default fold is 16667', () => {
    expect(FOLDED_CORNER_ADJUSTMENTS[0].defaultValue).toBe(16667);
  });
});

describe('FOLDED_CORNER_HANDLES', () => {
  it('exposes one top-edge handle (placed near the NE corner)', () => {
    expect(FOLDED_CORNER_HANDLES.length).toBe(1);
    const p = FOLDED_CORNER_HANDLES[0].position({ w: 100, h: 100 }, [16667]);
    expect(p.y).toBe(0);
    expect(p.x).toBeGreaterThan(50); // east half
  });
});

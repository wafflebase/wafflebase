import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildLightningBolt } from '../../../../../src/view/canvas/shapes/basic/lightning-bolt';

describe('buildLightningBolt', () => {
  it('produces a closed polygon with a filled body', () => {
    const path = buildLightningBolt({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // Upper segment of the bolt is filled.
    expect(ctx.isPointInPath(path, 50, 15)).toBe(true);
    // Mid zigzag and lower segment are filled.
    expect(ctx.isPointInPath(path, 60, 40)).toBe(true);
    expect(ctx.isPointInPath(path, 15, 25)).toBe(true);
  });

  it('has a single pointed apex at the top', () => {
    const path = buildLightningBolt({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // The OOXML apex is at x ~= 39.2, y = 0. Just below it is filled.
    expect(ctx.isPointInPath(path, 39, 3)).toBe(true);
    // The top edge is NOT flat: well to the left and right of the apex
    // at the very top stays empty (a flat-top approximation would fill
    // these).
    expect(ctx.isPointInPath(path, 20, 1)).toBe(false);
    expect(ctx.isPointInPath(path, 60, 1)).toBe(false);
  });
});

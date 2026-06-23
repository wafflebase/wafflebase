import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildCloudCallout } from '../../../../../src/view/canvas/shapes/callouts/cloud-callout';

describe('buildCloudCallout', () => {
  it('produces a cloud body composed with thought-bubble circles', () => {
    const path = buildCloudCallout({ w: 200, h: 120 });
    const ctx = createTestCanvas(400, 400).getContext('2d');
    expect(ctx.isPointInPath(path, 100, 60)).toBe(true); // inside cloud body
    expect(ctx.isPointInPath(path, 1, 1)).toBe(false); // outside frame
  });

  it('trails three distinct thought-bubbles marching to the tip', () => {
    // Default tail [-20833, 62500] for w=200,h=120 puts the tip at
    // (≈58.33, 135). Three bubbles of decreasing radius are centred on
    // the cloud-centre → tip line at t = 0.62 / 0.82 / 1.0:
    //   b1 ≈ (74.17, 106.5) r≈8.4   (largest, nearest cloud)
    //   b2 ≈ (65.83, 121.5) r≈6.67  (middle)
    //   b3 ≈ (58.33, 135.0) r≈3.33  (smallest, at the tip)
    const path = buildCloudCallout({ w: 200, h: 120 });
    const ctx = createTestCanvas(400, 400).getContext('2d');

    // Each bubble centre is inside the path.
    expect(ctx.isPointInPath(path, 74, 107)).toBe(true); // b1
    expect(ctx.isPointInPath(path, 66, 121)).toBe(true); // b2
    expect(ctx.isPointInPath(path, 58, 135)).toBe(true); // b3 (tip)

    // The bubbles are distinct: the gaps between consecutive centres
    // fall outside every sub-path.
    expect(ctx.isPointInPath(path, 70, 114)).toBe(false); // between b1 & b2
    expect(ctx.isPointInPath(path, 62, 128)).toBe(false); // between b2 & b3

    // Beyond the tip there is nothing.
    expect(ctx.isPointInPath(path, 55, 145)).toBe(false);
  });
});

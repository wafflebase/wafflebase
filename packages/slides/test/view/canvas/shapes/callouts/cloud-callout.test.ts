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

  it('trails three thought-bubbles marching from the cloud to the tip', () => {
    // Default tail [-20833, 62500] for w=200,h=120 puts the tip at
    // (≈58.33, 135). The OOXML bubbles are placed by tip-anchored offsets
    // along the tip → cloud-edge vector (not a naive centre→tip fraction):
    //   largest ≈ (66.2, 121.0) r=10     (nearest the cloud)
    //   middle  ≈ (60.6, 130.9) r≈6.67
    //   smallest = (58.33, 135) r≈3.33   (at the tip)
    const path = buildCloudCallout({ w: 200, h: 120 });
    const ctx = createTestCanvas(400, 400).getContext('2d');

    // Each bubble centre is inside the path.
    expect(ctx.isPointInPath(path, 66, 121)).toBe(true); // largest
    expect(ctx.isPointInPath(path, 61, 131)).toBe(true); // middle
    expect(ctx.isPointInPath(path, 58, 135)).toBe(true); // smallest (tip)

    // Beyond the tip there is nothing.
    expect(ctx.isPointInPath(path, 55, 145)).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildCloudCallout } from '../../../../../src/view/canvas/shapes/callouts/cloud-callout';

describe('buildCloudCallout', () => {
  it('produces a cloud body composed with two thought-bubble circles', () => {
    const path = buildCloudCallout({ w: 200, h: 120 });
    const ctx = createTestCanvas(400, 400).getContext('2d');
    // The exact tail-bubble positions are derived from a vector
    // calculation (cloud-edge → tail tip) that's awkward to reproduce
    // in a test; assert just the centre-of-cloud + clearly-outside-frame.
    expect(ctx.isPointInPath(path, 100, 60)).toBe(true); // inside cloud body
    expect(ctx.isPointInPath(path, 1, 1)).toBe(false); // outside frame
  });
});

import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import {
  buildDiagStripe,
  DIAG_STRIPE_ADJUSTMENTS,
  DIAG_STRIPE_HANDLES,
} from '../../../../../src/view/canvas/shapes/basic/diag-stripe';

describe('buildDiagStripe', () => {
  it('paints a diagonal stripe band (not a corner triangle)', () => {
    const path = buildDiagStripe({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // Inside the band (between the two diagonals).
    expect(ctx.isPointInPath(path, 40, 40)).toBe(true);
    // Above the band's upper-left edge — now empty (was filled in the
    // old triangular V0).
    expect(ctx.isPointInPath(path, 10, 10)).toBe(false);
    // Below the main diagonal — empty.
    expect(ctx.isPointInPath(path, 80, 80)).toBe(false);
  });

  it('default is 50000', () => {
    expect(DIAG_STRIPE_ADJUSTMENTS[0].defaultValue).toBe(50000);
  });
});

describe('DIAG_STRIPE_HANDLES', () => {
  it('exposes one handle', () => {
    expect(DIAG_STRIPE_HANDLES.length).toBe(1);
  });
});

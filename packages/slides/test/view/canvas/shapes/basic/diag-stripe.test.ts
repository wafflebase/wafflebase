import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import {
  buildDiagStripe,
  DIAG_STRIPE_ADJUSTMENTS,
  DIAG_STRIPE_HANDLES,
} from '../../../../../src/view/canvas/shapes/basic/diag-stripe';

describe('buildDiagStripe', () => {
  it('paints a triangular wedge at the NW corner', () => {
    const path = buildDiagStripe({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 10, 10)).toBe(true);
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

import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildFlowChartPunchedTape } from '../../../../../src/view/canvas/shapes/flowchart/punched-tape';

describe('buildFlowChartPunchedTape', () => {
  it('contains the centre and excludes outside the tape', () => {
    const path = buildFlowChartPunchedTape({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 50)).toBe(true);
    expect(ctx.isPointInPath(path, -1, 50)).toBe(false);
    expect(ctx.isPointInPath(path, 101, 50)).toBe(false);
  });

  it('uses a wave amplitude of 0.1 * h', () => {
    // Top wave is centred at y = amp = 0.1h (=10) and peaks down to
    // 2*amp (=20) at the quarter point (x = w/4). At x = w/4 the body
    // therefore starts only below y ≈ 20.
    const path = buildFlowChartPunchedTape({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // At the wave's lowest point the interior begins past ~2*amp.
    expect(ctx.isPointInPath(path, 25, 25)).toBe(true); // below the trough
    expect(ctx.isPointInPath(path, 25, 15)).toBe(false); // above the trough (inside the wave dip)
  });
});

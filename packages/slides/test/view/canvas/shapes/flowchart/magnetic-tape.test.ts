import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildFlowChartMagneticTape } from '../../../../../src/view/canvas/shapes/flowchart/magnetic-tape';

describe('buildFlowChartMagneticTape', () => {
  it('contains the centre and excludes points outside the circle', () => {
    const path = buildFlowChartMagneticTape({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 5, 50)).toBe(true); // left circle edge
    expect(ctx.isPointInPath(path, 50, 5)).toBe(true); // top circle edge
    expect(ctx.isPointInPath(path, -1, -1)).toBe(false);
  });

  it('squares off the bottom-right foot to the corner', () => {
    // OOXML trims the 45°→90° wedge of the circle in the bottom-right
    // quadrant and squares it to the corner (r, b). The corner region is
    // therefore inside the path, while the matching bottom-left region —
    // which keeps the rounded circle edge — is outside.
    const path = buildFlowChartMagneticTape({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // Bottom-right corner region: squared, inside.
    expect(ctx.isPointInPath(path, 97, 97)).toBe(true);
    expect(ctx.isPointInPath(path, 90, 99)).toBe(true);
    // Symmetric bottom-left point: still the rounded circle edge, outside.
    expect(ctx.isPointInPath(path, 3, 97)).toBe(false);
    // Symmetric top-right point: rounded circle edge, outside.
    expect(ctx.isPointInPath(path, 97, 3)).toBe(false);
  });
});

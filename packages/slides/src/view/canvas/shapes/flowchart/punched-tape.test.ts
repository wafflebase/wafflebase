import { describe, it, expect } from 'vitest';
import '../../test-canvas-env';
import { createTestCanvas } from '../../test-canvas-env';
import { buildFlowChartPunchedTape } from './punched-tape';

describe('buildFlowChartPunchedTape', () => {
  it('contains the centre and excludes outside the tape', () => {
    const path = buildFlowChartPunchedTape({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 50)).toBe(true);
    expect(ctx.isPointInPath(path, -1, 50)).toBe(false);
    expect(ctx.isPointInPath(path, 101, 50)).toBe(false);
  });
});

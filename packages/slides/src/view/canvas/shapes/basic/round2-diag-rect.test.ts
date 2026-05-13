import { describe, it, expect } from 'vitest';
import '../../test-canvas-env';
import { createTestCanvas } from '../../test-canvas-env';
import {
  buildRound2DiagRect,
  ROUND2_DIAG_RECT_HANDLES,
} from './round2-diag-rect';

describe('buildRound2DiagRect', () => {
  it('excludes NE and SW corners (outside the arcs)', () => {
    const path = buildRound2DiagRect({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 5, 5)).toBe(true); // NW kept sharp
    expect(ctx.isPointInPath(path, 95, 95)).toBe(true); // SE kept sharp
    expect(ctx.isPointInPath(path, 99, 1)).toBe(false); // NE rounded
    expect(ctx.isPointInPath(path, 1, 99)).toBe(false); // SW rounded
  });
});

describe('ROUND2_DIAG_RECT_HANDLES', () => {
  it('top + left handles', () => {
    expect(ROUND2_DIAG_RECT_HANDLES.length).toBe(2);
  });
});

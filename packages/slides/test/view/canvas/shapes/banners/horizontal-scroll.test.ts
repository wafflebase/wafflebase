import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import {
  buildHorizontalScroll,
  buildHorizontalScrollFaces,
  HORIZONTAL_SCROLL_ADJUSTMENTS,
  HORIZONTAL_SCROLL_HANDLES,
} from '../../../../../src/view/canvas/shapes/banners/horizontal-scroll';

// w=200, h=100 -> ss=100, ch=12.5 (default adj 12500). The flat sheet
// body is inset by the curl size on the top/bottom; the curls roll up
// on the LEFT and RIGHT edges (left at the bottom, right at the top).
describe('buildHorizontalScroll', () => {
  it('produces a Path2D', () => {
    expect(buildHorizontalScroll({ w: 200, h: 100 })).toBeInstanceOf(Path2D);
  });

  it('fills the sheet body in the center', () => {
    const path = buildHorizontalScroll({ w: 200, h: 100 });
    const ctx = createTestCanvas(300, 300).getContext('2d');
    expect(ctx.isPointInPath(path, 100, 50)).toBe(true);
    // The top/bottom margins between the curls are outside the sheet.
    expect(ctx.isPointInPath(path, 100, 3)).toBe(false);
    expect(ctx.isPointInPath(path, 100, 97)).toBe(false);
  });

  it('places curl bumps on the left and right edges', () => {
    const path = buildHorizontalScroll({ w: 200, h: 100 });
    const ctx = createTestCanvas(300, 300).getContext('2d');
    // Left curl rolls up at the bottom-left corner.
    expect(ctx.isPointInPath(path, 7, 92)).toBe(true);
    // Right curl rolls up at the top-right corner.
    expect(ctx.isPointInPath(path, 190, 11)).toBe(true);
    // No curl on the opposite diagonal corners.
    expect(ctx.isPointInPath(path, 7, 7)).toBe(false);
    expect(ctx.isPointInPath(path, 193, 92)).toBe(false);
  });

  it('default roll size is the OOXML 12500', () => {
    expect(HORIZONTAL_SCROLL_ADJUSTMENTS[0].defaultValue).toBe(12500);
  });
});

describe('buildHorizontalScrollFaces', () => {
  it('returns the sheet face plus two darker rolled-under curl faces', () => {
    const faces = buildHorizontalScrollFaces({ w: 200, h: 100 });
    expect(faces).toHaveLength(3);
    const [sheet, left, right] = faces;
    expect(sheet.shade ?? 0).toBe(0);
    // Rolled-under curls are shadow faces.
    expect(left.shade).toBeLessThan(0);
    expect(right.shade).toBeLessThan(0);

    const ctx = createTestCanvas(300, 300).getContext('2d');
    // Sheet face covers the body center.
    expect(ctx.isPointInPath(sheet.path, 100, 50)).toBe(true);
    // Left rolled-under curl sits on the left edge.
    expect(ctx.isPointInPath(left.path, 9, 20)).toBe(true);
    expect(ctx.isPointInPath(left.path, 193, 7)).toBe(false);
    // Right rolled-under curl sits on the right edge.
    expect(ctx.isPointInPath(right.path, 193, 5)).toBe(true);
    expect(ctx.isPointInPath(right.path, 9, 20)).toBe(false);
  });
});

describe('HORIZONTAL_SCROLL_HANDLES', () => {
  it('exposes one handle', () => {
    expect(HORIZONTAL_SCROLL_HANDLES.length).toBe(1);
  });
});

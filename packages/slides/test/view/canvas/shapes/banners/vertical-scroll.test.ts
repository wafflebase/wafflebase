import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import {
  buildVerticalScroll,
  buildVerticalScrollFaces,
  VERTICAL_SCROLL_ADJUSTMENTS,
  VERTICAL_SCROLL_HANDLES,
} from '../../../../../src/view/canvas/shapes/banners/vertical-scroll';

// w=100, h=200 -> ss=100, ch=12.5 (default adj 12500). The flat sheet
// body is inset by the curl size on the left/right; the curls roll up
// on the TOP and BOTTOM edges (top at the right, bottom at the left).
describe('buildVerticalScroll', () => {
  it('produces a Path2D', () => {
    expect(buildVerticalScroll({ w: 100, h: 200 })).toBeInstanceOf(Path2D);
  });

  it('fills the sheet body in the center', () => {
    const path = buildVerticalScroll({ w: 100, h: 200 });
    const ctx = createTestCanvas(300, 300).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 100)).toBe(true);
    // The left/right margins between the curls are outside the sheet.
    expect(ctx.isPointInPath(path, 3, 100)).toBe(false);
    expect(ctx.isPointInPath(path, 97, 100)).toBe(false);
  });

  it('places curl bumps on the top and bottom edges', () => {
    const path = buildVerticalScroll({ w: 100, h: 200 });
    const ctx = createTestCanvas(300, 300).getContext('2d');
    // Top curl rolls up at the top-right corner.
    expect(ctx.isPointInPath(path, 92, 7)).toBe(true);
    // Bottom curl rolls up at the bottom-left corner.
    expect(ctx.isPointInPath(path, 10, 193)).toBe(true);
    // No curl on the opposite diagonal corners.
    expect(ctx.isPointInPath(path, 7, 7)).toBe(false);
    expect(ctx.isPointInPath(path, 92, 193)).toBe(false);
  });

  it('default roll size is the OOXML 12500', () => {
    expect(VERTICAL_SCROLL_ADJUSTMENTS[0].defaultValue).toBe(12500);
  });
});

describe('buildVerticalScrollFaces', () => {
  it('returns the sheet face plus two darker rolled-under curl faces', () => {
    const faces = buildVerticalScrollFaces({ w: 100, h: 200 });
    expect(faces).toHaveLength(3);
    const [sheet, top, bottom] = faces;
    expect(sheet.shade ?? 0).toBe(0);
    // Rolled-under curls are shadow faces.
    expect(top.shade).toBeLessThan(0);
    expect(bottom.shade).toBeLessThan(0);

    const ctx = createTestCanvas(300, 300).getContext('2d');
    // Sheet face covers the body center.
    expect(ctx.isPointInPath(sheet.path, 50, 100)).toBe(true);
    // Top rolled-under curl sits on the top edge.
    expect(ctx.isPointInPath(top.path, 18, 8)).toBe(true);
    expect(ctx.isPointInPath(top.path, 5, 193)).toBe(false);
    // Bottom rolled-under curl sits on the bottom edge.
    expect(ctx.isPointInPath(bottom.path, 5, 193)).toBe(true);
    expect(ctx.isPointInPath(bottom.path, 18, 8)).toBe(false);
  });
});

describe('VERTICAL_SCROLL_HANDLES', () => {
  it('exposes one handle', () => {
    expect(VERTICAL_SCROLL_HANDLES.length).toBe(1);
  });
});

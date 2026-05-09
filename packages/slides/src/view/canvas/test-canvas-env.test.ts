import { describe, it, expect } from 'vitest';
import './test-canvas-env';
import { createTestCanvas } from './test-canvas-env';

describe('Path2D shim — curve ops', () => {
  it('approximates quadraticCurveTo as a polyline subpath', () => {
    // Build a "rounded square" with quadratic corners. Hit-test the
    // centre and an exterior point.
    const path = new Path2D();
    path.moveTo(10, 0);
    path.lineTo(90, 0);
    path.quadraticCurveTo(100, 0, 100, 10);
    path.lineTo(100, 50);
    path.quadraticCurveTo(100, 60, 90, 60);
    path.lineTo(10, 60);
    path.quadraticCurveTo(0, 60, 0, 50);
    path.lineTo(0, 10);
    path.quadraticCurveTo(0, 0, 10, 0);
    path.closePath();
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 30)).toBe(true);
    expect(ctx.isPointInPath(path, 200, 200)).toBe(false);
  });

  it('approximates bezierCurveTo as a polyline subpath', () => {
    // Outline a rough cylinder: top via cubic, sides, bottom via cubic.
    const path = new Path2D();
    path.moveTo(0, 15);
    path.bezierCurveTo(0, 0, 100, 0, 100, 15);
    path.lineTo(100, 45);
    path.bezierCurveTo(100, 60, 0, 60, 0, 45);
    path.closePath();
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 30)).toBe(true);
    expect(ctx.isPointInPath(path, 200, 30)).toBe(false);
  });

  it('records a full-circle arc() as an ellipse op', () => {
    const path = new Path2D();
    path.arc(50, 50, 20, 0, Math.PI * 2);
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 80, 50)).toBe(false);
  });

  it('honours evenodd fill rule for nested ellipses (donut hole)', () => {
    const path = new Path2D();
    // Outer + inner ellipses, second drawn ccw — donut pattern.
    path.ellipse(50, 30, 50, 30, 0, 0, Math.PI * 2);
    path.ellipse(50, 30, 10, 6, 0, 0, Math.PI * 2, true);
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // Centre (inside the hole) — not filled with evenodd.
    expect(ctx.isPointInPath(path, 50, 30, 'evenodd')).toBe(false);
    // Ring point — filled.
    expect(ctx.isPointInPath(path, 5, 30, 'evenodd')).toBe(true);
    // Outside everything — not filled.
    expect(ctx.isPointInPath(path, -5, 30, 'evenodd')).toBe(false);
  });
});

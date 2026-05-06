import { describe, it, expect } from 'vitest';
import type { Frame } from '../../../model/element';
import { resizeFrame } from './resize';

const f = (x: number, y: number, w: number, h: number): Frame => ({
  x, y, w, h, rotation: 0,
});

describe('resizeFrame — east handle', () => {
  it('grows the frame to the right when dragging east-positive', () => {
    const start = f(100, 100, 200, 100);
    const next = resizeFrame(start, 'e', 50, 0, false);
    expect(next).toEqual({ x: 100, y: 100, w: 250, h: 100, rotation: 0 });
  });
  it('shrinks the frame when dragging east-negative', () => {
    const start = f(100, 100, 200, 100);
    const next = resizeFrame(start, 'e', -150, 0, false);
    expect(next.w).toBe(50);
  });
  it('does not move the west edge', () => {
    const start = f(100, 100, 200, 100);
    expect(resizeFrame(start, 'e', 30, 0, false).x).toBe(100);
  });
});

describe('resizeFrame — nw handle', () => {
  it('moves the top-left corner; keeps bottom-right in place', () => {
    const start = f(100, 100, 200, 100);
    const next = resizeFrame(start, 'nw', -50, -25, false);
    expect(next).toEqual({ x: 50, y: 75, w: 250, h: 125, rotation: 0 });
  });
});

describe('resizeFrame — shift preserves aspect', () => {
  it('uses the larger relative drag and scales the other axis proportionally', () => {
    const start = f(0, 0, 200, 100);            // 2:1 aspect
    const next = resizeFrame(start, 'se', 100, 10, true); // shift on
    // 100 / 200 = 0.5 (x-relative). 10 / 100 = 0.1 (y-relative).
    // Larger relative is 0.5; apply to both → +100 width, +50 height.
    expect(next.w).toBe(300);
    expect(next.h).toBe(150);
  });
});

describe('resizeFrame — minimum size', () => {
  it('clamps to a 1px minimum so the frame never inverts', () => {
    const start = f(0, 0, 100, 100);
    const next = resizeFrame(start, 'se', -200, -200, false);
    expect(next.w).toBe(1);
    expect(next.h).toBe(1);
  });
});

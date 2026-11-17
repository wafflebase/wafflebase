import { describe, it, expect } from 'vitest';
import {
  pushDecimated,
  simplifyStroke,
  smoothedCommands,
  snapStraight,
} from '../../../../src/view/editor/interactions/ink';

describe('pushDecimated', () => {
  it('drops points closer than the step to the last kept one', () => {
    const pts = [{ x: 0, y: 0 }];
    expect(pushDecimated(pts, { x: 0.5, y: 0 }, 1)).toBe(false);
    expect(pushDecimated(pts, { x: 1.5, y: 0 }, 1)).toBe(true);
    expect(pts).toEqual([{ x: 0, y: 0 }, { x: 1.5, y: 0 }]);
  });
});

describe('simplifyStroke', () => {
  it('drops collinear interior points and keeps the ends', () => {
    const pts = Array.from({ length: 11 }, (_, i) => ({ x: i, y: 0 }));
    expect(simplifyStroke(pts, 0.5)).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
  });

  it('keeps a corner further than epsilon from the chord', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 5, y: 0.1 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    const out = simplifyStroke(pts, 0.5);
    expect(out).toContainEqual({ x: 10, y: 0 });
    expect(out).not.toContainEqual({ x: 5, y: 0.1 });
  });

  it('survives a very long stroke without recursion', () => {
    const pts = Array.from({ length: 50_000 }, (_, i) => ({ x: i, y: Math.sin(i / 10) * 20 }));
    expect(simplifyStroke(pts, 0.5).length).toBeGreaterThan(2);
  });
});

describe('snapStraight', () => {
  it('snaps to the nearest 15° ray, keeping the length', () => {
    const p = snapStraight({ x: 0, y: 0 }, { x: 10, y: 1 });
    expect(p.y).toBeCloseTo(0);
    expect(p.x).toBeCloseTo(Math.hypot(10, 1));
    const q = snapStraight({ x: 0, y: 0 }, { x: 10, y: 9 });
    expect(q.x).toBeCloseTo(q.y); // 45°
  });
});

describe('smoothedCommands', () => {
  it('passes through midpoints and ends on the last point', () => {
    const cmds = smoothedCommands(
      [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 2 },
        { x: 4, y: 2 },
      ],
      (p) => p,
    );
    expect(cmds).toEqual([
      { c: 'M', x: 0, y: 0 },
      { c: 'Q', x1: 2, y1: 0, x: 2, y: 1 },
      { c: 'Q', x1: 2, y1: 2, x: 4, y: 2 },
    ]);
  });
});

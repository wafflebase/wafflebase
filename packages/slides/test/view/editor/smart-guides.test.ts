import { describe, it, expect } from 'vitest';
import type { Frame } from '../../../src/model/element';
import { smartGuides } from '../../../src/view/editor/smart-guides';

const f = (x: number, y: number, w: number, h: number): Frame => ({
  x, y, w, h, rotation: 0,
});
void f;

describe('smartGuides (skeleton)', () => {
  it('returns the dx/dy unchanged and an empty guide list when others is empty', () => {
    const bbox = { x: 100, y: 100, w: 50, h: 50 };
    const out = smartGuides(bbox, 7, 11, []);
    expect(out.dx).toBe(7);
    expect(out.dy).toBe(11);
    expect(out.guides).toEqual([]);
  });
});

describe('smartGuides — equal-spacing (dragged in middle)', () => {
  // A and B at y=100, both 100x100. Dragged at y=100, also 100x100.
  // A: x=0..100. B: x=600..700. Centre-equal spacing puts dragged at
  // x=300..400 (gaps both = 200). If dragged would land at x=298 the
  // adjust is +2 (well inside 8 px). At x=290 it would be +10, outside.
  const A: Frame = { x: 0,   y: 100, w: 100, h: 100, rotation: 0 };
  const B: Frame = { x: 600, y: 100, w: 100, h: 100, rotation: 0 };

  it('snaps the middle bbox so the two gaps are equal', () => {
    // dragged starts at x=200, drag dx=98 -> would land at x=298.
    // Need to verify smartGuides returns dx adjust of +2.
    const bbox = { x: 200, y: 100, w: 100, h: 100 };
    const out = smartGuides(bbox, 98, 0, [A, B]);
    expect(out.dx).toBe(100); // 98 + 2.
    expect(out.dy).toBe(0);
    expect(out.guides).toHaveLength(1);
    const g = out.guides[0];
    expect(g.kind).toBe('equal-spacing');
    expect(g.axis).toBe('x');
  });

  it('does NOT snap when both gaps differ by more than the threshold band', () => {
    // dragged would land at x=200 — gapL = 100, gapR = 400; need +150
    // to balance. Far outside the 8 px band.
    const bbox = { x: 100, y: 100, w: 100, h: 100 };
    const out = smartGuides(bbox, 0, 0, [A, B]);
    expect(out.dx).toBe(0);
    expect(out.guides).toEqual([]);
  });

  it('ignores trios whose rows do not overlap (perpendicular-axis miss)', () => {
    // Move B far down so y-overlap with dragged (y=100..200) is zero.
    const Bfar: Frame = { x: 600, y: 800, w: 100, h: 100, rotation: 0 };
    const bbox = { x: 200, y: 100, w: 100, h: 100 };
    const out = smartGuides(bbox, 98, 0, [A, Bfar]);
    expect(out.dx).toBe(98);
    expect(out.guides).toEqual([]);
  });

  it('works on the y-axis with vertically-stacked neighbours', () => {
    const top: Frame = { x: 100, y: 0,   w: 100, h: 100, rotation: 0 };
    const bot: Frame = { x: 100, y: 600, w: 100, h: 100, rotation: 0 };
    // dragged at y=200 dragging down by dy=98 -> y=298. Even gaps at y=300.
    const bbox = { x: 100, y: 200, w: 100, h: 100 };
    const out = smartGuides(bbox, 0, 98, [top, bot]);
    expect(out.dy).toBe(100);
    expect(out.guides).toHaveLength(1);
    expect(out.guides[0].kind).toBe('equal-spacing');
    expect(out.guides[0].axis).toBe('y');
  });

  it('picks the smallest |adjust| when two trios both qualify', () => {
    // Trio 1: A — dragged — B (needs +2 to balance).
    // Trio 2: A — dragged — C (needs +5 to balance).
    // Trio 1 should win.
    const C: Frame = { x: 606, y: 100, w: 100, h: 100, rotation: 0 };
    const bbox = { x: 200, y: 100, w: 100, h: 100 };
    const out = smartGuides(bbox, 98, 0, [A, B, C]);
    expect(out.dx).toBe(100); // wins by +2 over +5.
  });
});

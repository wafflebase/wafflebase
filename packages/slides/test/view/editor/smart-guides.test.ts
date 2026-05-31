import { describe, it, expect } from 'vitest';
import type { Frame } from '../../../src/model/element';
import { smartGuides, matchSize } from '../../../src/view/editor/smart-guides';
import type { ResizeHandle } from '../../../src/view/editor/interactions/resize';

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

  it('does not fire when the two outer frames do not overlap each other (staircase)', () => {
    // a, dragged, b all overlap each other vertically pairwise, but
    // a (y=0..100) and b (y=200..300) never overlap directly.
    const a: Frame = { x: 0,   y: 0,   w: 100, h: 100, rotation: 0 };
    const b: Frame = { x: 600, y: 200, w: 100, h: 100, rotation: 0 };
    // dragged spans y=80..180, overlapping both a's bottom and b's top.
    const bbox = { x: 200, y: 80, w: 100, h: 100 };
    const out = smartGuides(bbox, 98, 0, [a, b]);
    expect(out.dx).toBe(98);
    expect(out.guides).toEqual([]);
  });
});

describe('smartGuides — equal-spacing (dragged on an end)', () => {
  // Same-row pair (A, B) gap = 100. dragged on the right of B.
  const A: Frame = { x: 0,   y: 100, w: 100, h: 100, rotation: 0 };
  const B: Frame = { x: 200, y: 100, w: 100, h: 100, rotation: 0 };

  it('snaps a right-end dragged element to make gap(B, dragged) == gap(A, B)', () => {
    // dragged at x=395 (gap 95). Adjust to +5 to land at x=400 (gap 100).
    const bbox = { x: 395, y: 100, w: 50, h: 50 };
    const out = smartGuides(bbox, 0, 0, [A, B]);
    expect(out.dx).toBe(5);
    expect(out.guides[0].kind).toBe('equal-spacing');
  });

  it('snaps a left-end dragged element to make gap(dragged, A) == gap(A, B)', () => {
    // gap(A,B) = 100. dragged on left at x=-205 (right edge -155, gap 155 to A.left=0... wait).
    // dragged is 50 wide. To leave gap(dragged.right, A.left) = 100, dragged.right = -100,
    // dragged.x = -150. If dragged at x=-148, adjust = -2.
    const bbox = { x: -148, y: 100, w: 50, h: 50 };
    const out = smartGuides(bbox, 0, 0, [A, B]);
    expect(out.dx).toBe(-2);
    expect(out.guides[0].kind).toBe('equal-spacing');
  });

  it('does not consider end-trios when the pair does not share a row with dragged', () => {
    const Afar: Frame = { x: 0,   y: 700, w: 100, h: 100, rotation: 0 };
    const Bfar: Frame = { x: 200, y: 700, w: 100, h: 100, rotation: 0 };
    const bbox = { x: 395, y: 100, w: 50, h: 50 };
    const out = smartGuides(bbox, 0, 0, [Afar, Bfar]);
    expect(out.dx).toBe(0);
    expect(out.guides).toEqual([]);
  });
});

describe('smartGuides — equal-distance (pair matches known gap)', () => {
  // Known pair A--B on the same row at y=100; gap = 80.
  const A: Frame = { x: 0,   y: 100, w: 100, h: 100, rotation: 0 };
  const B: Frame = { x: 180, y: 100, w: 100, h: 100, rotation: 0 };
  // Neighbour C in the same row, off to the right.
  const C: Frame = { x: 500, y: 100, w: 100, h: 100, rotation: 0 };

  it('snaps dragged so gap(C, dragged) == gap(A, B)', () => {
    // gap(A, B) = 80. dragged needs left = C.right + 80 = 680.
    // Place dragged at left=683 -> adjust = -3.
    const bbox = { x: 683, y: 100, w: 50, h: 50 };
    const out = smartGuides(bbox, 0, 0, [A, B, C]);
    expect(out.dx).toBe(-3);
    expect(out.guides[0].kind).toBe('equal-distance');
  });

  it('snaps dragged on the left of C using the same known gap', () => {
    // dragged.right = C.left - 80 = 420. dragged.x = 370 if w=50.
    // Place dragged at x=372 -> adjust = -2.
    const bbox = { x: 372, y: 100, w: 50, h: 50 };
    const out = smartGuides(bbox, 0, 0, [A, B, C]);
    expect(out.dx).toBe(-2);
    expect(out.guides[0].kind).toBe('equal-distance');
  });

  it('uses smallest |adjust| when only equal-spacing qualifies', () => {
    // With dragged at x=103 (w=50), only the a-dragged-b middle trio
    // qualifies — no equal-distance candidate is within threshold.
    // gapL = 103-50 = 53, gapR = 200-153 = 47, adjust = (47-53)/2 = -3.
    const a: Frame = { x: 0,   y: 100, w: 50, h: 50, rotation: 0 };
    const b: Frame = { x: 200, y: 100, w: 50, h: 50, rotation: 0 };
    const c: Frame = { x: 400, y: 100, w: 50, h: 50, rotation: 0 };
    const bbox = { x: 103, y: 100, w: 50, h: 50 };
    const out = smartGuides(bbox, 0, 0, [a, b, c]);
    expect(out.guides[0].kind).toBe('equal-spacing');
    expect(out.dx).toBe(-3);
  });
});

describe('matchSize', () => {
  const other100: Frame = { x: 0, y: 0, w: 100, h: 100, rotation: 0 };

  it('snaps w to a peer width when |delta| <= 8 (handle e, x stays fixed)', () => {
    const bbox = { x: 500, y: 500, w: 103, h: 60 };
    const out = matchSize(bbox, 'e' as ResizeHandle, [other100]);
    expect(out.x).toBe(500);
    expect(out.w).toBe(100);
    expect(out.h).toBe(60);
    expect(out.guides).toHaveLength(1);
    expect(out.guides[0].kind).toBe('equal-size');
  });

  it('snaps h to a peer height when |delta| <= 8 (handle s, y fixed)', () => {
    const bbox = { x: 500, y: 500, w: 60, h: 95 };
    const out = matchSize(bbox, 's' as ResizeHandle, [other100]);
    expect(out.h).toBe(100);
    expect(out.y).toBe(500);
    expect(out.guides[0].axis).toBe('y');
  });

  it('compensates origin for w-side handles', () => {
    // Handle w: bbox.x is the moving edge. When w shrinks, x moves
    // right by (oldW - newW) so the right edge stays put.
    const bbox = { x: 500, y: 500, w: 105, h: 60 };
    const out = matchSize(bbox, 'w' as ResizeHandle, [other100]);
    expect(out.w).toBe(100);
    expect(out.x).toBe(505); // 500 + (105 - 100).
  });

  it('compensates origin for n-side handles', () => {
    const bbox = { x: 500, y: 500, w: 60, h: 92 };
    const out = matchSize(bbox, 'n' as ResizeHandle, [other100]);
    expect(out.h).toBe(100);
    expect(out.y).toBe(492); // 500 + (92 - 100).
  });

  it('compensates both axes for nw handle', () => {
    // Handle nw: both bbox.x and bbox.y are moving edges. When w/h
    // shrink, x and y both move so the SE corner stays put.
    const other: Frame = { x: 0, y: 0, w: 100, h: 100, rotation: 0 };
    const bbox = { x: 500, y: 500, w: 105, h: 107 };
    const out = matchSize(bbox, 'nw' as ResizeHandle, [other]);
    expect(out.w).toBe(100);
    expect(out.h).toBe(100);
    expect(out.x).toBe(505); // 500 + (105 - 100)
    expect(out.y).toBe(507); // 500 + (107 - 100)
  });

  it('compensates y only for ne handle (top-right corner)', () => {
    // Handle ne: top edge moves (y compensates), right edge moves
    // (x fixed). Only y origin shifts when h changes.
    const other: Frame = { x: 0, y: 0, w: 100, h: 100, rotation: 0 };
    const bbox = { x: 500, y: 500, w: 105, h: 107 };
    const out = matchSize(bbox, 'ne' as ResizeHandle, [other]);
    expect(out.w).toBe(100);
    expect(out.h).toBe(100);
    expect(out.x).toBe(500); // x fixed (right edge moved)
    expect(out.y).toBe(507); // 500 + (107 - 100)
  });

  it('compensates x only for sw handle (bottom-left corner)', () => {
    // Handle sw: left edge moves (x compensates), bottom edge moves
    // (y fixed). Only x origin shifts when w changes.
    const other: Frame = { x: 0, y: 0, w: 100, h: 100, rotation: 0 };
    const bbox = { x: 500, y: 500, w: 105, h: 107 };
    const out = matchSize(bbox, 'sw' as ResizeHandle, [other]);
    expect(out.w).toBe(100);
    expect(out.h).toBe(100);
    expect(out.x).toBe(505); // 500 + (105 - 100)
    expect(out.y).toBe(500); // y fixed (bottom edge moved)
  });

  it('matches both axes independently for a corner handle (se)', () => {
    const otherTall: Frame = { x: 0, y: 0, w: 100, h: 200, rotation: 0 };
    const otherWide: Frame = { x: 0, y: 0, w: 300, h: 100, rotation: 0 };
    const bbox = { x: 0, y: 0, w: 297, h: 203 };
    const out = matchSize(bbox, 'se' as ResizeHandle, [otherTall, otherWide]);
    expect(out.w).toBe(300);
    expect(out.h).toBe(200);
  });

  it('collects every peer that shares the matched dimension', () => {
    const otherA: Frame = { x: 0,   y: 0,   w: 100, h: 80, rotation: 0 };
    const otherB: Frame = { x: 500, y: 500, w: 100, h: 60, rotation: 0 };
    const bbox = { x: 0, y: 0, w: 102, h: 200 };
    const out = matchSize(bbox, 'e' as ResizeHandle, [otherA, otherB]);
    expect(out.w).toBe(100);
    expect(out.guides[0].kind).toBe('equal-size');
    if (out.guides[0].kind === 'equal-size') {
      expect(out.guides[0].matchedFrames).toHaveLength(2);
    }
  });

  it('returns the bbox unchanged when no peer is within 8 px', () => {
    const bbox = { x: 0, y: 0, w: 200, h: 200 };
    const out = matchSize(bbox, 'se' as ResizeHandle, [other100]);
    expect(out).toEqual({ x: 0, y: 0, w: 200, h: 200, guides: [] });
  });
});

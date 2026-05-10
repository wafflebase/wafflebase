import { describe, it, expect } from 'vitest';
import type { Frame } from '../../model/element';
import { snapDelta } from './snap';

const f = (x: number, y: number, w: number, h: number): Frame => ({
  x, y, w, h, rotation: 0,
});

describe('snapDelta', () => {
  const SLIDE = { w: 1920, h: 1080 };

  it('snaps the dragged centre to the slide centre when within 8 px', () => {
    // Group bbox = single 100x100 element starting at x=860, y=0.
    // Dragging right by dx=98 puts it at 958..1058 (centre at 1008,
    // exactly 48 from slide centre 960). Snap should NOT trigger
    // because 48 > 8.
    const result = snapDelta({ x: 860, y: 0, w: 100, h: 100 }, 98, 0, [], SLIDE);
    expect(result.dx).toBe(98);

    // Dragging right by 102 puts the element at 962..1062 (centre at
    // 1012, 52 from slide centre — also outside threshold). Snap to
    // slide centre would require dx that puts centre at 960, i.e.
    // dx = (960 - 100/2) - 860 = 50. So if drag is 50±8 the snap
    // engages.
    const result2 = snapDelta({ x: 860, y: 0, w: 100, h: 100 }, 53, 0, [], SLIDE);
    expect(result2.dx).toBe(50);
  });

  it('snaps to the nearest non-selected element edge', () => {
    const others: Frame[] = [f(500, 0, 100, 100)];
    // Dragging the bbox (originally at x=860) so its left edge is at
    // 603 (dx=-257) — within 3 of element a's right edge (600).
    // Snap: left edge → 600 → dx = -260.
    const result = snapDelta(
      { x: 860, y: 0, w: 100, h: 100 }, -257, 0, others, SLIDE,
    );
    expect(result.dx).toBe(-260);
  });

  it('does not snap when no edge is within threshold', () => {
    const result = snapDelta(
      { x: 0, y: 0, w: 100, h: 100 }, 17, 23, [], { w: 1920, h: 1080 },
    );
    expect(result.dx).toBe(17);
    expect(result.dy).toBe(23);
  });

  it('emits a slide-center guide when snapping to the slide centre', () => {
    const result = snapDelta(
      { x: 860, y: 0, w: 100, h: 100 }, 53, 0, [], SLIDE,
    );
    expect(result.guides).toContainEqual({
      axis: 'x',
      position: 960,
      kind: 'slide-center',
    });
  });

  it('emits an edge guide when snapping to an element edge', () => {
    const others: Frame[] = [f(500, 0, 100, 100)];
    const result = snapDelta(
      { x: 860, y: 0, w: 100, h: 100 }, -257, 0, others, SLIDE,
    );
    expect(result.guides).toContainEqual({
      axis: 'x',
      position: 600,
      kind: 'edge',
    });
  });

  it('returns an empty guides array when nothing snaps', () => {
    const result = snapDelta(
      { x: 0, y: 0, w: 100, h: 100 }, 17, 23, [], { w: 1920, h: 1080 },
    );
    expect(result.guides).toEqual([]);
  });
});

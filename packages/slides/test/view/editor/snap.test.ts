import { describe, it, expect } from 'vitest';
import type { Frame } from '../../../src/model/element';
import { snapDelta } from '../../../src/view/editor/snap';

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
    // Place the other element at y=400 so its edges don't collide with
    // the dragged bbox's y edges (which stay at 0/100 since dy=0).
    const others: Frame[] = [f(500, 400, 100, 100)];
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
    expect(result.guides).toEqual([
      { axis: 'x', position: 960, kind: 'slide-center' },
    ]);
  });

  it('emits an edge guide when snapping to an element edge', () => {
    // Place the other at y=400 so its y edges don't accidentally
    // align with the dragged bbox (y=0..100, dy=0) and emit a phantom
    // y-axis guide.
    const others: Frame[] = [f(500, 400, 100, 100)];
    const result = snapDelta(
      { x: 860, y: 0, w: 100, h: 100 }, -257, 0, others, SLIDE,
    );
    expect(result.guides).toEqual([
      { axis: 'x', position: 600, kind: 'edge' },
    ]);
  });

  it('returns an empty guides array when nothing snaps', () => {
    const result = snapDelta(
      { x: 0, y: 0, w: 100, h: 100 }, 17, 23, [], { w: 1920, h: 1080 },
    );
    expect(result.guides).toEqual([]);
  });

  // --- Phase 5: presentation-wide guides as snap targets ---

  it('snaps the dragged left edge to a vertical guide', () => {
    // bbox at x=860 + dx=37 puts left edge at 897. Guide at 900 is
    // 3 px away — inside threshold. Snap: dx = 40 (left edge → 900).
    const guides = [{ id: 'g1', axis: 'x' as const, position: 900 }];
    const result = snapDelta(
      { x: 860, y: 0, w: 100, h: 100 }, 37, 0, [], SLIDE, guides,
    );
    expect(result.dx).toBe(40);
    expect(result.guides[0]).toMatchObject({
      axis: 'x',
      position: 900,
      kind: 'guide',
      guideId: 'g1',
    });
  });

  it('prefers slide-center over a user guide within the same threshold', () => {
    // Both candidates within threshold; slide-center wins.
    // dragged bbox (x=860, w=100) at dx=53 → centre at 1013, snap to 960 (Δ=−3).
    // Guide at 1014 → dragged left edge (860+53+? — use centre snap instead).
    // Construct so slide-centre and guide both qualify; slide-centre
    // demands centre→960 (dx=50). Guide at 960 also matches by centre
    // (Δ=0). With ties on position they both target 960; the priority
    // rule keeps `kind: 'slide-center'`.
    const guides = [{ id: 'g1', axis: 'x' as const, position: 960 }];
    const result = snapDelta(
      { x: 860, y: 0, w: 100, h: 100 }, 53, 0, [], SLIDE, guides,
    );
    expect(result.guides[0].kind).toBe('slide-center');
  });

  it('prefers a user guide over a closer element edge', () => {
    // Edge at x=500 right edge — dragged left edge at 503 → 3 px gap.
    // Guide at x=505 → dragged left edge at 503 → 2 px gap.
    // Both inside threshold (8). Closer = edge, but guide outranks it.
    const others: Frame[] = [f(400, 400, 100, 100)];
    const guides = [{ id: 'g1', axis: 'x' as const, position: 505 }];
    const result = snapDelta(
      { x: 0, y: 0, w: 100, h: 100 }, 503, 0, others, SLIDE, guides,
    );
    // dragged left edge (originally 0) + dx → 505 (= guide.position).
    // So dx should be 505 (snap by left edge to the guide).
    expect(result.dx).toBe(505);
    expect(result.guides[0]).toMatchObject({
      kind: 'guide',
      guideId: 'g1',
    });
  });

  it('snaps the dragged top edge to a horizontal guide', () => {
    const guides = [{ id: 'gh', axis: 'y' as const, position: 300 }];
    const result = snapDelta(
      { x: 0, y: 0, w: 100, h: 100 }, 0, 297, [], SLIDE, guides,
    );
    expect(result.dy).toBe(300);
    expect(result.guides[0]).toMatchObject({
      axis: 'y',
      position: 300,
      kind: 'guide',
      guideId: 'gh',
    });
  });

  it('does not snap when a guide is outside the 8-px threshold', () => {
    const guides = [{ id: 'g1', axis: 'x' as const, position: 500 }];
    const result = snapDelta(
      { x: 0, y: 0, w: 100, h: 100 }, 10, 0, [], SLIDE, guides,
    );
    expect(result.dx).toBe(10);
    expect(result.guides).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import type { Element } from '../../../../src/model/element';
import { translateElement } from '../../../../src/view/editor/interactions/drag';
import { lockAxis } from '../../../../src/view/editor/interactions/constraints';
import { snapDelta } from '../../../../src/view/editor/snap';

const shape = (id: string, x: number, y: number): Element => ({
  id, type: 'shape',
  frame: { x, y, w: 100, h: 100, rotation: 0 },
  data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
});

describe('translateElement', () => {
  it('translates a shape\'s frame', () => {
    const result = translateElement(shape('a', 100, 100), 50, 30);
    expect(result.frame.x).toBe(150);
    expect(result.frame.y).toBe(130);
  });

  it('preserves rotation and size', () => {
    const original: Element = {
      ...shape('a', 0, 0),
      frame: { x: 0, y: 0, w: 100, h: 100, rotation: Math.PI / 4 },
    };
    const result = translateElement(original, 10, 10);
    expect(result.frame.rotation).toBe(Math.PI / 4);
    expect(result.frame.w).toBe(100);
    expect(result.frame.h).toBe(100);
  });

  it('does not mutate the input', () => {
    const original = shape('a', 0, 0);
    translateElement(original, 1, 2);
    expect(original.frame.x).toBe(0);
  });

  it('translates a connector\'s free endpoints and cached frame', () => {
    const connector: Element = {
      id: 'c',
      type: 'connector',
      routing: 'straight',
      start: { kind: 'free', x: 100, y: 100 },
      end:   { kind: 'free', x: 300, y: 200 },
      arrowheads: {},
      frame: { x: 100, y: 100, w: 200, h: 100, rotation: 0 },
    };
    const result = translateElement(connector, 20, -10);
    if (result.type !== 'connector') throw new Error('unreachable');
    expect(result.start).toEqual({ kind: 'free', x: 120, y: 90 });
    expect(result.end).toEqual({ kind: 'free', x: 320, y: 190 });
    expect(result.frame.x).toBe(120);
    expect(result.frame.y).toBe(90);
  });

  it('leaves attached endpoints anchored to their host', () => {
    const connector: Element = {
      id: 'c',
      type: 'connector',
      routing: 'straight',
      start: { kind: 'attached', elementId: 'host', siteIndex: 0 },
      end:   { kind: 'free', x: 300, y: 200 },
      arrowheads: {},
      frame: { x: 100, y: 100, w: 200, h: 100, rotation: 0 },
    };
    const result = translateElement(connector, 20, -10);
    if (result.type !== 'connector') throw new Error('unreachable');
    // start is untouched — the renderer keeps it pinned to its host.
    expect(result.start).toEqual({ kind: 'attached', elementId: 'host', siteIndex: 0 });
    expect(result.end).toEqual({ kind: 'free', x: 320, y: 190 });
  });
});

describe('move drag + Shift locks to dominant axis', () => {
  it('locks to X when horizontal delta dominates', () => {
    expect(lockAxis(120, 18)).toEqual({ dx: 120, dy: 0 });
  });

  it('locks to Y when vertical delta dominates', () => {
    expect(lockAxis(18, -120)).toEqual({ dx: 0, dy: -120 });
  });

  it('switches axis live when the user changes direction', () => {
    // Simulates two onMove frames: first horizontal-dominant, then
    // vertical-dominant. The lock follows the cumulative pointer.
    const t1 = lockAxis(50, 5);
    expect(t1).toEqual({ dx: 50, dy: 0 });
    const t2 = lockAxis(50, 200);
    expect(t2).toEqual({ dx: 0, dy: 200 });
  });

  // Regression: snapDelta evaluates X and Y independently, so a pre-snap
  // lockAxis isn't enough on its own. If a sibling edge sits within
  // SNAP_THRESHOLD of the locked-zero axis, snapDelta will re-introduce
  // a non-zero adjustment on that axis and the element drifts off-lock.
  // The editor's move-drag handler must re-apply lockAxis AFTER snap to
  // preserve the constraint.
  it('lockAxis after snapDelta keeps the perpendicular axis at zero', () => {
    const dragged = { x: 0, y: 0, w: 100, h: 100 };
    // Sibling sits with its left edge at y=2 — within snap threshold of
    // the dragged top after a pure-horizontal move that started at y=0.
    const sibling = { x: 500, y: 2, w: 50, h: 50, rotation: 0 };
    const slide = { w: 1920, h: 1080 };

    // Pre-snap lock: user dragged (200, 5), horizontal dominant → (200, 0).
    const preLock = lockAxis(200, 5);
    expect(preLock).toEqual({ dx: 200, dy: 0 });

    // snapDelta re-introduces dy because sibling.top=2 is 2px from the
    // dragged top (which is at y=0 after preLock.dy=0).
    const snapped = snapDelta(
      dragged,
      preLock.dx,
      preLock.dy,
      [sibling],
      slide,
    );
    expect(snapped.dy).not.toBe(0);

    // Re-locking AFTER snap restores the perpendicular zero.
    const final = lockAxis(snapped.dx, snapped.dy);
    expect(final.dy).toBe(0);
    expect(final.dx).toBe(snapped.dx);
  });
});

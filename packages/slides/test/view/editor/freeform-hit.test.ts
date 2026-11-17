import { describe, expect, it } from 'vitest';
import '../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../src/view/canvas/test-canvas-env';
import { hitTestElement } from '../../../src/view/editor/element-hit';
import {
  freeformDistance,
  segmentHitsFreeform,
  type FreeformShape,
} from '../../../src/view/editor/freeform-hit';
import { flattenFreeformPath } from '../../../src/view/canvas/shapes/freeform';
import type { ShapeElement } from '../../../src/model/element';

const ctx = createTestCanvas(1, 1).getContext('2d');

/** A diagonal stroke from (0,0) to (100,100), 2px wide. */
function diagonal(extra: Partial<ShapeElement['data']> = {}, rotation = 0): FreeformShape {
  return {
    id: 's',
    type: 'shape',
    frame: { x: 0, y: 0, w: 100, h: 100, rotation },
    data: {
      kind: 'freeform',
      path: { commands: [{ c: 'M', x: 0, y: 0 }, { c: 'L', x: 1, y: 1 }] },
      stroke: { color: '#000', width: 2 },
      ...extra,
    },
  } as FreeformShape;
}

describe('freeform hit-testing', () => {
  it('hits near the line of an open stroke', () => {
    expect(hitTestElement(diagonal(), 50, 50, ctx, { tolerance: 6 })).toBe(true);
    expect(hitTestElement(diagonal(), 55, 50, ctx, { tolerance: 6 })).toBe(true);
  });

  it('misses inside the bbox but away from the line', () => {
    // Used to hit: the freeform fell back to its padded bbox.
    expect(hitTestElement(diagonal(), 90, 10, ctx, { tolerance: 6 })).toBe(false);
    expect(hitTestElement(diagonal(), 20, 80, ctx, { tolerance: 6 })).toBe(false);
  });

  it('widens with the stroke and with the tolerance', () => {
    // 20px off the centre line along the normal.
    const off = { x: 50 + 20 / Math.SQRT2, y: 50 - 20 / Math.SQRT2 };
    expect(hitTestElement(diagonal(), off.x, off.y, ctx, { tolerance: 6 })).toBe(false);
    const wide = diagonal({ stroke: { color: '#000', width: 32 } });
    expect(hitTestElement(wide, off.x, off.y, ctx, { tolerance: 6 })).toBe(true);
    expect(hitTestElement(diagonal(), off.x, off.y, ctx, { tolerance: 25 })).toBe(true);
  });

  it('honours rotation', () => {
    // Rotated 90° about the centre, the (0,0)→(100,100) diagonal becomes
    // (100,0)→(0,100).
    const el = diagonal({}, Math.PI / 2);
    expect(hitTestElement(el, 90, 10, ctx, { tolerance: 6 })).toBe(true);
    expect(hitTestElement(el, 10, 10, ctx, { tolerance: 6 })).toBe(false);
  });

  it('hits inside a closed, filled freeform', () => {
    const el: FreeformShape = {
      id: 'tri',
      type: 'shape',
      frame: { x: 0, y: 0, w: 100, h: 100, rotation: 0 },
      data: {
        kind: 'freeform',
        path: {
          commands: [
            { c: 'M', x: 0, y: 0 },
            { c: 'L', x: 1, y: 0 },
            { c: 'L', x: 0, y: 1 },
            { c: 'Z' },
          ],
        },
        fill: { kind: 'srgb', value: '#abc' },
      },
    } as FreeformShape;
    expect(hitTestElement(el, 20, 20, ctx)).toBe(true);
    expect(hitTestElement(el, 90, 90, ctx)).toBe(false);
  });

  it('follows a smoothed (quadratic) stroke, not its chord', () => {
    const el = diagonal({
      path: {
        commands: [
          { c: 'M', x: 0, y: 1 },
          { c: 'Q', x1: 0.5, y1: -1, x: 1, y: 1 },
        ],
      },
    });
    // The curve's apex is at (50, 0); the chord runs along y = 100.
    expect(freeformDistance(el, 50, 0)).toBeLessThan(1);
    expect(hitTestElement(el, 50, 98, ctx, { tolerance: 6 })).toBe(false);
  });
});

describe('segmentHitsFreeform (eraser)', () => {
  it('catches a swipe that crosses the stroke between two samples', () => {
    expect(segmentHitsFreeform(diagonal(), { x: 0, y: 100 }, { x: 100, y: 0 }, 1)).toBe(true);
  });

  it('ignores a swipe that only passes through the bbox', () => {
    expect(segmentHitsFreeform(diagonal(), { x: 70, y: 5 }, { x: 95, y: 30 }, 4)).toBe(false);
  });
});

describe('flattenFreeformPath', () => {
  it('closes a Z subpath back to its start', () => {
    const lines = flattenFreeformPath(
      { w: 10, h: 10 },
      { commands: [{ c: 'M', x: 0, y: 0 }, { c: 'L', x: 1, y: 0 }, { c: 'Z' }] },
    );
    expect(lines).toEqual([[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }]]);
  });
});

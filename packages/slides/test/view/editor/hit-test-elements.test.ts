import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import '../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../src/view/canvas/test-canvas-env';
import { hitTestSlide } from '../../../src/view/editor/hit-test-elements';
import { applyGroupTransform } from '../../../src/model/group';
import type { Slide } from '../../../src/model/presentation';
import type { GroupElement, ShapeElement } from '../../../src/model/element';

const ctx = createTestCanvas(1, 1).getContext('2d');
const hitOpts = { ctx };

function shape(
  id: string,
  frame: { x: number; y: number; w: number; h: number; rotation?: number },
): ShapeElement {
  // Precise hit-test requires the shape to actually render — give it a
  // fill so `isPointInPath` has a body to land on.
  return {
    id,
    type: 'shape',
    frame: { rotation: 0, ...frame },
    data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
  };
}

function group(
  id: string,
  frame: { x: number; y: number; w: number; h: number; rotation?: number },
  children: Array<ShapeElement | GroupElement>,
): GroupElement {
  return { id, type: 'group', frame: { rotation: 0, ...frame }, data: { children } };
}

function slide(elements: Slide['elements']): Slide {
  return {
    id: 'sl',
    layoutId: 'blank',
    background: { kind: 'fill', fill: { type: 'srgb', value: '#fff' } } as unknown as Slide['background'],
    elements,
    notes: [],
  };
}

describe('hitTestSlide', () => {
  it('returns null when the point misses everything', () => {
    expect(hitTestSlide(slide([]), 0, 0, hitOpts)).toBeNull();
  });

  it('hits a slide-root shape', () => {
    const a = shape('a', { x: 10, y: 10, w: 20, h: 20 });
    const r = hitTestSlide(slide([a]), 15, 15, hitOpts);
    expect(r?.elementId).toBe('a');
    expect(r?.ancestorPath).toEqual(['a']);
  });

  it('misses a slide-root shape when point is outside', () => {
    const a = shape('a', { x: 10, y: 10, w: 20, h: 20 });
    expect(hitTestSlide(slide([a]), 5, 5, hitOpts)).toBeNull();
  });

  it('returns null when the point is inside a group bbox but misses every child', () => {
    // inner lives at group-local (0..20, 0..20); group is at world (50..150, 50..150)
    // world (75, 75) maps to group-local (25, 25) which is past inner.
    const inner = shape('inner', { x: 0, y: 0, w: 20, h: 20 });
    const g = group('g', { x: 50, y: 50, w: 100, h: 100 }, [inner]);
    const r = hitTestSlide(slide([g]), 75, 75, hitOpts);
    expect(r).toBeNull();
  });

  it('hits a shape that is a direct child of a group', () => {
    // inner at group-local (0..20, 0..20); group world origin at (50, 50)
    // world (55, 55) → group-local (5, 5) → inside inner
    const inner = shape('inner', { x: 0, y: 0, w: 20, h: 20 });
    const g = group('g', { x: 50, y: 50, w: 100, h: 100 }, [inner]);
    const r = hitTestSlide(slide([g]), 55, 55, hitOpts);
    expect(r?.elementId).toBe('inner');
    expect(r?.ancestorPath).toEqual(['g', 'inner']);
  });

  it('hits a shape inside a nested rotated group', () => {
    const leaf = shape('leaf', { x: 10, y: 10, w: 20, h: 20 });
    const inner = group('inner', { x: 50, y: 50, w: 100, h: 100, rotation: Math.PI / 6 }, [leaf]);
    const outer = group('outer', { x: 100, y: 100, w: 200, h: 200 }, [inner]);
    // Compute the world center of the leaf by walking the group transforms.
    const leafInInner = applyGroupTransform(leaf.frame, inner);
    const leafWorld = applyGroupTransform(leafInInner, outer);
    const cx = leafWorld.x + leafWorld.w / 2;
    const cy = leafWorld.y + leafWorld.h / 2;
    const r = hitTestSlide(slide([outer]), cx, cy, hitOpts);
    expect(r?.elementId).toBe('leaf');
    expect(r?.ancestorPath).toEqual(['outer', 'inner', 'leaf']);
  });

  it('returns the topmost (front) element when shapes overlap', () => {
    const a = shape('a', { x: 0, y: 0, w: 50, h: 50 });
    const b = shape('b', { x: 0, y: 0, w: 50, h: 50 });
    const r = hitTestSlide(slide([a, b]), 25, 25, hitOpts);
    expect(r?.elementId).toBe('b');
  });

  it('returns front group child over a rear slide-root shape at the same world point', () => {
    // bg covers world (0..200, 0..200); group+child covers world (50..150, 50..150)
    const bg = shape('bg', { x: 0, y: 0, w: 200, h: 200 });
    const child = shape('child', { x: 0, y: 0, w: 100, h: 100 });
    const g = group('g', { x: 50, y: 50, w: 100, h: 100 }, [child]);
    // world (60, 60) is inside both bg and the group; group is on top.
    const r = hitTestSlide(slide([bg, g]), 60, 60, hitOpts);
    expect(r?.elementId).toBe('child');
    expect(r?.ancestorPath).toEqual(['g', 'child']);
  });

  // Regression: PPTX-imported placeholder shapes often carry text via
  // `<p:sp>/<p:txBody>` with no fill and no stroke — the renderer paints
  // the text on top of the (empty) shape body, so users expect to click
  // on the text area to select. Pre-fix, `hitShape` rejected any
  // `!hasFill && !hasStroke` shape outright, making these "text-only
  // shapes" unclickable.
  it('hits a text-only shape (no fill, no stroke, has data.text)', () => {
    const textOnly: ShapeElement = {
      id: 'titleish',
      type: 'shape',
      frame: { x: 10, y: 10, w: 200, h: 60, rotation: 0 },
      data: {
        kind: 'rect',
        text: {
          blocks: [{
            id: 'b1', type: 'paragraph',
            inlines: [{ text: 'Hello', style: {} }],
            style: {},
          }] as never,
        },
      },
    };
    const r = hitTestSlide(slide([textOnly]), 110, 40, hitOpts);
    expect(r?.elementId).toBe('titleish');
  });

  it('does not hit an empty shape (no fill, no stroke, no text)', () => {
    const empty: ShapeElement = {
      id: 'invisible',
      type: 'shape',
      frame: { x: 10, y: 10, w: 200, h: 60, rotation: 0 },
      data: { kind: 'rect' },
    };
    expect(hitTestSlide(slide([empty]), 110, 40, hitOpts)).toBeNull();
  });

  // Regression guard for the `hasText` gate's interaction with
  // OPEN_PATH_KINDS. `isPointInPath` auto-closes an open polyline
  // (leftBracket / rightBracket / leftBrace / rightBrace) with a
  // straight line, yielding a C/U-shaped interior the path was never
  // meant to enclose. Without the OPEN_PATH guard, a text-bearing
  // bracket would falsely register hits across that closed C, which
  // is exactly the failure mode `OPEN_PATH_KINDS` exists to prevent
  // for fills (see PR #266, `5b6197ef`). A click well inside the
  // open mouth — far from any visible stroke — must NOT hit.
  it('does not hit OPEN_PATH_KINDS interior even when shape has text', () => {
    const bracket: ShapeElement = {
      id: 'bracketText',
      type: 'shape',
      frame: { x: 0, y: 0, w: 400, h: 200, rotation: 0 },
      data: {
        kind: 'leftBracket',
        text: {
          blocks: [{
            id: 'b1', type: 'paragraph',
            inlines: [{ text: 'Hi', style: {} }],
            style: {},
          }] as never,
        },
      },
    };
    // Far right of the bracket's open mouth, well clear of the spine
    // on the left edge and of the short top/bottom serifs.
    expect(hitTestSlide(slide([bracket]), 350, 100, hitOpts)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Property-based: a point at the center of a leaf always hits that leaf
// ---------------------------------------------------------------------------
describe('hitTestSlide property', () => {
  it('a point inside a nested leaf hits that leaf', () => {
    fc.assert(
      fc.property(
        fc.record({
          gx: fc.float({ min: -200, max: 200, noNaN: true }),
          gy: fc.float({ min: -200, max: 200, noNaN: true }),
          gw: fc.float({ min: 100, max: 500, noNaN: true }),
          gh: fc.float({ min: 100, max: 500, noNaN: true }),
          gr: fc.float({ min: Math.fround(-Math.PI), max: Math.fround(Math.PI), noNaN: true }),
          cx: fc.float({ min: 10, max: 60, noNaN: true }),
          cy: fc.float({ min: 10, max: 60, noNaN: true }),
        }),
        ({ gx, gy, gw, gh, gr, cx, cy }) => {
          const leaf = shape('leaf', { x: cx, y: cy, w: 20, h: 20 });
          const g = group('g', { x: gx, y: gy, w: gw, h: gh, rotation: gr }, [leaf]);
          // World coordinates of the leaf's center.
          const leafWorld = applyGroupTransform(leaf.frame, g);
          const wx = leafWorld.x + leafWorld.w / 2;
          const wy = leafWorld.y + leafWorld.h / 2;
          const r = hitTestSlide(slide([g]), wx, wy, hitOpts);
          expect(r?.elementId).toBe('leaf');
          expect(r?.ancestorPath).toEqual(['g', 'leaf']);
        },
      ),
      { numRuns: 50 },
    );
  });
});

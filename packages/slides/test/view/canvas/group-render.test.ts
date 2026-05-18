import { describe, it, expect } from 'vitest';
// Install Path2D global before importing the renderer (shape painter uses it).
import '../../../src/view/canvas/test-canvas-env';
import { drawElement } from '../../../src/view/canvas/element-renderer';
import { drawSlide } from '../../../src/view/canvas/slide-renderer';
import { flattenElements } from '../../../src/model/group';
import { defaultLight } from '../../../src/themes/default-light';
import { DEFAULT_MASTER } from '../../../src/model/master';
import { BUILT_IN_LAYOUTS } from '../../../src/model/layout';
import { DEFAULT_BACKGROUND } from '../../../src/model/presentation';
import type { GroupElement, ShapeElement } from '../../../src/model/element';
import type { Slide, SlidesDocument } from '../../../src/model/presentation';
import type { Theme } from '../../../src/model/theme';

// ---------------------------------------------------------------------------
// Recording ctx: records every method call and property set.
// We avoid using CtxSpy (vitest.fn-based) here so the tests remain focused
// on the *sequence* of ctx operations rather than on spy call counts.
// ---------------------------------------------------------------------------

interface CtxCall {
  op: string;
  args: unknown[];
}

function makeRecordingCtx(): {
  ctx: CanvasRenderingContext2D;
  calls: CtxCall[];
} {
  const calls: CtxCall[] = [];
  const proxy = new Proxy({} as CanvasRenderingContext2D, {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined;
      // Special-case measureText so text painters don't throw.
      if (prop === 'measureText') {
        return (...args: unknown[]) => {
          calls.push({ op: prop, args });
          return { width: 0 };
        };
      }
      return (...args: unknown[]) => {
        calls.push({ op: prop, args });
        return undefined;
      };
    },
    set(_target, prop, value) {
      calls.push({ op: `set:${String(prop)}`, args: [value] });
      return true;
    },
  });
  return { ctx: proxy, calls };
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const THEME: Theme = defaultLight;

function emptyDoc(): SlidesDocument {
  return {
    meta: { title: 'test', themeId: THEME.id, masterId: DEFAULT_MASTER.id },
    themes: [THEME],
    masters: [DEFAULT_MASTER],
    layouts: BUILT_IN_LAYOUTS,
    slides: [],
  };
}

function makeShape(id: string, x: number, y: number, w = 20, h = 20): ShapeElement {
  return {
    id,
    type: 'shape',
    frame: { x, y, w, h, rotation: 0 },
    data: { kind: 'rect' },
  };
}

function makeGroup(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  rotation: number,
  children: GroupElement['data']['children'],
): GroupElement {
  return {
    id,
    type: 'group',
    frame: { x, y, w, h, rotation },
    data: { children },
  };
}

// ---------------------------------------------------------------------------
// Tests: drawElement on a GroupElement
// ---------------------------------------------------------------------------

describe('drawElement on a group', () => {
  it('saves, applies group translate, paints children, restores', () => {
    const { ctx, calls } = makeRecordingCtx();
    const inner = makeShape('s', 10, 10);
    const g = makeGroup('g', 100, 200, 300, 400, 0, [inner]);

    drawElement(ctx, g, emptyDoc(), THEME, () => {});

    const ops = calls.map((c) => c.op);
    // Group save + inner shape save = 2 saves; 2 matching restores.
    expect(ops.filter((o) => o === 'save').length).toBe(2);
    expect(ops.filter((o) => o === 'restore').length).toBe(2);

    // Group has no rotation, so the fast path is used: translate(x, y).
    // The child shape also has no rotation: translate(child.x, child.y).
    const translates = calls.filter((c) => c.op === 'translate');
    expect(translates.length).toBeGreaterThanOrEqual(2);
    // First translate is the group's, second is the inner shape's.
    expect(translates[0].args).toEqual([100, 200]);
    expect(translates[1].args).toEqual([10, 10]);
  });

  it('recursively paints nested groups (3 levels → 3 save/restore pairs)', () => {
    const { ctx, calls } = makeRecordingCtx();
    const leaf = makeShape('leaf', 5, 5, 10, 10);
    const inner = makeGroup('inner', 50, 50, 100, 100, 0, [leaf]);
    const outer = makeGroup('outer', 200, 300, 400, 500, 0, [inner]);

    drawElement(ctx, outer, emptyDoc(), THEME, () => {});

    const saves = calls.filter((c) => c.op === 'save').length;
    const restores = calls.filter((c) => c.op === 'restore').length;
    // outer group + inner group + leaf shape = 3 save/restore pairs
    expect(saves).toBe(3);
    expect(restores).toBe(3);
  });

  it('paints a rotated group using the centre-relative rotate path', () => {
    const { ctx, calls } = makeRecordingCtx();
    const inner = makeShape('s', 0, 0);
    const g = makeGroup('g', 100, 100, 200, 100, Math.PI / 4, [inner]);

    drawElement(ctx, g, emptyDoc(), THEME, () => {});

    const ops = calls.map((c) => c.op);
    expect(ops).toContain('rotate');

    // Rotated path: translate(cx, cy), rotate(θ), translate(-w/2, -h/2).
    // The centre of this group is (100+100, 100+50) = (200, 150).
    const translates = calls.filter((c) => c.op === 'translate');
    // First translate of the group block should be (cx, cy)
    expect(translates[0].args).toEqual([200, 150]);
  });

  it('group with zero children saves and restores without painting anything', () => {
    const { ctx, calls } = makeRecordingCtx();
    const g = makeGroup('g', 0, 0, 100, 100, 0, []);

    drawElement(ctx, g, emptyDoc(), THEME, () => {});

    const ops = calls.map((c) => c.op);
    expect(ops.filter((o) => o === 'save').length).toBe(1);
    expect(ops.filter((o) => o === 'restore').length).toBe(1);
    // No child ops: only the group transform (one translate) is called.
    expect(ops.filter((o) => o === 'translate').length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Tests: flattenElements helper
// ---------------------------------------------------------------------------

describe('flattenElements', () => {
  it('returns a flat list of all elements at every nesting depth', () => {
    const leaf = makeShape('leaf', 0, 0);
    const inner = makeGroup('inner', 0, 0, 50, 50, 0, [leaf]);
    const top = makeShape('top', 0, 0);
    const outer = makeGroup('outer', 0, 0, 100, 100, 0, [inner]);

    const flat = flattenElements([top, outer]);
    const ids = flat.map((e) => e.id);
    expect(ids).toEqual(['top', 'outer', 'inner', 'leaf']);
  });

  it('works on flat element lists (no groups)', () => {
    const a = makeShape('a', 0, 0);
    const b = makeShape('b', 0, 0);
    const flat = flattenElements([a, b]);
    expect(flat.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('nested elements appear in the lookup map built from flattenElements', () => {
    const inner = makeShape('shape-inside', 10, 10);
    const g = makeGroup('g', 0, 0, 100, 100, 0, [inner]);

    const lookup = new Map(flattenElements([g]).map((e) => [e.id, e]));
    expect(lookup.has('g')).toBe(true);
    expect(lookup.has('shape-inside')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: drawSlide uses the deep lookup (smoke)
// ---------------------------------------------------------------------------

describe('drawSlide — elementsLookup includes nested elements', () => {
  it('builds a lookup that resolves a shape nested inside a group', () => {
    // We call drawSlide with a slide containing a group that wraps a shape.
    // The point of the test is not to assert specific ctx calls, but to
    // confirm that the flattenElements path doesn't throw and that the slide
    // renders without errors.
    const { ctx } = makeRecordingCtx();
    const inner = makeShape('nested-shape', 10, 10, 30, 30);
    const g = makeGroup('grp', 50, 50, 200, 200, 0, [inner]);

    const slide: Slide = {
      id: 'slide-1',
      layoutId: 'blank',
      background: { ...DEFAULT_BACKGROUND },
      elements: [g],
      notes: [],
    };

    const doc = emptyDoc();

    // Should not throw.
    expect(() =>
      drawSlide(ctx, slide, doc, { hostWidth: 192, hostHeight: 108, dpr: 1 }),
    ).not.toThrow();
  });
});

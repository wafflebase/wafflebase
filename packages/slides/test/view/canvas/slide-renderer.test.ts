// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import type { Slide, SlidesDocument } from '../../../src/model/presentation';
import { DEFAULT_BACKGROUND, SLIDE_HEIGHT, SLIDE_WIDTH } from '../../../src/model/presentation';
import type { Theme } from '../../../src/model/theme';
import { DEFAULT_MASTER } from '../../../src/model/master';
import { BUILT_IN_LAYOUTS } from '../../../src/model/layout';
import { asCtx, createCtxSpy } from '../../../src/view/canvas/ctx-spy';
// Install Path2D global before the slide renderer pulls in shape builders.
import '../../../src/view/canvas/test-canvas-env';
import { SlideRenderer, drawSlide, GHOST_ALPHA } from '../../../src/view/canvas/slide-renderer';
import { clearImageCacheForTests } from '../../../src/view/canvas/image-cache';
import { MemSlidesStore } from '../../../src/store/memory';
import type { Element } from '../../../src/model/element';

const THEME: Theme = {
  id: 't', name: 't',
  colors: {
    text: '#000', background: '#fff', textSecondary: '#444', backgroundAlt: '#f3f3f3',
    accent1: '#abc', accent2: '#bcd', accent3: '#cde', accent4: '#def',
    accent5: '#e0e1e2', accent6: '#f0f1f2',
    hyperlink: '#11c', visitedHyperlink: '#71a',
  },
  fonts: { heading: 'Inter', body: 'Inter' },
};

const DOC: SlidesDocument = {
  meta: { title: 't', themeId: 't', masterId: 'default' },
  themes: [THEME],
  masters: [DEFAULT_MASTER],
  layouts: BUILT_IN_LAYOUTS,
  slides: [],
  guides: [],
};

function blankSlide(): Slide {
  return {
    id: 's1', layoutId: 'blank',
    background: { ...DEFAULT_BACKGROUND, fill: { kind: 'srgb', value: '#fff' } },
    elements: [], notes: [],
  };
}

function makeRenderer(): { renderer: SlideRenderer; ctx: ReturnType<typeof createCtxSpy> } {
  const ctx = createCtxSpy();
  const renderer = new SlideRenderer(asCtx(ctx), { hostWidth: 960, hostHeight: 540, dpr: 1 });
  return { renderer, ctx };
}

describe('SlideRenderer.render', () => {
  it('fills the background once and is a no-op on the second call when nothing is dirty', () => {
    const { renderer, ctx } = makeRenderer();
    renderer.render(blankSlide(), DOC);
    // The full-canvas background fillRect doubles as the clear step; we
    // no longer call clearRect because fillRect overwrites everything.
    expect(ctx.fillRect).toHaveBeenCalledTimes(1);

    const before = ctx.fillRect.mock.calls.length;
    renderer.render(blankSlide(), DOC);
    expect(ctx.fillRect.mock.calls.length).toBe(before); // no second paint
  });

  it('repaints after markDirty()', () => {
    const { renderer, ctx } = makeRenderer();
    renderer.render(blankSlide(), DOC);
    const before = ctx.fillRect.mock.calls.length;
    renderer.markDirty();
    renderer.render(blankSlide(), DOC);
    expect(ctx.fillRect.mock.calls.length).toBe(before + 1);
  });

  it('iterates elements in array order (z-order) — last element paints on top', () => {
    const { renderer, ctx } = makeRenderer();
    const slide: Slide = {
      ...blankSlide(),
      elements: [
        {
          id: 'a', type: 'shape',
          frame: { x: 0, y: 0, w: 50, h: 50, rotation: 0 },
          data: { kind: 'rect', fill: { kind: 'srgb', value: '#a00' } },
        },
        {
          id: 'b', type: 'shape',
          frame: { x: 0, y: 0, w: 50, h: 50, rotation: 0 },
          data: { kind: 'rect', fill: { kind: 'srgb', value: '#0a0' } },
        },
      ],
    };
    renderer.render(slide, DOC);
    // 1 fillRect for the background; rect shapes now route through the
    // path-builder dispatcher, which calls `ctx.fill(path)` per shape.
    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
    expect(ctx.fill).toHaveBeenCalledTimes(2);
  });

  it('applies a (hostWidth/SLIDE_WIDTH) scale so 1920x1080 logical maps to host pixels', () => {
    const { renderer, ctx } = makeRenderer();
    renderer.render(blankSlide(), DOC);
    // 960 / 1920 = 0.5; dpr = 1 → effective scale 0.5
    expect(ctx.scale).toHaveBeenCalledWith(0.5, 0.5);
  });

  it('respects DPR: 2x DPR doubles the scale factor', () => {
    const ctx = createCtxSpy();
    const renderer = new SlideRenderer(asCtx(ctx), { hostWidth: 960, hostHeight: 540, dpr: 2 });
    renderer.render(blankSlide(), DOC);
    expect(ctx.scale).toHaveBeenCalledWith(1.0, 1.0); // 0.5 * 2
  });

  describe('image-fill backgrounds', () => {
    // jsdom's `<img>` never auto-completes; replace `Image` with a fake
    // that flips to `complete` on the next microtask so the cache hits
    // on the second render. Mirrors the pattern in image-renderer.test.
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      complete = false;
      naturalWidth = 100;
      naturalHeight = 80;
      private _src = '';
      get src(): string { return this._src; }
      set src(value: string) {
        this._src = value;
        queueMicrotask(() => {
          this.complete = true;
          this.onload?.();
        });
      }
    }

    const flushMicrotasks = (): Promise<void> =>
      new Promise((resolve) => queueMicrotask(() => resolve()));

    beforeEach(() => {
      vi.stubGlobal('Image', FakeImage);
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      clearImageCacheForTests();
    });

    it('paints the slide background image stretched to 1920x1080', async () => {
      const { renderer, ctx } = makeRenderer();
      const slide: Slide = {
        ...blankSlide(),
        background: {
          fill: { kind: 'srgb', value: '#fff' },
          image: { src: 'bg.png' },
        },
      };
      // First render kicks off the load; image not yet complete.
      renderer.render(slide, DOC);
      expect(ctx.drawImage).not.toHaveBeenCalled();

      await flushMicrotasks();

      // markDirty was scheduled via the onAssetLoad callback; second
      // render hits the loaded cache entry and paints.
      renderer.render(slide, DOC);
      expect(ctx.drawImage).toHaveBeenCalledTimes(1);
      const [, dx, dy, dw, dh] =
        (ctx.drawImage as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(dx).toBe(0);
      expect(dy).toBe(0);
      expect(dw).toBe(SLIDE_WIDTH);
      expect(dh).toBe(SLIDE_HEIGHT);
    });

    it('inherits a master-level background image when the slide has none', async () => {
      const { renderer, ctx } = makeRenderer();
      const docWithMasterImage: SlidesDocument = {
        ...DOC,
        meta: { ...DOC.meta, masterId: 'm-with-image' },
        masters: [
          {
            ...DEFAULT_MASTER,
            id: 'm-with-image',
            background: {
              fill: { kind: 'role', role: 'background' },
              image: { src: 'master-bg.png' },
            },
          },
        ],
      };
      renderer.render(blankSlide(), docWithMasterImage);
      await flushMicrotasks();
      renderer.render(blankSlide(), docWithMasterImage);
      expect(ctx.drawImage).toHaveBeenCalledTimes(1);
    });

    it('does NOT call ctx.drawImage when neither slide nor master has an image', () => {
      const { renderer, ctx } = makeRenderer();
      renderer.render(blankSlide(), DOC);
      expect(ctx.drawImage).not.toHaveBeenCalled();
    });
  });

  it('forceRender paints even when not dirty', () => {
    const { renderer, ctx } = makeRenderer();
    renderer.render(blankSlide(), DOC);        // dirty → false
    const before = ctx.fillRect.mock.calls.length;
    renderer.forceRender(blankSlide(), DOC);
    expect(ctx.fillRect.mock.calls.length).toBe(before + 1);
  });

  it('forceRender draws a connector ghost on top with GHOST_ALPHA and resolves attached endpoints through the slide lookup', async () => {
    const { GHOST_ALPHA } = await import('../../../src/view/canvas/slide-renderer');
    const host = {
      id: 'host', type: 'shape' as const,
      frame: { x: 100, y: 100, w: 80, h: 80, rotation: 0 },
      data: { kind: 'rect' as const, fill: { kind: 'srgb' as const, value: '#abc' } },
    };
    const slide: Slide = { ...blankSlide(), elements: [host] };
    // Ghost connector whose start attaches to `host` and end is free.
    // The endpoint-drag path passes exactly this shape: the live
    // (dragged) endpoint goes on one side, the unchanged other side
    // stays as-is (here: attached). `drawConnector` must consult the
    // slide-side lookup to resolve `host`'s site, even though the
    // ghost itself is not in the slide.
    const ghostConnector = {
      id: 'ghost-c', type: 'connector' as const,
      routing: 'straight' as const,
      start: { kind: 'attached' as const, elementId: 'host', siteIndex: 0 },
      end:   { kind: 'free' as const, x: 500, y: 500 },
      arrowheads: {},
      frame: { x: 0, y: 0, w: 0, h: 0, rotation: 0 },
    };
    const { renderer, ctx } = makeRenderer();
    // Sample `globalAlpha` at the moment of `ctx.stroke()` — the
    // connector line is stroked inside the GHOST_ALPHA save/restore
    // bracket, so the alpha at stroke time is the ghost alpha.
    const alphaAtStroke: number[] = [];
    ctx.stroke.mockImplementation(() => {
      alphaAtStroke.push(ctx.globalAlpha);
    });
    renderer.forceRender(slide, DOC, [ghostConnector]);
    // The ghost connector's line strokes once.
    expect(alphaAtStroke).toContain(GHOST_ALPHA);
    // And `save`/`restore` bracket the ghost paint so the alpha
    // doesn't leak to subsequent paints on the same ctx.
    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.restore).toHaveBeenCalled();
  });

  it('resolves a role-bound background through the theme', () => {
    const { renderer, ctx } = makeRenderer();
    const slide: Slide = {
      ...blankSlide(),
      background: { fill: { kind: 'role', role: 'background' } },
    };
    renderer.render(slide, DOC);
    // The theme's `background` role is '#fff' — the canvas-level
    // fillStyle assignment should land that hex even though the
    // model-level color was a role binding.
    expect(ctx.fillStyle).toBe('#fff');
  });

  it('paints a gradient slide background via resolveFillStyle', () => {
    const { renderer, ctx } = makeRenderer();
    const slide: Slide = {
      ...blankSlide(),
      background: {
        fill: {
          kind: 'gradient',
          type: 'linear',
          angle: 0,
          stops: [
            { pos: 0, color: { kind: 'srgb', value: '#fff' } },
            { pos: 1, color: { kind: 'srgb', value: '#000' } },
          ],
        },
      },
    };
    renderer.render(slide, DOC);
    // A real gradient axis is built (createLinearGradient), not a
    // collapsed representative solid color.
    expect(ctx.createLinearGradient).toHaveBeenCalled();
    expect(typeof ctx.fillStyle).toBe('object'); // CanvasGradient stub
  });

  it('paints a solid slide background as a CSS string, no gradient call', () => {
    const { renderer, ctx } = makeRenderer();
    const slide: Slide = {
      ...blankSlide(),
      background: { fill: { kind: 'srgb', value: '#123456' } },
    };
    renderer.render(slide, DOC);
    expect(ctx.createLinearGradient).not.toHaveBeenCalled();
    expect(ctx.fillStyle).toBe('#123456');
  });

  it('lays the no-pasteboard gradient axis across the actual bitmap rect, not SLIDE_WIDTH', () => {
    // The no-pasteboard background paint runs under an identity CTM and
    // fills `fillRect(0, 0, bitmapW, bitmapH)` — DEVICE pixels. `makeRenderer`
    // uses hostWidth 960 / dpr 1 and the ctx-spy exposes no `.canvas`, so
    // `bitmapW` falls back to `hostWidth * dpr` = 960 (this mirrors how a
    // thumbnail-sized host renders in production — bitmapW there is also
    // far below the logical SLIDE_WIDTH of 1920). That 960-vs-1920 gap is
    // exactly what makes this test fail against the old `SLIDE_WIDTH`-based
    // gradient axis and pass once the axis is laid out across `bitmapW`.
    const { renderer, ctx } = makeRenderer();
    const slide: Slide = {
      ...blankSlide(),
      background: {
        fill: {
          kind: 'gradient',
          type: 'linear',
          angle: 0,
          stops: [
            { pos: 0, color: { kind: 'srgb', value: '#fff' } },
            { pos: 1, color: { kind: 'srgb', value: '#000' } },
          ],
        },
      },
    };
    renderer.render(slide, DOC);
    expect(ctx.gradientCoords.length).toBe(1);
    // angle 0 → axis spans [0, w] at the fill's local y-center — end-x
    // must land on the bitmap width (960), not SLIDE_WIDTH (1920).
    const [, , x1] = ctx.gradientCoords[0];
    expect(x1).toBe(960);
    expect(x1).not.toBe(SLIDE_WIDTH);
  });
});

function buildDoc() {
  const store = new MemSlidesStore();
  let elementId = '';
  store.batch(() => {
    const sid = store.addSlide('blank');
    elementId = store.addElement(sid, {
      type: 'shape',
      frame: { x: 100, y: 100, w: 200, h: 100, rotation: 0 },
      data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
    });
  });
  const doc = store.read();
  const slide = doc.slides[0];
  return { doc, slide, elementId };
}

function makeGhost(id: string, x: number): Element {
  return {
    id,
    type: 'shape',
    frame: { x, y: 100, w: 100, h: 100, rotation: 0 },
    data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
  } as Element;
}

describe('drawSlide ghosts', () => {
  it('paints each ghost with globalAlpha set to GHOST_ALPHA', () => {
    const { doc, slide } = buildDoc();
    const opts = { hostWidth: SLIDE_WIDTH, hostHeight: SLIDE_HEIGHT, dpr: 1 };

    const spy = createCtxSpy();
    // Observe every write to globalAlpha. The ghost band sets it to
    // GHOST_ALPHA between save() and restore(); the rest of the render
    // either never writes it or writes 1.
    const alphaWrites: number[] = [];
    let alpha = spy.globalAlpha;
    Object.defineProperty(spy, 'globalAlpha', {
      configurable: true,
      get() { return alpha; },
      set(v: number) { alpha = v; alphaWrites.push(v); },
    });

    drawSlide(
      asCtx(spy),
      slide,
      doc,
      opts,
      () => undefined,
      [makeGhost('g1', 300), makeGhost('g2', 600)],
    );

    // Both ghosts must have been painted at GHOST_ALPHA.
    const ghostAlphaWrites = alphaWrites.filter((a) => a === GHOST_ALPHA);
    expect(ghostAlphaWrites.length).toBe(2);
  });

  it('omitting ghosts equals an empty array', () => {
    const { doc, slide } = buildDoc();
    const opts = { hostWidth: SLIDE_WIDTH, hostHeight: SLIDE_HEIGHT, dpr: 1 };

    const omitted = createCtxSpy();
    const empty = createCtxSpy();
    drawSlide(asCtx(omitted), slide, doc, opts);
    drawSlide(asCtx(empty), slide, doc, opts, () => undefined, []);

    expect(omitted.save.mock.calls.length).toBe(empty.save.mock.calls.length);
    expect(omitted.restore.mock.calls.length).toBe(empty.restore.mock.calls.length);
  });
});

describe('drawSlide — grouped connector', () => {
  it('undoes the group transform before painting an attached connector child so the world-coord contract holds', () => {
    // Two rects + an attached connector between them on the slide root.
    // After grouping all three, the connector becomes a group child but
    // still resolves its endpoints via the slide-world lookup
    // (`buildElementWorldLookup` lifts grouped frames to world). The
    // ctx is in the group's transformed space at the moment we recurse
    // into the connector child, so the renderer must apply the inverse
    // before calling drawConnector — otherwise the line drifts by the
    // group's translation.
    const store = new MemSlidesStore();
    let sid = '';
    let a = '', b = '', c = '';
    store.batch(() => { sid = store.addSlide('blank', 0); });
    store.batch(() => {
      a = store.addElement(sid, {
        type: 'shape',
        frame: { x: 100, y: 200, w: 80, h: 60, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#a00' } },
      });
      b = store.addElement(sid, {
        type: 'shape',
        frame: { x: 600, y: 500, w: 80, h: 60, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#0a0' } },
      });
      c = store.addElement(sid, {
        type: 'connector',
        routing: 'straight',
        start: { kind: 'attached', elementId: a, siteIndex: 0 },
        end:   { kind: 'attached', elementId: b, siteIndex: 0 },
        arrowheads: {},
        frame: { x: 0, y: 0, w: 0, h: 0, rotation: 0 },
      });
    });

    const opts = { hostWidth: SLIDE_WIDTH, hostHeight: SLIDE_HEIGHT, dpr: 1 };

    // Pre-group baseline: connector is at slide root, no group ancestor.
    // drawElement's connector early-return takes the identity-parent
    // branch and never calls ctx.transform.
    const pre = createCtxSpy();
    drawSlide(asCtx(pre), store.read().slides[0], store.read(), opts);
    expect(pre.transform).not.toHaveBeenCalled();

    // Group all three. The connector joins the group's children (both
    // endpoints internal → see store/memory.ts partition).
    store.batch(() => { store.group(sid, [a, b, c]); });
    const grouped = store.read().slides[0].elements[0];
    expect(grouped.type).toBe('group');
    const groupFrame = grouped.frame;

    // Post-group: rendering the grouped connector applies the inverse
    // of the group's transform via `ctx.transform`. With no rotation
    // and `refSize == frame.w/h`, the group's matrix is just
    // translate(x, y); the inverse is translate(-x, -y).
    // `expect.closeTo(0)` absorbs the `-0` that `-t.b / det` produces
    // for the b/c slots when t.b / t.c are zero.
    const post = createCtxSpy();
    drawSlide(asCtx(post), store.read().slides[0], store.read(), opts);
    expect(post.transform).toHaveBeenCalledWith(
      1,
      expect.closeTo(0),
      expect.closeTo(0),
      1,
      -groupFrame.x,
      -groupFrame.y,
    );

    // The save/transform/restore bracket sits around drawConnector, so
    // a save lands before moveTo and a restore lands after stroke.
    const transformOrder = post.transform.mock.invocationCallOrder[0];
    const moveToOrder = post.moveTo.mock.invocationCallOrder[0];
    expect(transformOrder).toBeLessThan(moveToOrder);
  });

  it('draws a grouped free-endpoint connector at the same world coords as before grouping', () => {
    // Two shapes + a connector with both endpoints `free` (not attached
    // to either shape). store.group() normalises the free endpoint
    // coords to group-local, and `buildElementWorldLookup` re-lifts
    // them. The renderer must consult the lookup version so free
    // endpoints — like attached ones — paint at slide-world coords.
    const store = new MemSlidesStore();
    let sid = '';
    let a = '', b = '', c = '';
    store.batch(() => { sid = store.addSlide('blank', 0); });
    store.batch(() => {
      a = store.addElement(sid, {
        type: 'shape',
        frame: { x: 100, y: 200, w: 80, h: 60, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#a00' } },
      });
      b = store.addElement(sid, {
        type: 'shape',
        frame: { x: 600, y: 500, w: 80, h: 60, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#0a0' } },
      });
      c = store.addElement(sid, {
        type: 'connector',
        routing: 'straight',
        start: { kind: 'free', x: 200, y: 250 },
        end:   { kind: 'free', x: 600, y: 550 },
        arrowheads: {},
        frame: { x: 0, y: 0, w: 0, h: 0, rotation: 0 },
      });
    });

    const opts = { hostWidth: SLIDE_WIDTH, hostHeight: SLIDE_HEIGHT, dpr: 1 };

    const pre = createCtxSpy();
    drawSlide(asCtx(pre), store.read().slides[0], store.read(), opts);
    const preStart = pre.moveTo.mock.calls[0] as [number, number];
    const preEnd = pre.lineTo.mock.calls[pre.lineTo.mock.calls.length - 1] as [number, number];

    store.batch(() => { store.group(sid, [a, b, c]); });

    const post = createCtxSpy();
    drawSlide(asCtx(post), store.read().slides[0], store.read(), opts);
    const postStart = post.moveTo.mock.calls[0] as [number, number];
    const postEnd = post.lineTo.mock.calls[post.lineTo.mock.calls.length - 1] as [number, number];

    // The raw arguments to moveTo / lineTo should be the same world
    // coords; the ctx transform stack inside drawElement absorbs the
    // group transform via the inverse save/restore band.
    expect(postStart[0]).toBeCloseTo(preStart[0], 6);
    expect(postStart[1]).toBeCloseTo(preStart[1], 6);
    expect(postEnd[0]).toBeCloseTo(preEnd[0], 6);
    expect(postEnd[1]).toBeCloseTo(preEnd[1], 6);
  });

  it('skips a grouped connector when its parent transform is singular and keeps painting the rest of the slide', () => {
    // Hand-roll a slide with a zero-width group so the connector
    // branch hits a singular parentTransform — store.group() clamps
    // groups to MIN_GROUP_DIM = 1, but a degenerate PPTX import or
    // external mutation can still leak w=0 or h=0 with refSize > 0.
    // Pre-fix this threw out of invertGroupTransform; the throw
    // escaped drawElement's try/finally and aborted drawSlide's
    // element loop, blanking every subsequent element. Now the
    // connector is silently skipped and the rest of the slide
    // continues to paint.
    const a: Element = {
      id: 'sing-a', type: 'shape',
      frame: { x: 0, y: 0, w: 50, h: 50, rotation: 0 },
      data: { kind: 'rect', fill: { kind: 'srgb', value: '#a00' } },
    };
    const b: Element = {
      id: 'sing-b', type: 'shape',
      frame: { x: 100, y: 0, w: 50, h: 50, rotation: 0 },
      data: { kind: 'rect', fill: { kind: 'srgb', value: '#0a0' } },
    };
    const c: Element = {
      id: 'sing-c', type: 'connector',
      routing: 'straight',
      start: { kind: 'attached', elementId: 'sing-a', siteIndex: 0 },
      end:   { kind: 'attached', elementId: 'sing-b', siteIndex: 0 },
      arrowheads: {},
      frame: { x: 0, y: 0, w: 0, h: 0, rotation: 0 },
    };
    const group: Element = {
      id: 'sing-g', type: 'group',
      // w = 0 with refSize.w > 0 forces scaleX = 0 → det = 0 in the
      // composed parent transform inside the connector child branch.
      frame: { x: 50, y: 50, w: 0, h: 50, rotation: 0 },
      data: { children: [a, b, c], refSize: { w: 200, h: 100 } },
    };
    const trailing: Element = {
      id: 'sing-trailing', type: 'shape',
      frame: { x: 500, y: 500, w: 50, h: 50, rotation: 0 },
      data: { kind: 'rect', fill: { kind: 'srgb', value: '#0aa' } },
    };

    const slide: Slide = {
      id: 'sing-slide', layoutId: 'blank',
      background: { ...DEFAULT_BACKGROUND, fill: { kind: 'srgb', value: '#fff' } },
      elements: [group, trailing], notes: [],
    };

    const ctx = createCtxSpy();
    const opts = { hostWidth: SLIDE_WIDTH, hostHeight: SLIDE_HEIGHT, dpr: 1 };

    expect(() => drawSlide(asCtx(ctx), slide, DOC, opts)).not.toThrow();

    // Trailing shape sits after the broken group in slide.elements.
    // Pre-fix, the connector's throw would short-circuit drawSlide's
    // for-loop before the trailing rect's `ctx.fill` ever fired. The
    // group's child rects (a, b) also call `ctx.fill` even under a
    // zero-scale ctx transform, so the easiest tell is the call count:
    // a + b + trailing = 3 fills with the fix, 2 without.
    expect(ctx.fill.mock.calls.length).toBeGreaterThanOrEqual(3);

    // The connector itself must NOT have emitted any path commands —
    // drawConnector is the only caller of `ctx.moveTo`/`ctx.lineTo`
    // in this fixture, so zero calls confirms the singular branch
    // dropped the paint.
    expect(ctx.moveTo).not.toHaveBeenCalled();
    expect(ctx.lineTo).not.toHaveBeenCalled();
  });
});

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
    renderer.forceRender(slide, DOC, ghostConnector);
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

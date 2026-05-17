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
import { SlideRenderer } from '../../../src/view/canvas/slide-renderer';
import { clearImageCacheForTests } from '../../../src/view/canvas/image-cache';

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

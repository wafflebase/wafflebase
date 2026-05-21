import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import type { Slide, SlidesDocument } from '../../../src/model/presentation';
import { DEFAULT_BACKGROUND } from '../../../src/model/presentation';
import type { Theme } from '../../../src/model/theme';
import { DEFAULT_MASTER } from '../../../src/model/master';
import { BUILT_IN_LAYOUTS } from '../../../src/model/layout';
import { asCtx, createCtxSpy } from '../../../src/view/canvas/ctx-spy';
import { clearImageCacheForTests } from '../../../src/view/canvas/image-cache';
import { ThumbnailScheduler, renderThumbnail } from '../../../src/view/canvas/thumbnail';

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

const blankSlide = (id: string): Slide => ({
  id, layoutId: 'blank',
  background: { ...DEFAULT_BACKGROUND, fill: { kind: 'srgb' as const, value: '#fff' } },
  elements: [], notes: [],
});

describe('renderThumbnail', () => {
  it('paints the slide at the requested host size', () => {
    const ctx = createCtxSpy();
    renderThumbnail(asCtx(ctx), blankSlide('s1'), DOC, { hostWidth: 192, hostHeight: 108, dpr: 1 });
    expect(ctx.fillRect).toHaveBeenCalled();
    // Scale = 192 / 1920 = 0.1
    expect(ctx.scale).toHaveBeenCalledWith(0.1, 0.1);
  });

  // Mirrors the FakeImage pattern from slide-renderer.test.ts. The
  // global `Image` constructor in jsdom never auto-completes, so the
  // image cache would otherwise stay pending forever. This fake flips
  // to `complete` on the next microtask and fires `onload`, which is
  // exactly the event the `onAssetLoad` callback chain rides on.
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

  describe('async image background', () => {
    beforeEach(() => { vi.stubGlobal('Image', FakeImage); });
    afterEach(() => { vi.unstubAllGlobals(); clearImageCacheForTests(); });

    it('invokes onAssetLoad once a pending background image finishes loading', async () => {
      const ctx = createCtxSpy();
      const slide: Slide = {
        ...blankSlide('s1'),
        background: {
          fill: { kind: 'srgb', value: '#fff' },
          image: { src: 'thumb-bg.png' },
        },
      };
      const onAssetLoad = vi.fn();
      // First paint: image-cache still loading → drawImage is a no-op,
      // onAssetLoad subscribed to the pending callback set.
      renderThumbnail(
        asCtx(ctx),
        slide,
        DOC,
        { hostWidth: 192, hostHeight: 108, dpr: 1 },
        onAssetLoad,
      );
      expect(ctx.drawImage).not.toHaveBeenCalled();
      expect(onAssetLoad).not.toHaveBeenCalled();

      await flushMicrotasks();

      // Image load fired → onAssetLoad invoked. Caller (the panel)
      // will use this to schedule a repaint via ThumbnailScheduler.
      expect(onAssetLoad).toHaveBeenCalledTimes(1);

      // Second paint after the cache hit actually draws the image.
      renderThumbnail(
        asCtx(ctx),
        slide,
        DOC,
        { hostWidth: 192, hostHeight: 108, dpr: 1 },
        onAssetLoad,
      );
      expect(ctx.drawImage).toHaveBeenCalledTimes(1);
    });
  });
});

describe('ThumbnailScheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());


  it('coalesces multiple schedule() calls into one render after the debounce window', () => {
    const onFlush = vi.fn();
    const scheduler = new ThumbnailScheduler(200, onFlush);
    scheduler.schedule('s1');
    scheduler.schedule('s1');
    scheduler.schedule('s1');
    expect(onFlush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(199);
    expect(onFlush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith(['s1']);
  });

  it('batches different slide ids into a single flush', () => {
    const onFlush = vi.fn();
    const scheduler = new ThumbnailScheduler(200, onFlush);
    scheduler.schedule('s1');
    scheduler.schedule('s2');
    scheduler.schedule('s1');
    vi.advanceTimersByTime(200);
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush.mock.calls[0][0].sort()).toEqual(['s1', 's2']);
  });

  it('a fresh schedule after a flush starts a new debounce window', () => {
    const onFlush = vi.fn();
    const scheduler = new ThumbnailScheduler(200, onFlush);
    scheduler.schedule('s1');
    vi.advanceTimersByTime(200);
    expect(onFlush).toHaveBeenCalledTimes(1);
    scheduler.schedule('s2');
    vi.advanceTimersByTime(200);
    expect(onFlush).toHaveBeenCalledTimes(2);
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '../../../src/view/canvas/test-canvas-env';
import { MemSlidesStore } from '../../../src/store/memory';
import { initialize, type SlidesEditor } from '../../../src/view/editor/editor';
import { SlideRenderer } from '../../../src/view/canvas/slide-renderer';

// Mock clearMeasureCache so the spy survives jsdom's lack of a real
// Canvas 2D measureText pipeline (which would otherwise short-circuit
// the cache without our import path executing). Spreading `...actual`
// keeps every other docs export pointing at the real module so the
// editor's other imports — `DEFAULT_BLOCK_STYLE`, `Block`, etc. —
// behave exactly as in production.
vi.mock('@wafflebase/docs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wafflebase/docs')>();
  return {
    ...actual,
    clearMeasureCache: vi.fn(actual.clearMeasureCache),
  };
});

import { clearMeasureCache } from '@wafflebase/docs';

function makeFixture() {
  const canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 540;
  const overlay = document.createElement('div');
  overlay.style.position = 'absolute';
  document.body.appendChild(canvas);
  document.body.appendChild(overlay);
  const store = new MemSlidesStore();
  store.batch(() => store.addSlide('blank'));
  return { canvas, overlay, store };
}

describe('SlidesEditor font-load cache invalidation', () => {
  let editor: SlidesEditor | null = null;
  let originalFonts: PropertyDescriptor | undefined;

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    // jsdom omits `document.fonts`. Install a stub `EventTarget` so
    // the editor's listener wiring exercises the same `addEventListener`
    // path it uses in the browser.
    originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
    Object.defineProperty(document, 'fonts', {
      value: new EventTarget(),
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    if (editor) {
      editor.detach();
      editor = null;
    }
    if (originalFonts) {
      Object.defineProperty(document, 'fonts', originalFonts);
    } else {
      // We installed a stub where none existed; drop it.
      // @ts-expect-error — removing a configurable property we installed.
      delete document.fonts;
    }
  });

  it('clears the measure cache, marks the renderer dirty, and fires onFontsLoaded when fonts finish', () => {
    const { canvas, overlay, store } = makeFixture();
    const markDirtySpy = vi.spyOn(SlideRenderer.prototype, 'markDirty');
    const onFontsLoaded = vi.fn();
    editor = initialize({
      canvas,
      overlay,
      store,
      hostWidth: 960,
      hostHeight: 540,
      dpr: 1,
      onFontsLoaded,
    });
    // The mount + initial render path may call markDirty incidentally
    // (selection seeding, overlay paint); reset so the assertion below
    // measures the font-load handler alone.
    markDirtySpy.mockClear();
    (clearMeasureCache as ReturnType<typeof vi.fn>).mockClear();

    document.fonts.dispatchEvent(new Event('loadingdone'));

    expect(clearMeasureCache).toHaveBeenCalledTimes(1);
    expect(markDirtySpy).toHaveBeenCalledTimes(1);
    expect(onFontsLoaded).toHaveBeenCalledTimes(1);
  });

  it('removes the font-load listener on detach', () => {
    const { canvas, overlay, store } = makeFixture();
    const onFontsLoaded = vi.fn();
    editor = initialize({
      canvas,
      overlay,
      store,
      hostWidth: 960,
      hostHeight: 540,
      dpr: 1,
      onFontsLoaded,
    });
    editor.detach();
    editor = null;
    (clearMeasureCache as ReturnType<typeof vi.fn>).mockClear();

    document.fonts.dispatchEvent(new Event('loadingdone'));

    expect(clearMeasureCache).not.toHaveBeenCalled();
    expect(onFontsLoaded).not.toHaveBeenCalled();
  });

  it('registers the listener on read-only mounts as well', () => {
    const { canvas, overlay, store } = makeFixture();
    const onFontsLoaded = vi.fn();
    editor = initialize({
      canvas,
      overlay,
      store,
      hostWidth: 960,
      hostHeight: 540,
      dpr: 1,
      readOnly: true,
      onFontsLoaded,
    });

    document.fonts.dispatchEvent(new Event('loadingdone'));

    // Share-link viewers see the same stale-cache gap; the listener
    // must fire even though attachInteractions is skipped.
    expect(onFontsLoaded).toHaveBeenCalledTimes(1);
  });
});

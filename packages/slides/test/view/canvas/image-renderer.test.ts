// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import type { ImageElement } from '../../../src/model/element';
import { asCtx, createCtxSpy } from '../../../src/view/canvas/ctx-spy';
import { drawImage } from '../../../src/view/canvas/image-renderer';
import { clearImageCacheForTests } from '../../../src/view/canvas/image-cache';

// jsdom's `<img>` never fires `onload` for a real network URL in the
// test environment, so we replace the global `Image` constructor with
// a fake that auto-completes on the next microtask. Tests can then
// `await` a microtask, drop back to drawImage, and observe the
// painted-path call to `ctx.drawImage`.
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

beforeEach(() => {
  vi.stubGlobal('Image', FakeImage);
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearImageCacheForTests();
});

const size = { w: 200, h: 100 };
const data = (overrides: Partial<ImageElement['data']> = {}): ImageElement['data'] => ({
  src: 'https://example.com/a.png',
  ...overrides,
});

const flushMicrotasks = (): Promise<void> =>
  new Promise((resolve) => queueMicrotask(() => resolve()));

describe('drawImage', () => {
  it('returns false and skips drawImage on first call (cache miss kicks off load)', () => {
    const ctx = createCtxSpy();
    const drawn = drawImage(asCtx(ctx), size, data(), () => undefined);
    expect(drawn).toBe(false);
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it('draws the image at (0,0,size.w,size.h) once it is loaded', async () => {
    const ctx = createCtxSpy();
    const onLoad = vi.fn();

    // First call schedules the load; the cache entry's onload fires on
    // the next microtask thanks to the FakeImage stub.
    drawImage(asCtx(ctx), size, data(), onLoad);
    await flushMicrotasks();
    expect(onLoad).toHaveBeenCalledTimes(1);

    // Second call should now hit the loaded entry and paint.
    const drawn = drawImage(asCtx(ctx), size, data(), () => undefined);
    expect(drawn).toBe(true);
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
    // Uncropped 4-arg form: image, dx, dy, dw, dh.
    const [img, dx, dy, dw, dh] = (ctx.drawImage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(img).toBeInstanceOf(FakeImage);
    expect(dx).toBe(0);
    expect(dy).toBe(0);
    expect(dw).toBe(200);
    expect(dh).toBe(100);
  });

  it('paints a failure placeholder (with alt) when the image errors', async () => {
    // Make the FakeImage fail on load instead of succeeding. We override
    // the auto-complete behaviour by replacing src setter to fire onerror.
    class FailingImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      complete = false;
      naturalWidth = 0;
      naturalHeight = 0;
      private _src = '';
      get src(): string { return this._src; }
      set src(value: string) {
        this._src = value;
        queueMicrotask(() => {
          this.complete = true;
          this.onerror?.();
        });
      }
    }
    vi.stubGlobal('Image', FailingImage);

    const ctx = createCtxSpy();
    const onLoad = vi.fn();
    drawImage(asCtx(ctx), size, data({ alt: 'cat photo' }), onLoad);
    await flushMicrotasks();
    // onLoad fires on failure too so the renderer repaints with the
    // placeholder rather than leaving a stale blank rect.
    expect(onLoad).toHaveBeenCalledTimes(1);

    const drawn = drawImage(asCtx(ctx), size, data({ alt: 'cat photo' }), () => undefined);
    expect(drawn).toBe(true);
    // Placeholder uses fillRect for the body and strokeRect for the
    // dashed border. ctx.drawImage MUST NOT have been called.
    expect(ctx.drawImage).not.toHaveBeenCalled();
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 200, 100);
    expect(ctx.strokeRect).toHaveBeenCalled();
    // Alt text + the hint header are both painted.
    const fillTextCalls = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(fillTextCalls).toContain('Image unavailable');
    expect(fillTextCalls).toContain('cat photo');
  });

  it('passes the crop rectangle (in source pixels) to ctx.drawImage', async () => {
    const ctx = createCtxSpy();
    drawImage(asCtx(ctx), size, data(), () => undefined);
    await flushMicrotasks();

    // Now paint with a crop. naturalWidth=100, naturalHeight=80 from
    // the FakeImage stub, so a (0.1, 0.1, 0.8, 0.8) crop translates to
    // source rect (10, 8, 80, 64).
    drawImage(asCtx(ctx), size, data({
      crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
      alt: 'demo',
    }), () => undefined);
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
    // 9-arg form: image, sx, sy, sw, sh, dx, dy, dw, dh.
    const args = (ctx.drawImage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(args[1]).toBe(10);   // sx
    expect(args[2]).toBe(8);    // sy
    expect(args[3]).toBe(80);   // sw
    expect(args[4]).toBe(64);   // sh
    expect(args[5]).toBe(0);    // dx
    expect(args[6]).toBe(0);    // dy
    expect(args[7]).toBe(200);  // dw
    expect(args[8]).toBe(100);  // dh
  });
});

import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  captureFromContainer,
  captureThumbnail,
  encodeThumbnail,
  hasThumbnailSource,
  registerThumbnailSource,
} from './thumbnail-capture';

/**
 * jsdom has no 2D context and no `toBlob`. Every test that needs pixels stubs
 * the canvas rather than pretending jsdom can paint — what is under test here
 * is the registry's lifecycle and the graceful-degradation contract, not the
 * rasterizer.
 */
function fakeCanvas(
  width: number,
  height: number,
  opts: {
    blob?: Blob | null;
    toBlobThrows?: boolean;
    context?: Partial<CanvasRenderingContext2D> | null;
    /** Where this canvas sits on screen; defaults to the origin. */
    rect?: { left: number; top: number };
  } = {},
): HTMLCanvasElement {
  const ctx =
    opts.context === null
      ? null
      : ({
          fillRect: vi.fn(),
          drawImage: vi.fn(),
          scale: vi.fn(),
          fillStyle: '',
          ...opts.context,
        } as unknown as CanvasRenderingContext2D);
  return {
    width,
    height,
    getContext: () => ctx,
    getBoundingClientRect: () => {
      const left = opts.rect?.left ?? 0;
      const top = opts.rect?.top ?? 0;
      return {
        left,
        top,
        width,
        height,
        right: left + width,
        bottom: top + height,
      };
    },
    toBlob: (cb: BlobCallback) => {
      if (opts.toBlobThrows) throw new Error('SecurityError');
      cb(opts.blob === undefined ? new Blob(['x']) : opts.blob);
    },
  } as unknown as HTMLCanvasElement;
}

/** Make `document.createElement("canvas")` hand back `canvas`. */
function stubCreatedCanvas(canvas: HTMLCanvasElement) {
  const real = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
    tag === 'canvas' ? canvas : real(tag)) as typeof document.createElement);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('registerThumbnailSource', () => {
  it('captures through the registered source', async () => {
    stubCreatedCanvas(fakeCanvas(64, 48));
    registerThumbnailSource('doc-1', () => fakeCanvas(640, 480));
    expect(hasThumbnailSource('doc-1')).toBe(true);
    expect(await captureThumbnail('doc-1')).toBeInstanceOf(Blob);
  });

  it('captures nothing for a document with no source', async () => {
    expect(hasThumbnailSource('doc-absent')).toBe(false);
    expect(await captureThumbnail('doc-absent')).toBeNull();
  });

  it('deregistration removes the source', () => {
    const off = registerThumbnailSource('doc-2', () => null);
    off();
    expect(hasThumbnailSource('doc-2')).toBe(false);
  });

  it('a stale deregistration does not remove its replacement', () => {
    // React registers the new effect before running the old one's cleanup, so
    // an unconditional delete would leave a mounted editor unreachable.
    const offFirst = registerThumbnailSource('doc-3', () => null);
    registerThumbnailSource('doc-3', () => fakeCanvas(10, 10));
    offFirst();
    expect(hasThumbnailSource('doc-3')).toBe(true);
  });

  it('a throwing source degrades to no thumbnail', async () => {
    registerThumbnailSource('doc-4', () => {
      throw new Error('editor is mid-teardown');
    });
    expect(await captureThumbnail('doc-4')).toBeNull();
  });

  it('awaits an async source', async () => {
    stubCreatedCanvas(fakeCanvas(64, 48));
    registerThumbnailSource('doc-5', () =>
      Promise.resolve(fakeCanvas(640, 480)),
    );
    expect(await captureThumbnail('doc-5')).toBeInstanceOf(Blob);
  });
});

describe('encodeThumbnail', () => {
  it('bounds the longest edge at 1280 and keeps the aspect ratio', async () => {
    const target = fakeCanvas(0, 0);
    stubCreatedCanvas(target);
    await encodeThumbnail(fakeCanvas(1920, 1080));
    expect(target.width).toBe(1280);
    expect(target.height).toBe(720);
  });

  it('bounds a portrait canvas by its height', async () => {
    const target = fakeCanvas(0, 0);
    stubCreatedCanvas(target);
    await encodeThumbnail(fakeCanvas(800, 1600));
    expect(target.height).toBe(1280);
    expect(target.width).toBe(640);
  });

  it('never upscales a small canvas', async () => {
    const target = fakeCanvas(0, 0);
    stubCreatedCanvas(target);
    await encodeThumbnail(fakeCanvas(200, 100));
    expect(target.width).toBe(200);
    expect(target.height).toBe(100);
  });

  it('returns null for an empty canvas', async () => {
    expect(await encodeThumbnail(fakeCanvas(0, 0))).toBeNull();
  });

  it('returns null when the canvas is tainted', async () => {
    // A document holding a remote image poisons `toBlob`. The card falls back
    // to its type icon rather than the publish failing.
    stubCreatedCanvas(fakeCanvas(64, 48, { toBlobThrows: true }));
    expect(await encodeThumbnail(fakeCanvas(640, 480))).toBeNull();
  });

  it('falls back to PNG when WebP encoding is unsupported', async () => {
    const png = new Blob(['png']);
    let call = 0;
    const target = fakeCanvas(64, 48);
    (target as unknown as { toBlob: unknown }).toBlob = (
      cb: BlobCallback,
      type: string,
    ) => {
      call += 1;
      cb(type === 'image/webp' ? null : png);
    };
    stubCreatedCanvas(target);

    expect(await encodeThumbnail(fakeCanvas(640, 480))).toBe(png);
    expect(call).toBe(2);
  });
});

describe('captureFromContainer', () => {
  /** A container whose canvases are `canvases`, with a paintable background. */
  function makeContainer(canvases: HTMLCanvasElement[]): HTMLElement {
    const el = {
      querySelectorAll: () => canvases,
      parentElement: null,
    } as unknown as HTMLElement;
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      backgroundColor: 'rgb(20, 20, 20)',
    } as unknown as CSSStyleDeclaration);
    return el;
  }

  it('returns null without a container', () => {
    expect(captureFromContainer(null)).toBeNull();
  });

  it('skips chrome-sized canvases and composites the rest', () => {
    const out = fakeCanvas(0, 0);
    const ctx = out.getContext('2d')!;
    const grid = fakeCanvas(800, 600, { rect: { left: 0, top: 20 } });
    const ruler = fakeCanvas(800, 20, { rect: { left: 0, top: 0 } });
    stubCreatedCanvas(out);

    expect(captureFromContainer(makeContainer([ruler, grid]))).toBe(out);
    // The ruler is 20px on its short axis, so only the grid is drawn.
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
  });

  it('composites at device pixels so a retina capture keeps its resolution', () => {
    // The rect is CSS pixels while the editor's bitmap is `dpr` times that.
    // Sizing the output to the rect resampled the capture to 1x before it was
    // even downscaled.
    const out = fakeCanvas(0, 0, { context: { scale: vi.fn() } });
    const ctx = out.getContext('2d')!;
    vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(2);
    stubCreatedCanvas(out);

    captureFromContainer(makeContainer([fakeCanvas(800, 600)]));
    expect(out.width).toBe(1600);
    expect(out.height).toBe(1200);
    expect(ctx.scale).toHaveBeenCalledWith(2, 2);
    // Draws stay in CSS coordinates; the transform does the scaling.
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 800, 600);
  });

  it('caps the capture ratio so a 3x display does not quadruple the work', () => {
    const out = fakeCanvas(0, 0, { context: { scale: vi.fn() } });
    vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(3);
    stubCreatedCanvas(out);

    captureFromContainer(makeContainer([fakeCanvas(800, 600)]));
    expect(out.width).toBe(1600);
  });

  it('crops to what was drawn, not to the container', () => {
    // The regression: the docs ruler takes 20px of the container's flow before
    // the page canvas starts. Cropping to the container left that strip
    // unpainted — a white band across the top of every dark-mode card.
    const out = fakeCanvas(0, 0);
    const ctx = out.getContext('2d')!;
    const grid = fakeCanvas(800, 600, { rect: { left: 0, top: 20 } });
    const ruler = fakeCanvas(800, 20, { rect: { left: 0, top: 0 } });
    stubCreatedCanvas(out);

    captureFromContainer(makeContainer([ruler, grid]));
    expect(out.width).toBe(800);
    expect(out.height).toBe(600);
    // Drawn at the crop's own origin, so nothing is offset by the ruler.
    expect(ctx.drawImage).toHaveBeenCalledWith(grid, 0, 0, 800, 600);
  });

  it('paints the resolved background under the layers, not white', () => {
    // A selection overlay is almost entirely transparent, and in dark mode a
    // white backdrop showed through it.
    const out = fakeCanvas(0, 0);
    const ctx = out.getContext('2d')!;
    stubCreatedCanvas(out);
    captureFromContainer(makeContainer([fakeCanvas(800, 600)]));
    expect(ctx.fillStyle).toBe('rgb(20, 20, 20)');
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 800, 600);
  });

  it('returns null when every canvas is chrome', () => {
    stubCreatedCanvas(fakeCanvas(0, 0));
    expect(
      captureFromContainer(makeContainer([fakeCanvas(800, 20)])),
    ).toBeNull();
  });

  it('returns null for a container with no canvases', () => {
    expect(captureFromContainer(makeContainer([]))).toBeNull();
  });
});

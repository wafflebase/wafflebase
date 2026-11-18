// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Slide, SlidesDocument } from '../../src/model/presentation';
import { DEFAULT_BACKGROUND } from '../../src/model/presentation';
import type { Element } from '../../src/model/element';
import type { Theme } from '../../src/model/theme';
import { DEFAULT_MASTER } from '../../src/model/master';
import { BUILT_IN_LAYOUTS } from '../../src/model/layout';
import { clearImageCacheForTests } from '../../src/view/canvas/image-cache';

// A genuinely valid 1×1 PNG so pdf-lib's `embedPng` (which parses the
// PNG header) accepts the bytes our stubbed canvas "encodes".
const PNG_1x1_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=';
function png1x1(): Uint8Array {
  const bin = atob(PNG_1x1_B64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// `.buffer as ArrayBuffer` sidesteps the TS 5.7 `Uint8Array<ArrayBufferLike>`
// vs `BlobPart` mismatch under the slides tsconfig (test-only).
function pngBlob(): Blob {
  return new Blob([png1x1().buffer as ArrayBuffer], { type: 'image/png' });
}

// A Proxy-backed 2D context: every method is a no-op, every property is
// settable, and `measureText` returns a deterministic width. This keeps
// `drawSlide` (and the transitive text measurer) happy without a real
// canvas, which jsdom doesn't provide.
function makeCtx(): unknown {
  const noop = (): void => {};
  const state: Record<string, unknown> = {
    measureText: (t: string) => ({ width: t.length * 8 }),
  };
  return new Proxy(state, {
    get(target, prop: string) {
      return prop in target ? target[prop] : noop;
    },
    set(target, prop: string, value) {
      target[prop] = value;
      return true;
    },
  });
}

class TestOffscreenCanvas {
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext(type: string): unknown {
    return type === '2d' ? makeCtx() : null;
  }
  convertToBlob(): Promise<Blob> {
    // jsdom's Blob lacks `arrayBuffer()` (real browsers' OffscreenCanvas
    // blobs have it), so hand back a minimal blob-like with the bytes.
    const bytes = png1x1();
    return Promise.resolve({
      type: 'image/png',
      size: bytes.length,
      arrayBuffer: async () => bytes.buffer.slice(0),
    } as unknown as Blob);
  }
}

// jsdom's global `Image` never auto-completes, so the shared image cache
// would stay pending forever. This flips to `complete` on the next
// microtask and fires `onload`, matching the real load event.
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  complete = false;
  naturalWidth = 100;
  naturalHeight = 80;
  private _src = '';
  get src(): string {
    return this._src;
  }
  set src(value: string) {
    this._src = value;
    queueMicrotask(() => {
      this.complete = true;
      this.onload?.();
    });
  }
}

const THEME: Theme = {
  id: 't',
  name: 't',
  colors: {
    text: '#000',
    background: '#fff',
    textSecondary: '#444',
    backgroundAlt: '#f3f3f3',
    accent1: '#abc',
    accent2: '#bcd',
    accent3: '#cde',
    accent4: '#def',
    accent5: '#e0e1e2',
    accent6: '#f0f1f2',
    hyperlink: '#11c',
    visitedHyperlink: '#71a',
  },
  fonts: { heading: 'Lora', body: 'Inter' },
};

const baseDoc = (slides: Slide[]): SlidesDocument => ({
  meta: { title: 'Deck', themeId: 't', masterId: 'default' },
  themes: [THEME],
  masters: [DEFAULT_MASTER],
  layouts: BUILT_IN_LAYOUTS,
  slides,
  guides: [],
});

const blankSlide = (id: string): Slide => ({
  id,
  layoutId: 'blank',
  background: { ...DEFAULT_BACKGROUND, fill: { kind: 'srgb', value: '#fff' } },
  elements: [],
  notes: [],
});

const imageElement = (id: string, src: string): Element => ({
  id,
  type: 'image',
  frame: { x: 100, y: 100, w: 400, h: 300, rotation: 0 },
  data: { src },
});


let objUrlCounter = 0;
const origCreate = globalThis.URL.createObjectURL;
const origRevoke = globalThis.URL.revokeObjectURL;

beforeEach(() => {
  objUrlCounter = 0;
  vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas);
  vi.stubGlobal('Image', FakeImage);
  // jsdom has no usable object-URL impl; stub deterministic values.
  globalThis.URL.createObjectURL = vi.fn(() => `blob:test/${objUrlCounter++}`);
  globalThis.URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.URL.createObjectURL = origCreate;
  globalThis.URL.revokeObjectURL = origRevoke;
  clearImageCacheForTests();
});

describe('regionRasterSize', () => {
  it('uses the requested scale when it fits', async () => {
    const { regionRasterSize } = await import('../../src/export/region');
    expect(regionRasterSize({ w: 800, h: 600 }, 2)).toEqual({ width: 1600, height: 1200, scale: 2 });
  });

  it('shrinks the scale to the side cap, keeping the aspect', async () => {
    const { regionRasterSize } = await import('../../src/export/region');
    const r = regionRasterSize({ w: 20000, h: 1000 }, 2, 16384, Infinity);
    expect(r.width).toBe(16384);
    expect(r.height).toBe(819);
    expect(r.scale).toBeCloseTo(16384 / 20000);
  });

  it('shrinks the scale to the area cap (Safari)', async () => {
    const { regionRasterSize, REGION_MAX_AREA } = await import('../../src/export/region');
    const r = regionRasterSize({ w: 8000, h: 8000 }, 2);
    expect(r.width * r.height).toBeLessThanOrEqual(REGION_MAX_AREA);
    expect(r.width).toBe(r.height);
  });
});

describe('regionPageSize', () => {
  it('maps world px to pt at 0.75 and caps a side at 200in', async () => {
    const { regionPageSize } = await import('../../src/export/region');
    expect(regionPageSize({ w: 800, h: 400 })).toEqual({ width: 600, height: 300 });
    const big = regionPageSize({ w: 40000, h: 10000 });
    expect(big.width).toBeCloseTo(14400);
    expect(big.height).toBeCloseTo(3600);
  });
});

describe('exportSlideRegionPdf', () => {
  it('writes one page sized to the region, painting only the given ids', async () => {
    const { exportSlideRegionPdf } = await import('../../src/export/region');
    const { PDFDocument } = await import('pdf-lib');
    const slide = {
      ...blankSlide('board'),
      elements: [imageElement('keep', 'data:image/png;base64,AAA'), imageElement('drop', 'https://x.test/a.png')],
    };
    const fetcher = vi.fn(async () => pngBlob());
    const bytes = await exportSlideRegionPdf(
      baseDoc([slide]),
      slide,
      { x: -100, y: -50, w: 1200, h: 600 },
      { elementIds: ['keep'], imageFetcher: fetcher, background: '#fff', title: 'Board' },
    );
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(1);
    const { width, height } = loaded.getPage(0).getSize();
    expect(width).toBeCloseTo(900);
    expect(height).toBeCloseTo(450);
    // The dropped element's cross-origin image is never fetched.
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('rasterizeSlideRegion paintAfterElements', () => {
  it('runs the host paint pass over the scoped slide', async () => {
    const { rasterizeSlideRegion } = await import('../../src/export/region');
    const slide = {
      ...blankSlide('board'),
      elements: [imageElement('keep', 'data:image/png;base64,AAA'), imageElement('drop', 'data:image/png;base64,BBB')],
    };
    const paint = vi.fn();
    await rasterizeSlideRegion(baseDoc([slide]), slide, { x: 0, y: 0, w: 600, h: 400 }, {
      elementIds: ['keep'],
      paintAfterElements: paint,
    });
    expect(paint).toHaveBeenCalledTimes(1);
    const painted = paint.mock.calls[0][1] as Slide;
    expect(painted.elements.map((e) => e.id)).toEqual(['keep']);
  });
});

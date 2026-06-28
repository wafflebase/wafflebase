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

const textElement = (id: string, family: string): Element => ({
  id,
  type: 'text',
  frame: { x: 0, y: 0, w: 800, h: 200, rotation: 0 },
  data: {
    blocks: [
      {
        id: 'b1',
        type: 'paragraph',
        inlines: [{ text: 'Hi', style: { fontFamily: family } }],
        style: {
          alignment: 'left',
          lineHeight: 1.2,
          marginTop: 0,
          marginBottom: 0,
          textIndent: 0,
          marginLeft: 0,
        },
      },
    ],
  },
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

describe('collectFontFamilies', () => {
  it('returns theme heading/body fonts plus explicit inline families', async () => {
    const { collectFontFamilies } = await import('../../src/export/pdf');
    const doc = baseDoc([
      { ...blankSlide('s1'), elements: [textElement('t1', 'Roboto')] },
    ]);
    const families = collectFontFamilies(doc);
    expect(families).toContain('Lora');
    expect(families).toContain('Inter');
    expect(families).toContain('Roboto');
  });

  it('deduplicates families', async () => {
    const { collectFontFamilies } = await import('../../src/export/pdf');
    const doc = baseDoc([
      { ...blankSlide('s1'), elements: [textElement('t1', 'Inter')] },
    ]);
    const families = collectFontFamilies(doc);
    expect(families.filter((f) => f === 'Inter')).toHaveLength(1);
  });
});

describe('exportSlidesPdf', () => {
  it('produces one 960×540pt page per slide', async () => {
    const { exportSlidesPdf } = await import('../../src/export/pdf');
    const { PDFDocument } = await import('pdf-lib');
    const bytes = await exportSlidesPdf(
      baseDoc([blankSlide('s1'), blankSlide('s2'), blankSlide('s3')]),
      { scale: 1 },
    );
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(3);
    const page = loaded.getPage(0);
    expect(page.getWidth()).toBeCloseTo(960, 1);
    expect(page.getHeight()).toBeCloseTo(540, 1);
  });

  it('rejects an empty presentation', async () => {
    const { exportSlidesPdf } = await import('../../src/export/pdf');
    await expect(exportSlidesPdf(baseDoc([]))).rejects.toThrow(/empty/i);
  });

  it('fetches each image through the injected fetcher (taint-free) and revokes the temp URL', async () => {
    const { exportSlidesPdf } = await import('../../src/export/pdf');
    const fetcher = vi.fn(
      async () => pngBlob(),
    );
    const doc = baseDoc([
      { ...blankSlide('s1'), elements: [imageElement('i1', 'http://cdn/x.png')] },
    ]);
    await exportSlidesPdf(doc, { scale: 1, imageFetcher: fetcher });
    expect(fetcher).toHaveBeenCalledWith('http://cdn/x.png');
    // The object URL created for the fetched blob is revoked afterwards.
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('does not fetch data: URLs', async () => {
    const { exportSlidesPdf } = await import('../../src/export/pdf');
    const fetcher = vi.fn(
      async () => pngBlob(),
    );
    const doc = baseDoc([
      {
        ...blankSlide('s1'),
        elements: [imageElement('i1', `data:image/png;base64,${PNG_1x1_B64}`)],
      },
    ]);
    await exportSlidesPdf(doc, { scale: 1, imageFetcher: fetcher });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('exportSlidesPdf progress', () => {
  it('reports monotonic per-slide progress ending at total', async () => {
    const { exportSlidesPdf } = await import('../../src/export/pdf');
    const doc = baseDoc([blankSlide('s1'), blankSlide('s2'), blankSlide('s3')]);
    const calls: Array<[number, number, string]> = [];
    await exportSlidesPdf(doc, {
      onProgress: (done, total, phase) => calls.push([done, total, phase]),
    });
    expect(calls[0]).toEqual([0, 3, 'slides']);
    expect(calls[calls.length - 1]).toEqual([3, 3, 'slides']);
    const dones = calls.map((c) => c[0]);
    expect(dones).toEqual([...dones].sort((a, b) => a - b)); // non-decreasing
    expect(calls.every((c) => c[1] === 3 && c[2] === 'slides')).toBe(true);
  });
});

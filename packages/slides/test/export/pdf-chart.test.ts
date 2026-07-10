// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Slide, SlidesDocument } from '../../src/model/presentation';
import { DEFAULT_BACKGROUND } from '../../src/model/presentation';
import type { ChartElement } from '../../src/model/element';
import type { Theme } from '../../src/model/theme';
import { DEFAULT_MASTER } from '../../src/model/master';
import { BUILT_IN_LAYOUTS } from '../../src/model/layout';
import { clearImageCacheForTests } from '../../src/view/canvas/image-cache';

// Mirrors pdf.test.ts's fixtures/mocks (see that file for the rationale
// behind each stub): a genuinely-decodable 1x1 PNG for pdf-lib's
// `embedPng`, a no-op Proxy 2D context standing in for the real canvas
// (jsdom has none), and a synchronously-resolving `Image` stub so the
// shared image cache never hangs on `onload`. This file adds nothing new
// to that plumbing — it only exercises a slide that contains a
// `ChartElement` instead of text/image elements.
const PNG_1x1_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=';
function png1x1(): Uint8Array {
  const bin = atob(PNG_1x1_B64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

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
    const bytes = png1x1();
    return Promise.resolve({
      type: 'image/png',
      size: bytes.length,
      arrayBuffer: async () => bytes.buffer.slice(0),
    } as unknown as Blob);
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
    accent1: '#3366cc',
    accent2: '#dc3912',
    accent3: '#ff9900',
    accent4: '#109618',
    accent5: '#990099',
    accent6: '#0099c6',
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

const chartElement = (id: string): ChartElement => ({
  id,
  type: 'chart',
  frame: { x: 100, y: 100, w: 600, h: 300, rotation: 0 },
  data: {
    kind: 'column',
    title: 'Revenue',
    categories: ['Q1', 'Q2', 'Q3'],
    series: [
      { name: 'Actual', values: [1, 2, 3] },
      { name: 'Plan', values: [3, 2, 1] },
    ],
    legend: 'bottom',
  },
});

beforeEach(() => {
  vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas);
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearImageCacheForTests();
});

describe('exportSlidesPdf — chart', () => {
  it('exports a one-slide deck with a chart to a non-empty PDF without throwing', async () => {
    const { exportSlidesPdf } = await import('../../src/export/pdf');
    const doc = baseDoc([
      { ...blankSlide('s1'), elements: [chartElement('c1')] },
    ]);
    const bytes = await exportSlidesPdf(doc, { scale: 1 });
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBeGreaterThan(0);

    const { PDFDocument } = await import('pdf-lib');
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(1);
  });

  it('collects the chart title into no unresolved-family gap: only theme + inline text fonts are tracked', async () => {
    // Charts paint their title/legend text with the CSS generic
    // `sans-serif` keyword (see chart-renderer.ts), which every browser
    // resolves without an async `document.fonts` load. `collectFontFamilies`
    // therefore has nothing chart-specific to collect; this asserts the
    // deck's chart-only slide still returns exactly the theme's two
    // fonts (no crash, no phantom entries from walking chart data).
    const { collectFontFamilies } = await import('../../src/export/pdf');
    const doc = baseDoc([
      { ...blankSlide('s1'), elements: [chartElement('c1')] },
    ]);
    const families = collectFontFamilies(doc);
    expect(families.sort()).toEqual(['Inter', 'Lora']);
  });
});

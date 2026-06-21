// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Slide, SlidesDocument } from '../../src/model/presentation';
import { DEFAULT_BACKGROUND } from '../../src/model/presentation';
import type { Element } from '../../src/model/element';
import type { Theme } from '../../src/model/theme';
import { DEFAULT_MASTER } from '../../src/model/master';
import { BUILT_IN_LAYOUTS } from '../../src/model/layout';
import { clearImageCacheForTests } from '../../src/view/canvas/image-cache';

// Mock the renderer so we can capture the (cleaned) slide the exporter
// hands to `drawSlide` and assert the editor-only placeholder ref was
// stripped — the actual paint isn't needed for this assertion.
const drawSlideSpy = vi.hoisted(() => vi.fn());
vi.mock('../../src/view/canvas/slide-renderer', () => ({
  drawSlide: drawSlideSpy,
}));

const PNG_1x1_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=';
function png1x1(): Uint8Array {
  const bin = atob(PNG_1x1_B64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

class TestOffscreenCanvas {
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext(type: string): unknown {
    return type === '2d' ? {} : null;
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

const emptyPlaceholder = (id: string): Element => ({
  id,
  type: 'text',
  frame: { x: 0, y: 0, w: 800, h: 200, rotation: 0 },
  placeholderRef: { type: 'title', index: 0 },
  data: {
    blocks: [
      {
        id: 'b1',
        type: 'paragraph',
        inlines: [{ text: '', style: {} }],
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

beforeEach(() => {
  drawSlideSpy.mockClear();
  vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas);
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearImageCacheForTests();
});

describe('exportSlidesPdf placeholder handling', () => {
  it('strips placeholderRef so empty placeholders do not paint their ghost hint', async () => {
    const { exportSlidesPdf } = await import('../../src/export/pdf');
    const slide: Slide = {
      ...({
        id: 's1',
        layoutId: 'blank',
        background: {
          ...DEFAULT_BACKGROUND,
          fill: { kind: 'srgb', value: '#fff' },
        },
        elements: [],
        notes: [],
      } as Slide),
      elements: [emptyPlaceholder('p1')],
    };

    await exportSlidesPdf(baseDoc([slide]), { scale: 1 });

    expect(drawSlideSpy).toHaveBeenCalledTimes(1);
    const renderedSlide = drawSlideSpy.mock.calls[0][1] as Slide;
    expect(renderedSlide.elements[0].placeholderRef).toBeUndefined();
  });
});

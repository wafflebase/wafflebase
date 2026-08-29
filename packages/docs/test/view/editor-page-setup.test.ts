// @vitest-environment jsdom
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { MemDocStore } from '../../src/store/memory.js';
import { initialize, type EditorAPI } from '../../src/view/editor.js';
import {
  DEFAULT_PAGE_SETUP,
  PAPER_SIZES,
  normalizeBlockStyle,
} from '../../src/model/types.js';
import type { Block } from '../../src/model/types.js';

/**
 * `EditorAPI` surface for page setup — the read/write pair the Page Setup
 * dialog drives. The model, the store setter and the repagination all
 * predate it; what is new is that a caller outside the ruler can reach them.
 *
 * Shares the canvas / ResizeObserver shim and mount pattern with
 * `editor-clear-formatting.test.ts`.
 */

const EMPTY_BLOCK_STYLE = normalizeBlockStyle({});

function installCanvasShim(): void {
  const ctxHandler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === 'measureText') {
        return (text: string) => ({
          width: typeof text === 'string' ? text.length * 6 : 0,
          actualBoundingBoxAscent: 8,
          actualBoundingBoxDescent: 2,
        });
      }
      if (prop === 'getImageData') {
        return (_x: number, _y: number, w: number, h: number) => ({
          data: new Uint8ClampedArray(Math.max(0, w) * Math.max(0, h) * 4),
          width: w, height: h,
        });
      }
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient' ||
          prop === 'createPattern') {
        return () => ({ addColorStop: () => {} });
      }
      if (prop === 'canvas') return null;
      if (prop === 'font') return '12px sans-serif';
      return () => {};
    },
    set() {
      return true;
    },
  };
  const fakeCtx = new Proxy({}, ctxHandler) as unknown as CanvasRenderingContext2D;

  (HTMLCanvasElement.prototype as unknown as {
    getContext: (kind: string) => unknown;
  }).getContext = (kind: string) => (kind === '2d' ? fakeCtx : null);

  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

const BLOCKS: Block[] = [
  {
    id: 'b1',
    type: 'paragraph',
    inlines: [{ text: 'hello', style: {} }],
    style: EMPTY_BLOCK_STYLE,
  },
];

function setupEditor(): { editor: EditorAPI; store: MemDocStore } {
  const store = new MemDocStore();
  store.setDocument({ blocks: BLOCKS.map((b) => ({ ...b })) });
  const container = document.createElement('div');
  document.body.appendChild(container);
  return { editor: initialize(container, store), store };
}

describe('EditorAPI page setup', () => {
  beforeEach(() => {
    installCanvasShim();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('reads the defaults for a document that carries no page setup', () => {
    const { editor } = setupEditor();
    expect(editor.getPageSetup()).toEqual(DEFAULT_PAGE_SETUP);
    editor.dispose();
  });

  test('writes paper size, orientation and margins', () => {
    const { editor, store } = setupEditor();

    editor.setPageSetup({
      paperSize: PAPER_SIZES.A4,
      orientation: 'landscape',
      margins: { top: 48, bottom: 48, left: 72, right: 24 },
    });

    expect(editor.getPageSetup()).toEqual({
      paperSize: PAPER_SIZES.A4,
      orientation: 'landscape',
      margins: { top: 48, bottom: 48, left: 72, right: 24 },
    });
    // Reaches the store, not just the in-memory Doc.
    expect(store.getDocument().pageSetup?.paperSize.name).toBe('A4');
    editor.dispose();
  });

  test('the returned setup is a copy — mutating it cannot reach the document', () => {
    const { editor } = setupEditor();

    const setup = editor.getPageSetup();
    setup.margins.top = 1;
    setup.paperSize.width = 1;

    expect(editor.getPageSetup()).toEqual(DEFAULT_PAGE_SETUP);
    editor.dispose();
  });

  test('the caller keeps no alias into document state after a write', () => {
    const { editor } = setupEditor();

    const setup = {
      paperSize: { ...PAPER_SIZES.LEGAL },
      orientation: 'portrait' as const,
      margins: { top: 96, bottom: 96, left: 96, right: 96 },
    };
    editor.setPageSetup(setup);
    setup.margins.left = 0;

    expect(editor.getPageSetup().margins.left).toBe(96);
    editor.dispose();
  });

  test('a page-setup change is one undo step', () => {
    const { editor } = setupEditor();

    editor.setPageSetup({
      paperSize: PAPER_SIZES.LEGAL,
      orientation: 'landscape',
      margins: { top: 10, bottom: 10, left: 10, right: 10 },
    });
    editor.undo();

    expect(editor.getPageSetup()).toEqual(DEFAULT_PAGE_SETUP);
    editor.dispose();
  });
});

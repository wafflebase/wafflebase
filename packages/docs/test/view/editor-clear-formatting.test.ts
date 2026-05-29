// @vitest-environment jsdom
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { MemDocStore } from '../../src/store/memory.js';
import { initialize, type EditorAPI } from '../../src/view/editor.js';
import { normalizeBlockStyle } from '../../src/model/types.js';
import type { Block } from '../../src/model/types.js';

const EMPTY_BLOCK_STYLE = normalizeBlockStyle({});

/**
 * jsdom-friendly tests for `EditorAPI.clearInlineFormatting`. Shares the same
 * canvas / ResizeObserver shim, selection helper, and editor mount
 * pattern as `editor-range-style-summary.test.ts` — both files exercise
 * selection-derived APIs that need a real editor pipeline (Doc + store
 * + selection model) but no actual rendering.
 */

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

function setupEditor(blocks: Block[]): { editor: EditorAPI; container: HTMLElement } {
  const store = new MemDocStore();
  store.setDocument({ blocks });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const editor = initialize(container, store);
  return { editor, container };
}

describe('clearFormatting', () => {
  beforeEach(() => {
    installCanvasShim();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('removes all inline attributes on the selected range', () => {
    const blockId = 'b1';
    const { editor } = setupEditor([
      {
        id: blockId,
        type: 'paragraph',
        inlines: [
          {
            text: 'hello',
            style: {
              bold: true,
              italic: true,
              fontFamily: 'Georgia',
              fontSize: 20,
              color: '#ff0000',
            },
          },
        ],
        style: normalizeBlockStyle({ alignment: 'center', lineHeight: 1.5 }),
      },
    ]);

    editor._setSelectionForTest({
      anchor: { blockId, offset: 0 },
      focus: { blockId, offset: 5 },
    });

    editor.clearInlineFormatting();

    const block = editor.getDoc().document.blocks[0];
    for (const inline of block.inlines) {
      expect(inline.style.bold).toBeUndefined();
      expect(inline.style.italic).toBeUndefined();
      expect(inline.style.fontFamily).toBeUndefined();
      expect(inline.style.fontSize).toBeUndefined();
      expect(inline.style.color).toBeUndefined();
    }
    expect(block.style.alignment).toBe('center');
    expect(block.style.lineHeight).toBe(1.5);
    editor.dispose();
  });

  test('preserves heading block type', () => {
    const blockId = 'b1';
    const { editor } = setupEditor([
      {
        id: blockId,
        type: 'heading',
        headingLevel: 2,
        inlines: [{ text: 'title', style: { bold: true } }],
        style: EMPTY_BLOCK_STYLE,
      },
    ]);

    editor._setSelectionForTest({
      anchor: { blockId, offset: 0 },
      focus: { blockId, offset: 5 },
    });

    editor.clearInlineFormatting();

    const block = editor.getDoc().document.blocks[0];
    expect(block.type).toBe('heading');
    expect(block.headingLevel).toBe(2);
    expect(block.inlines[0].style.bold).toBeUndefined();
    editor.dispose();
  });
});

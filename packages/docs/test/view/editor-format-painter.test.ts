// @vitest-environment jsdom
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemDocStore } from '../../src/store/memory.js';
import { initialize, type EditorAPI } from '../../src/view/editor.js';
import { normalizeBlockStyle } from '../../src/model/types.js';
import type { Block } from '../../src/model/types.js';

/**
 * `EditorAPI` surface for the format painter.
 *
 * The behaviour itself has shipped since the `Mod+Shift+C` / `Mod+Alt+V`
 * shortcuts landed; these tests cover the programmatic entry points a toolbar
 * toggle drives, and the notification a toggle needs to stay in sync with the
 * keyboard.
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

function setupEditor(blocks: Block[]): EditorAPI {
  const store = new MemDocStore();
  store.setDocument({ blocks });
  const container = document.createElement('div');
  document.body.appendChild(container);
  return initialize(container, store);
}

/** Source block is styled; target block is not. The caret starts on the source. */
function twoBlocks(): Block[] {
  return [
    {
      id: 'source',
      type: 'paragraph',
      inlines: [{ text: 'styled', style: { bold: true, fontSize: 20 } }],
      style: EMPTY_BLOCK_STYLE,
    },
    {
      id: 'target',
      type: 'paragraph',
      inlines: [{ text: 'plain', style: {} }],
      style: EMPTY_BLOCK_STYLE,
    },
  ];
}

describe('EditorAPI format painter', () => {
  beforeEach(() => {
    installCanvasShim();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('nothing is held before anything is picked up', () => {
    const editor = setupEditor(twoBlocks());
    expect(editor.hasCopiedFormat()).toBe(false);
    editor.dispose();
  });

  test('copyFormat holds the caret format; pasteFormat writes it to the selection', () => {
    const editor = setupEditor(twoBlocks());

    editor.copyFormat();
    expect(editor.hasCopiedFormat()).toBe(true);

    editor._setSelectionForTest({
      anchor: { blockId: 'target', offset: 0 },
      focus: { blockId: 'target', offset: 5 },
    });
    expect(editor.pasteFormat()).toBe(true);

    const target = editor.getDoc().document.blocks[1];
    expect(target.inlines[0].style.bold).toBe(true);
    expect(target.inlines[0].style.fontSize).toBe(20);
    editor.dispose();
  });

  test('the held format survives a paste, so one pick-up can be applied twice', () => {
    const editor = setupEditor(twoBlocks());
    editor.copyFormat();
    editor._setSelectionForTest({
      anchor: { blockId: 'target', offset: 0 },
      focus: { blockId: 'target', offset: 5 },
    });

    editor.pasteFormat();

    expect(editor.hasCopiedFormat()).toBe(true);
    editor.dispose();
  });

  test('pasteFormat is a no-op with nothing held, and with nothing selected', () => {
    const editor = setupEditor(twoBlocks());

    editor._setSelectionForTest({
      anchor: { blockId: 'target', offset: 0 },
      focus: { blockId: 'target', offset: 5 },
    });
    expect(editor.pasteFormat()).toBe(false);
    expect(editor.getDoc().document.blocks[1].inlines[0].style.bold).toBeUndefined();

    editor.copyFormat();
    editor._setSelectionForTest(null);
    expect(editor.pasteFormat()).toBe(false);
    editor.dispose();
  });

  test('clearCopiedFormat releases the held format', () => {
    const editor = setupEditor(twoBlocks());
    editor.copyFormat();
    editor.clearCopiedFormat();

    expect(editor.hasCopiedFormat()).toBe(false);

    editor._setSelectionForTest({
      anchor: { blockId: 'target', offset: 0 },
      focus: { blockId: 'target', offset: 5 },
    });
    expect(editor.pasteFormat()).toBe(false);
    editor.dispose();
  });

  test('onCopiedFormatChange fires on pick-up and release, and unsubscribes', () => {
    const editor = setupEditor(twoBlocks());
    const seen: boolean[] = [];
    const unsubscribe = editor.onCopiedFormatChange(() =>
      seen.push(editor.hasCopiedFormat()),
    );

    editor.copyFormat();
    editor.clearCopiedFormat();
    // Releasing nothing must not fire — a toggle would flicker.
    editor.clearCopiedFormat();
    expect(seen).toEqual([true, false]);

    unsubscribe();
    editor.copyFormat();
    expect(seen).toEqual([true, false]);
    editor.dispose();
  });

  test('a paste is one undo step', () => {
    const editor = setupEditor(twoBlocks());
    editor.copyFormat();
    editor._setSelectionForTest({
      anchor: { blockId: 'target', offset: 0 },
      focus: { blockId: 'target', offset: 5 },
    });
    editor.pasteFormat();
    expect(editor.getDoc().document.blocks[1].inlines[0].style.bold).toBe(true);

    editor.undo();

    expect(editor.getDoc().document.blocks[1].inlines[0].style.bold).toBeUndefined();
    editor.dispose();
  });

  test('the Mod+Shift+C / Mod+Alt+V shortcuts drive the same buffer', () => {
    const editor = setupEditor(twoBlocks());
    const textarea = document.querySelector('textarea');
    expect(textarea).not.toBeNull();

    const press = (key: string, mods: Partial<KeyboardEventInit>) =>
      textarea!.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...mods }),
      );

    const onChange = vi.fn();
    editor.onCopiedFormatChange(onChange);

    // Both Meta and Ctrl are sent so the assertion holds whichever platform
    // the shortcut resolves `mod` to.
    press('c', { metaKey: true, ctrlKey: true, shiftKey: true });
    expect(editor.hasCopiedFormat()).toBe(true);
    expect(onChange).toHaveBeenCalled();

    editor._setSelectionForTest({
      anchor: { blockId: 'target', offset: 0 },
      focus: { blockId: 'target', offset: 5 },
    });
    press('v', { metaKey: true, ctrlKey: true, altKey: true });

    expect(editor.getDoc().document.blocks[1].inlines[0].style.bold).toBe(true);
    editor.dispose();
  });
});

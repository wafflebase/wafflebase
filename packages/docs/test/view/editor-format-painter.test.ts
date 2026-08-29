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

  test('a paste is one undo step — no more, no fewer', () => {
    const editor = setupEditor(twoBlocks());
    const targetStyle = () => editor.getDoc().document.blocks[1].inlines[0].style;
    const selectTarget = () =>
      editor._setSelectionForTest({
        anchor: { blockId: 'target', offset: 0 },
        focus: { blockId: 'target', offset: 5 },
      });

    // An earlier, distinguishable edit gives the undo stack a floor. Without
    // one, a `pasteFormat` that took *two* snapshots would pass too: both
    // would capture the same pre-paste state, so a single undo would still
    // restore it and the second undo would be invisible.
    selectTarget();
    editor.applyStyle({ italic: true });
    expect(targetStyle().italic).toBe(true);

    editor._setSelectionForTest({
      anchor: { blockId: 'source', offset: 0 },
      focus: { blockId: 'source', offset: 6 },
    });
    editor.copyFormat();
    selectTarget();
    expect(editor.pasteFormat()).toBe(true);
    expect(targetStyle().bold).toBe(true);

    // One undo reverts the whole paste and nothing more.
    editor.undo();
    expect(targetStyle().bold).toBeUndefined();
    expect(targetStyle().italic).toBe(true);

    // …and the next one reaches the edit that preceded it, which is what
    // fails if the paste consumed two entries.
    editor.undo();
    expect(targetStyle().italic).toBeUndefined();
    editor.dispose();
  });

  test('the painter carries no structural inline kinds', () => {
    // `image`, `pageNumber` and `href` say *what a run is*, not how it looks.
    // The buffer is merged over every run of the target selection, so
    // carrying them would graft the source's image / field / link onto all of
    // them — a picture appearing five times, or every word turning into a
    // link to wherever the source pointed.
    const editor = setupEditor([
      {
        id: 'source',
        type: 'paragraph',
        inlines: [
          {
            text: 'linked',
            style: {
              bold: true,
              href: 'https://example.com',
              pageNumber: true,
              image: { src: 'https://example.com/a.png', width: 10, height: 10 },
            },
          },
        ],
        style: EMPTY_BLOCK_STYLE,
      },
      {
        id: 'target',
        type: 'paragraph',
        inlines: [{ text: 'plain', style: {} }],
        style: EMPTY_BLOCK_STYLE,
      },
    ]);

    editor.copyFormat();
    editor._setSelectionForTest({
      anchor: { blockId: 'target', offset: 0 },
      focus: { blockId: 'target', offset: 5 },
    });
    expect(editor.pasteFormat()).toBe(true);

    const style = editor.getDoc().document.blocks[1].inlines[0].style;
    expect(style.bold).toBe(true);
    expect(style.href).toBeUndefined();
    expect(style.pageNumber).toBeUndefined();
    expect(style.image).toBeUndefined();
    editor.dispose();
  });

  test('a backward selection copies the format of the text it highlights', () => {
    // The caret sits at the selection's *focus*, which for a right-to-left
    // drag is its start — so reading the format at the caret picks up the run
    // before the highlighted text. Here that is the unstyled "aaa".
    const editor = setupEditor([
      {
        id: 'source',
        type: 'paragraph',
        inlines: [
          { text: 'aaa', style: {} },
          { text: 'bbb', style: { bold: true, fontSize: 20 } },
        ],
        style: EMPTY_BLOCK_STYLE,
      },
      {
        id: 'target',
        type: 'paragraph',
        inlines: [{ text: 'plain', style: {} }],
        style: EMPTY_BLOCK_STYLE,
      },
    ]);

    editor._setSelectionForTest({
      anchor: { blockId: 'source', offset: 6 },
      focus: { blockId: 'source', offset: 3 },
    });
    editor.copyFormat();

    editor._setSelectionForTest({
      anchor: { blockId: 'target', offset: 0 },
      focus: { blockId: 'target', offset: 5 },
    });
    editor.pasteFormat();

    const style = editor.getDoc().document.blocks[1].inlines[0].style;
    expect(style.bold).toBe(true);
    expect(style.fontSize).toBe(20);
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

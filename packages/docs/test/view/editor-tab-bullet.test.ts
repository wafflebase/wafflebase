// @vitest-environment jsdom
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { MemDocStore } from '../../src/store/memory.js';
import { initialize, type EditorAPI } from '../../src/view/editor.js';
import { normalizeBlockStyle } from '../../src/model/types.js';
import type { Block } from '../../src/model/types.js';

/**
 * Tab / Shift+Tab on a multi-block selection of list-items should change
 * the listLevel of every selected bullet, not just the focus block.
 *
 * Regression guard: previously `TextEditor.handleTab` mutated only
 * `cursor.position.blockId`, so selecting N bullets and pressing Tab
 * only indented one of them. Cmd+] / Cmd+[ already iterated the
 * selection via `forEachBlockInSelection` — Tab now does too.
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
          width: w,
          height: h,
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

function makeListItem(id: string, text: string, listLevel = 0): Block {
  return {
    id,
    type: 'list-item',
    listKind: 'unordered',
    listLevel,
    inlines: [{ text, style: {} }],
    style: normalizeBlockStyle({}),
  };
}

function makeParagraph(id: string, text: string): Block {
  return {
    id,
    type: 'paragraph',
    inlines: [{ text, style: {} }],
    style: normalizeBlockStyle({}),
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

function pressTab(container: HTMLElement, shift = false): void {
  const textarea = container.querySelector('textarea');
  if (!textarea) throw new Error('textarea not mounted');
  textarea.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true }),
  );
}

describe('Tab / Shift+Tab on multi-bullet selection', () => {
  beforeEach(() => {
    installCanvasShim();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('Tab indents every selected list-item, not just the focus block', () => {
    const { editor, container } = setupEditor([
      makeListItem('b1', 'one'),
      makeListItem('b2', 'two'),
      makeListItem('b3', 'three'),
    ]);

    editor._setSelectionForTest({
      anchor: { blockId: 'b1', offset: 0 },
      focus: { blockId: 'b3', offset: 3 },
    });

    pressTab(container, /* shift */ false);

    const blocks = editor.getDoc().document.blocks;
    expect(blocks.find((b) => b.id === 'b1')?.listLevel).toBe(1);
    expect(blocks.find((b) => b.id === 'b2')?.listLevel).toBe(1);
    expect(blocks.find((b) => b.id === 'b3')?.listLevel).toBe(1);
    editor.dispose();
  });

  test('Shift+Tab outdents every selected list-item', () => {
    const { editor, container } = setupEditor([
      makeListItem('b1', 'one', 2),
      makeListItem('b2', 'two', 2),
      makeListItem('b3', 'three', 2),
    ]);

    editor._setSelectionForTest({
      anchor: { blockId: 'b1', offset: 0 },
      focus: { blockId: 'b3', offset: 3 },
    });

    pressTab(container, /* shift */ true);

    const blocks = editor.getDoc().document.blocks;
    expect(blocks.find((b) => b.id === 'b1')?.listLevel).toBe(1);
    expect(blocks.find((b) => b.id === 'b2')?.listLevel).toBe(1);
    expect(blocks.find((b) => b.id === 'b3')?.listLevel).toBe(1);
    editor.dispose();
  });

  test('Tab on a single list-item (no selection) still indents that block', () => {
    const { editor, container } = setupEditor([makeListItem('b1', 'only')]);
    editor._setSelectionForTest(null);

    pressTab(container, false);

    expect(editor.getDoc().document.blocks[0].listLevel).toBe(1);
    editor.dispose();
  });

  test('Tab in a mixed selection only changes list-item blocks', () => {
    const { editor, container } = setupEditor([
      makeListItem('b1', 'bullet a'),
      makeParagraph('b2', 'plain paragraph'),
      makeListItem('b3', 'bullet b'),
    ]);

    editor._setSelectionForTest({
      anchor: { blockId: 'b1', offset: 0 },
      focus: { blockId: 'b3', offset: 8 },
    });

    pressTab(container, false);

    const blocks = editor.getDoc().document.blocks;
    expect(blocks.find((b) => b.id === 'b1')?.listLevel).toBe(1);
    expect(blocks.find((b) => b.id === 'b3')?.listLevel).toBe(1);
    // Paragraph in the middle is untouched (Tab is the list-level
    // shortcut, not the general indent — that's Cmd+]).
    const para = blocks.find((b) => b.id === 'b2');
    expect(para?.type).toBe('paragraph');
    expect(para?.style.marginLeft ?? 0).toBe(0);
    editor.dispose();
  });
});

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

  test('Tab clamps at listLevel 8; Shift+Tab clamps at 0', () => {
    const { editor, container } = setupEditor([
      makeListItem('b1', 'maxed', 8),
      makeListItem('b2', 'mixed', 7),
      makeListItem('b3', 'zero', 0),
    ]);

    editor._setSelectionForTest({
      anchor: { blockId: 'b1', offset: 0 },
      focus: { blockId: 'b3', offset: 4 },
    });

    pressTab(container, /* shift */ false);
    let blocks = editor.getDoc().document.blocks;
    expect(blocks.find((b) => b.id === 'b1')?.listLevel).toBe(8);
    expect(blocks.find((b) => b.id === 'b2')?.listLevel).toBe(8);
    expect(blocks.find((b) => b.id === 'b3')?.listLevel).toBe(1);

    pressTab(container, /* shift */ true);
    pressTab(container, /* shift */ true);
    blocks = editor.getDoc().document.blocks;
    expect(blocks.find((b) => b.id === 'b1')?.listLevel).toBe(6);
    expect(blocks.find((b) => b.id === 'b2')?.listLevel).toBe(6);
    expect(blocks.find((b) => b.id === 'b3')?.listLevel).toBe(0);
    editor.dispose();
  });

  test('Tab on an all-paragraph selection is a no-op (focus on paragraph)', () => {
    const { editor, container } = setupEditor([
      makeParagraph('b1', 'one'),
      makeParagraph('b2', 'two'),
    ]);

    editor._setSelectionForTest({
      anchor: { blockId: 'b1', offset: 0 },
      focus: { blockId: 'b2', offset: 3 },
    });

    pressTab(container, false);

    const blocks = editor.getDoc().document.blocks;
    expect(blocks[0].type).toBe('paragraph');
    expect(blocks[1].type).toBe('paragraph');
    expect(blocks[0].style.marginLeft ?? 0).toBe(0);
    expect(blocks[1].style.marginLeft ?? 0).toBe(0);
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

/**
 * Changing a list item's level carries its nested children, so a parent
 * never lands on the same level as its own child (issue #1050).
 */
describe('list level carries nested children', () => {
  beforeEach(() => {
    installCanvasShim();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  const levels = (editor: EditorAPI): Array<number | undefined> =>
    editor.getDoc().document.blocks.map((b) => b.listLevel);

  /** Collapsed range: `hasSelection()` is false, so this is a bare caret. */
  const putCaret = (editor: EditorAPI, blockId: string): void => {
    editor._setSelectionForTest({
      anchor: { blockId, offset: 0 },
      focus: { blockId, offset: 0 },
    });
  };

  test('Tab on a parent moves its child too', () => {
    const { editor, container } = setupEditor([
      makeListItem('b1', '123123123', 0),
      makeListItem('b2', '123123', 1),
      makeListItem('b3', '123123', 0),
    ]);
    putCaret(editor, 'b1');

    pressTab(container, false);

    expect(levels(editor)).toEqual([1, 2, 0]);
    editor.dispose();
  });

  test('Shift+Tab on a parent pulls its child up too', () => {
    const { editor, container } = setupEditor([
      makeListItem('b1', 'parent', 1),
      makeListItem('b2', 'child', 2),
      makeListItem('b3', 'after', 1),
    ]);
    putCaret(editor, 'b1');

    pressTab(container, true);

    expect(levels(editor)).toEqual([0, 1, 1]);
    editor.dispose();
  });

  test('Shift+Tab on a level-0 parent is a no-op for the whole subtree', () => {
    const { editor, container } = setupEditor([
      makeListItem('b1', 'parent', 0),
      makeListItem('b2', 'child', 1),
    ]);
    putCaret(editor, 'b1');

    pressTab(container, true);

    expect(levels(editor)).toEqual([0, 1]);
    editor.dispose();
  });

  test('Tab is refused when the subtree is already at level 8', () => {
    const { editor, container } = setupEditor([
      makeListItem('b1', 'parent', 7),
      makeListItem('b2', 'child', 8),
    ]);
    putCaret(editor, 'b1');

    pressTab(container, false);

    expect(levels(editor)).toEqual([7, 8]);
    editor.dispose();
  });

  test('a selected parent and child each move exactly once', () => {
    const { editor, container } = setupEditor([
      makeListItem('b1', 'parent', 0),
      makeListItem('b2', 'child', 1),
      makeListItem('b3', 'grandchild', 2),
    ]);
    editor._setSelectionForTest({
      anchor: { blockId: 'b1', offset: 0 },
      focus: { blockId: 'b3', offset: 3 },
    });

    pressTab(container, false);

    expect(levels(editor)).toEqual([1, 2, 3]);
    editor.dispose();
  });

  test('toolbar indent / outdent carry the subtree as well', () => {
    const { editor } = setupEditor([
      makeListItem('b1', 'parent', 0),
      makeListItem('b2', 'child', 1),
      makeParagraph('b3', 'plain'),
    ]);
    putCaret(editor, 'b1');

    editor.indent();
    expect(levels(editor)).toEqual([1, 2, undefined]);

    editor.outdent();
    expect(levels(editor)).toEqual([0, 1, undefined]);
    editor.dispose();
  });

  test('toolbar indent still moves a plain paragraph by marginLeft', () => {
    const { editor } = setupEditor([makeParagraph('b1', 'plain')]);
    putCaret(editor, 'b1');

    editor.indent();
    expect(editor.getDoc().document.blocks[0].style.marginLeft).toBe(36);

    editor.outdent();
    expect(editor.getDoc().document.blocks[0].style.marginLeft).toBe(0);
    editor.dispose();
  });
});

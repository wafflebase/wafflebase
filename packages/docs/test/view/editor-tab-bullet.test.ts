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

/**
 * Every `fillText` the paint pass makes, in order. Painted x is the only
 * observable that distinguishes a block laid out at its new list level
 * from one whose cached lines survived the change — the marker is painted
 * from live block data, so it moves either way.
 */
const fillTextCalls: Array<{ text: string; x: number }> = [];

function installCanvasShim(): void {
  const ctxHandler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === 'fillText') {
        return (text: string, x: number) => {
          fillTextCalls.push({ text, x });
        };
      }
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

/**
 * Cmd+] / Ctrl+] — the list-level shortcut a table-cell caret can reach
 * (Tab inside a cell is cell navigation). Both modifiers are set so the
 * dispatch matches whichever one the platform check picks.
 */
function pressIndentKey(container: HTMLElement): void {
  const textarea = container.querySelector('textarea');
  if (!textarea) throw new Error('textarea not mounted');
  textarea.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: ']',
      metaKey: true,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
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

  test('a header list carries its children too (context blocks, not body)', () => {
    const store = new MemDocStore();
    store.setDocument({
      blocks: [makeParagraph('body', 'body text')],
      header: {
        blocks: [makeListItem('h1', 'parent', 0), makeListItem('h2', 'child', 1)],
        marginFromEdge: 48,
      },
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = initialize(container, store);
    editor._setEditContextForTest('header');
    putCaret(editor, 'h1');

    pressTab(container, false);

    const header = store.getDocument().header!.blocks;
    expect(header.map((b) => b.listLevel)).toEqual([1, 2]);
    editor.dispose();
  });

});

/**
 * `indent()` / `outdent()` only `render()` — they keep the layout cache —
 * so a carried child the selection never covered has to be marked dirty
 * by hand or its cached lines repaint at the old indent. The marker is
 * painted from live block data and moves either way, so the model level
 * every other test here asserts cannot see this.
 */
describe('a carried child repaints at its new depth', () => {
  let origRect: typeof Element.prototype.getBoundingClientRect;

  beforeEach(() => {
    installCanvasShim();
    // jsdom reports every box as 0×0, which collapses the layout and leaves
    // the paint pass with nothing on screen to draw.
    origRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (): DOMRect {
      return {
        x: 0, y: 0, left: 0, top: 0, right: 816, bottom: 1056,
        width: 816, height: 1056, toJSON: () => ({}),
      } as DOMRect;
    };
    document.body.innerHTML = '';
    fillTextCalls.length = 0;
  });

  afterEach(() => {
    Element.prototype.getBoundingClientRect = origRect;
    document.body.innerHTML = '';
  });

  /** The x of the last painted `fillText` whose text is `text`. */
  const paintedX = (text: string): number | undefined => {
    for (let i = fillTextCalls.length - 1; i >= 0; i--) {
      if (fillTextCalls[i].text === text) return fillTextCalls[i].x;
    }
    return undefined;
  };

  test('toolbar indent / outdent move the carried child on screen', () => {
    const { editor } = setupEditor([
      makeListItem('b1', 'parent', 0),
      makeListItem('b2', 'child', 1),
    ]);
    editor._setSelectionForTest({
      anchor: { blockId: 'b1', offset: 0 },
      focus: { blockId: 'b1', offset: 0 },
    });

    editor.render();
    const before = paintedX('child');
    expect(before).toBeDefined();

    editor.indent();
    expect(editor.getDoc().document.blocks.map((b) => b.listLevel)).toEqual([1, 2]);
    expect(paintedX('child')!).toBeGreaterThan(before!);

    editor.outdent();
    expect(editor.getDoc().document.blocks.map((b) => b.listLevel)).toEqual([0, 1]);
    expect(paintedX('child')!).toBeCloseTo(before!, 5);
    editor.dispose();
  });
});

/**
 * Blocks inside a table cell are their own list container: nesting is
 * implied by adjacency *within the cell*, so the walker has to hand
 * `cell.blocks` — not the top-level array — to the subtree planner.
 */
describe('list level inside a table cell', () => {
  beforeEach(() => {
    installCanvasShim();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  /** A body table whose first cell holds `cellBlocks`, plus two paragraphs. */
  function setupTable(cellBlocks: Block[]): {
    editor: EditorAPI;
    container: HTMLElement;
    store: MemDocStore;
  } {
    const table: Block = {
      id: 't1',
      type: 'table',
      inlines: [],
      style: normalizeBlockStyle({}),
      tableData: {
        rows: [
          {
            cells: [
              { blocks: cellBlocks, style: {} },
              { blocks: [makeParagraph('other', 'other')], style: {} },
            ],
          },
        ],
        columnWidths: [0.5, 0.5],
      },
    };
    const store = new MemDocStore();
    store.setDocument({
      blocks: [makeParagraph('p1', 'before'), table, makeListItem('p2', 'after', 0)],
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = initialize(container, store);
    return { editor, container, store };
  }

  /** The stored (post-edit) list levels of the table's first cell. */
  const cellLevels = (store: MemDocStore): Array<number | undefined> =>
    store.getDocument().blocks[1].tableData!.rows[0].cells[0].blocks.map(
      (b) => b.listLevel,
    );

  test('the toolbar carries a cell caret’s subtree, within that cell only', () => {
    // Tab inside a cell is cell navigation, so the list-level gesture a cell
    // caret reaches is the toolbar / Cmd+] one — `editor.ts`'s own walker.
    const { editor, store } = setupTable([
      makeListItem('c1', 'parent', 0),
      makeListItem('c2', 'child', 1),
      makeListItem('c3', 'sibling', 0),
    ]);
    editor._setSelectionForTest({
      anchor: { blockId: 'c1', offset: 0 },
      focus: { blockId: 'c1', offset: 0 },
    });

    editor.indent();

    expect(cellLevels(store)).toEqual([1, 2, 0]);
    // The top-level list item is not a sibling of anything in the cell.
    expect(store.getDocument().blocks[2].listLevel).toBe(0);

    editor.outdent();
    expect(cellLevels(store)).toEqual([0, 1, 0]);
    editor.dispose();
  });

  test('Cmd+] on a cell caret carries the subtree too (text-editor walker)', () => {
    const { editor, container, store } = setupTable([
      makeListItem('c1', 'parent', 0),
      makeListItem('c2', 'child', 1),
      makeListItem('c3', 'sibling', 0),
    ]);
    editor._setSelectionForTest({
      anchor: { blockId: 'c1', offset: 0 },
      focus: { blockId: 'c1', offset: 0 },
    });

    pressIndentKey(container);

    expect(cellLevels(store)).toEqual([1, 2, 0]);
    expect(store.getDocument().blocks[2].listLevel).toBe(0);
    editor.dispose();
  });

  test('a same-cell multi-block selection groups by the cell', () => {
    const { editor, container, store } = setupTable([
      makeListItem('c1', 'parent', 0),
      makeListItem('c2', 'child', 1),
      makeListItem('c3', 'sibling', 0),
    ]);
    editor._setSelectionForTest({
      anchor: { blockId: 'c1', offset: 0 },
      focus: { blockId: 'c3', offset: 7 },
    });

    pressIndentKey(container);

    // c2 is carried by c1's subtree and must not move twice.
    expect(cellLevels(store)).toEqual([1, 2, 1]);
    editor.dispose();
  });

  test('a body selection spanning a table carries each cell subtree', () => {
    const { editor, container, store } = setupTable([
      makeListItem('c1', 'parent', 0),
      makeListItem('c2', 'child', 1),
    ]);
    editor._setSelectionForTest({
      anchor: { blockId: 'p1', offset: 0 },
      focus: { blockId: 'p2', offset: 5 },
    });

    pressTab(container, false);

    expect(cellLevels(store)).toEqual([1, 2]);
    expect(store.getDocument().blocks[2].listLevel).toBe(1);
    editor.dispose();
  });
});

describe('list level in a header context', () => {
  beforeEach(() => {
    installCanvasShim();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('a multi-block header selection indents header blocks, not body ones', () => {
    // `getBlockIndex` resolves against the active context, so the walker's
    // multi-block branch has to read the header array with those indices —
    // reading the body array would move body blocks (or crash past its end).
    const store = new MemDocStore();
    store.setDocument({
      blocks: [
        makeListItem('body1', 'body one', 0),
        makeListItem('body2', 'body two', 0),
      ],
      header: {
        blocks: [
          makeListItem('h1', 'parent', 0),
          makeListItem('h2', 'child', 1),
          makeListItem('h3', 'sibling', 0),
        ],
        marginFromEdge: 48,
      },
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = initialize(container, store);
    editor._setEditContextForTest('header');
    editor._setSelectionForTest({
      anchor: { blockId: 'h1', offset: 0 },
      focus: { blockId: 'h3', offset: 7 },
    });

    pressTab(container, false);

    const doc = store.getDocument();
    expect(doc.header!.blocks.map((b) => b.listLevel)).toEqual([1, 2, 1]);
    expect(doc.blocks.map((b) => b.listLevel)).toEqual([0, 0]);
    editor.dispose();
  });
});

describe('list level carries nested children (paragraph indent)', () => {
  beforeEach(() => {
    installCanvasShim();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  const putCaret = (editor: EditorAPI, blockId: string): void => {
    editor._setSelectionForTest({
      anchor: { blockId, offset: 0 },
      focus: { blockId, offset: 0 },
    });
  };

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

// @vitest-environment jsdom
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { MemDocStore } from '../../src/store/memory.js';
import { initialize, type EditorAPI } from '../../src/view/editor.js';
import { hitTestLineAffinity } from '../../src/view/visual-line.js';
import { normalizeBlockStyle, generateBlockId } from '../../src/model/types.js';
import type { Block, TableCell, TableRow } from '../../src/model/types.js';

/**
 * Issue #934 — a caret placed inside a table cell or a header/footer could
 * only ever carry `'backward'` affinity, so it never expressed "the start of
 * the next visual line". `getWrapAffinity` looked its block up in the body
 * layout, which contains neither cell-inner blocks nor header/footer blocks,
 * so both regions fell through to `'backward'` once a line wrapped.
 *
 * The observable consequence is Home / End (#67): with `'backward'` affinity
 * a caret sitting on a wrap boundary belongs to the line *above*, so End does
 * not move at all instead of walking to the end of the line the caret is
 * drawn on.
 */

const EMPTY = normalizeBlockStyle({});

/** A single unbroken token — wraps at character granularity. */
const TEXT = 'x'.repeat(400);

function installCanvasShim(): void {
  const measureText = (text: string) => ({
    width: typeof text === 'string' ? text.length * 6 : 0,
    actualBoundingBoxAscent: 8,
    actualBoundingBoxDescent: 2,
  });
  const ctxHandler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === 'measureText') return measureText;
      if (prop === 'canvas') return null;
      if (prop === 'font') return '12px sans-serif';
      return () => {};
    },
    set() { return true; },
  };
  const fakeCtx = new Proxy({}, ctxHandler) as unknown as CanvasRenderingContext2D;
  (HTMLCanvasElement.prototype as unknown as { getContext: (k: string) => unknown }).getContext =
    (kind: string) => (kind === '2d' ? fakeCtx : null);
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {} unobserve(): void {} disconnect(): void {}
  };
}

function para(text: string): Block {
  return {
    id: generateBlockId(),
    type: 'paragraph',
    inlines: [{ text, style: { fontFamily: 'Arial', fontSize: 12 } }],
    style: EMPTY,
  };
}

function cell(text: string): TableCell {
  return { blocks: [para(text)], style: {} };
}

function tableBlock(text: string): Block {
  const rows: TableRow[] = [{ cells: [cell(text)] }];
  return {
    id: generateBlockId(),
    type: 'table',
    inlines: [],
    style: EMPTY,
    tableData: { rows, columnWidths: [1] },
  };
}

describe('hitTestLineAffinity', () => {
  test('an offset on the start boundary of a continuation line reads forward', () => {
    expect(hitTestLineAffinity(5, 5, false)).toBe('forward');
  });

  test("the block's first line has no preceding boundary", () => {
    expect(hitTestLineAffinity(0, 0, true)).toBe('backward');
  });

  test('an offset inside the line reads backward', () => {
    expect(hitTestLineAffinity(7, 5, false)).toBe('backward');
  });
});

describe('wrap affinity inside a table cell / header', () => {
  const editors: EditorAPI[] = [];
  let origRAF: typeof window.requestAnimationFrame;

  beforeEach(() => {
    installCanvasShim();
    origRAF = window.requestAnimationFrame;
    window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
      queueMicrotask(() => cb(performance.now()));
      return 0;
    };
    document.body.innerHTML = '';
  });

  afterEach(() => {
    for (const editor of editors.splice(0)) editor.dispose();
    window.requestAnimationFrame = origRAF;
    document.body.innerHTML = '';
  });

  function mount(store: MemDocStore): { editor: EditorAPI; container: HTMLElement } {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = initialize(container, store);
    editors.push(editor);
    return { editor, container };
  }

  function place(editor: EditorAPI, blockId: string, offset: number): void {
    editor._setSelectionForTest({
      anchor: { blockId, offset },
      focus: { blockId, offset },
    });
  }

  async function press(container: HTMLElement, key: string): Promise<void> {
    container.querySelector('textarea')!.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  /** Type one character through the hidden textarea, as the browser would. */
  async function type(container: HTMLElement, char: string): Promise<void> {
    const ta = container.querySelector('textarea')!;
    ta.value = char;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  /**
   * Type one character so the caret lands exactly on the first wrap boundary,
   * then assert End walks on to the end of the line the caret is drawn on
   * rather than staying put on the boundary (which is what a 'backward'
   * affinity produces, since that offset also ends the line above).
   */
  async function expectForwardAffinityAtBoundary(
    editor: EditorAPI,
    container: HTMLElement,
    blockId: string,
  ): Promise<void> {
    place(editor, blockId, 0);
    await press(container, 'End');
    const boundary = editor._getCursorForTest().offset;
    // The text wrapped: End stopped short of the block's end.
    expect(boundary).toBeGreaterThan(0);
    expect(boundary).toBeLessThan(TEXT.length);

    // Typing one character just before the boundary leaves the caret on it —
    // the line is full of identical glyphs, so the boundary does not move.
    place(editor, blockId, boundary - 1);
    await type(container, 'x');
    expect(editor._getCursorForTest().offset).toBe(boundary);

    await press(container, 'End');
    expect(editor._getCursorForTest().offset).toBeGreaterThan(boundary);
  }

  test('a caret typed onto a wrap boundary in a table cell reads forward', async () => {
    const store = new MemDocStore();
    const table = tableBlock(TEXT);
    store.setDocument({ blocks: [table] });
    const { editor, container } = mount(store);
    const cellBlockId = table.tableData!.rows[0].cells[0].blocks[0].id;

    await expectForwardAffinityAtBoundary(editor, container, cellBlockId);
  });

  test('a caret typed onto a wrap boundary in the header reads forward', async () => {
    const store = new MemDocStore();
    const headerPara = para(TEXT);
    store.setDocument({
      blocks: [para('body')],
      header: { blocks: [headerPara], marginFromEdge: 48 },
    });
    const { editor, container } = mount(store);
    editor._setEditContextForTest('header');

    await expectForwardAffinityAtBoundary(editor, container, headerPara.id);
  });
});

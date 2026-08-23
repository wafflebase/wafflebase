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

/**
 * jsdom lays nothing out, so every `getBoundingClientRect()` is zeros —
 * which drives `computeScaleFactor` to `Number.EPSILON` and makes the mouse
 * handlers divide client coordinates by it, so every click lands past the
 * end of the document. Stubbing a real viewport width (and leaving
 * top/left at 0, so `clientX/clientY` *are* canvas coordinates) is what
 * makes the pixel hit-tests reachable from a test.
 */
function installRectShim(): () => void {
  const orig = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = () => ({
    x: 0, y: 0, top: 0, left: 0, right: VIEWPORT_WIDTH, bottom: 900,
    width: VIEWPORT_WIDTH, height: 900, toJSON: () => ({}),
  }) as DOMRect;
  return () => { Element.prototype.getBoundingClientRect = orig; };
}

/** Stubbed viewport width; wide enough that the page renders unscaled. */
const VIEWPORT_WIDTH = 1200;
/** Default page width (Letter at 96dpi), centred in the viewport. */
const PAGE_WIDTH = 816;
/** Left edge of the body content: page origin + the 1in left margin. */
const CONTENT_LEFT = (VIEWPORT_WIDTH - PAGE_WIDTH) / 2 + 96;
/** Default table cell padding, applied on top of `CONTENT_LEFT`. */
const CELL_PADDING = 4;

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
  let restoreRects: () => void;

  beforeEach(() => {
    installCanvasShim();
    restoreRects = installRectShim();
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
    restoreRects();
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

  /** The caret's affinity, as the hit-test put it on the position. */
  function affinity(editor: EditorAPI): string | undefined {
    return (editor._getCursorForTest() as { lineAffinity?: string }).lineAffinity;
  }

  /**
   * Click at canvas coordinates. The caret is parked on a sentinel first, so
   * a click the editor decided to ignore (a region that is not the active
   * edit context, a border-resize grab) is visible as "nothing moved"
   * instead of silently reading as a pass.
   *
   * Successive calls must stay more than `DOUBLE_CLICK_DIST` (5px) apart or
   * the editor counts them as a double click and selects a word instead.
   */
  function clickAt(
    editor: EditorAPI,
    container: HTMLElement,
    x: number,
    y: number,
    sentinel: { blockId: string; offset: number },
  ): void {
    editor._setSelectionForTest({ anchor: sentinel, focus: sentinel });
    container.dispatchEvent(
      new MouseEvent('mousedown', { clientX: x, clientY: y, bubbles: true, cancelable: true }),
    );
  }

  /**
   * The y of the second visual line of `blockId`, found by clicking down the
   * page at a fixed x until the caret lands past the first line's end. Read
   * from the editor rather than hardcoded so the tests below do not encode
   * the line height / page-gap arithmetic.
   */
  function findSecondLineY(
    editor: EditorAPI,
    container: HTMLElement,
    blockId: string,
    boundary: number,
    beforeEachClick?: () => void,
  ): number {
    for (let y = 0; y < 600; y += 6) {
      beforeEachClick?.();
      clickAt(editor, container, CONTENT_LEFT + 112, y, { blockId, offset: 0 });
      const cursor = editor._getCursorForTest();
      if (cursor.blockId === blockId && cursor.offset > boundary && cursor.offset < TEXT.length) {
        return y;
      }
    }
    throw new Error('no click resolved onto the second visual line');
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

  /** End from the block start — the offset the first wrap boundary sits at. */
  async function firstWrapBoundary(
    editor: EditorAPI,
    container: HTMLElement,
    blockId: string,
  ): Promise<number> {
    place(editor, blockId, 0);
    await press(container, 'End');
    const boundary = editor._getCursorForTest().offset;
    expect(boundary).toBeGreaterThan(0);
    expect(boundary).toBeLessThan(TEXT.length);
    return boundary;
  }

  test('clicking the start of a wrapped line in a table cell reads forward', async () => {
    const store = new MemDocStore();
    const table = tableBlock(TEXT);
    store.setDocument({ blocks: [table] });
    const { editor, container } = mount(store);
    const cellBlockId = table.tableData!.rows[0].cells[0].blocks[0].id;

    const boundary = await firstWrapBoundary(editor, container, cellBlockId);
    const lineY = findSecondLineY(editor, container, cellBlockId, boundary);

    // At (or left of) the line's first glyph the hit-test resolves the
    // boundary offset itself — the offset the line above also ends at.
    clickAt(editor, container, CONTENT_LEFT + CELL_PADDING, lineY, { blockId: cellBlockId, offset: 0 });
    expect(editor._getCursorForTest().blockId).toBe(cellBlockId);
    expect(editor._getCursorForTest().offset).toBe(boundary);
    expect(affinity(editor)).toBe('forward');

    // End then walks to the end of the clicked line, not back up.
    await press(container, 'End');
    expect(editor._getCursorForTest().offset).toBeGreaterThan(boundary);

    // A click one glyph in is inside the line, not on its boundary.
    clickAt(editor, container, CONTENT_LEFT + CELL_PADDING + 12, lineY, { blockId: cellBlockId, offset: 0 });
    expect(editor._getCursorForTest().offset).toBeGreaterThan(boundary);
    expect(affinity(editor)).toBe('backward');
  });

  test('clicking the start of a wrapped line in a nested cell reads forward', async () => {
    const store = new MemDocStore();
    const inner = tableBlock(TEXT);
    const outer: Block = {
      id: generateBlockId(),
      type: 'table',
      inlines: [],
      style: EMPTY,
      tableData: { rows: [{ cells: [{ blocks: [inner], style: {} }] }], columnWidths: [1] },
    };
    store.setDocument({ blocks: [outer] });
    const { editor, container } = mount(store);
    const innerBlockId = inner.tableData!.rows[0].cells[0].blocks[0].id;

    const boundary = await firstWrapBoundary(editor, container, innerBlockId);
    const lineY = findSecondLineY(editor, container, innerBlockId, boundary);

    clickAt(editor, container, CONTENT_LEFT + CELL_PADDING, lineY, { blockId: innerBlockId, offset: 0 });
    expect(editor._getCursorForTest().blockId).toBe(innerBlockId);
    expect(editor._getCursorForTest().offset).toBe(boundary);
    expect(affinity(editor)).toBe('forward');

    // The typing path has to agree with the click path at any nesting depth:
    // `getWrapAffinity` resolves the inner table through
    // `resolveNestedTableLayout`, since an inner table is not a member of
    // `layout.blocks`.
    await expectForwardAffinityAtBoundary(editor, container, innerBlockId);
  });

  test('clicking the start of a wrapped line in the header reads forward', async () => {
    const store = new MemDocStore();
    const headerPara = para(TEXT);
    store.setDocument({
      blocks: [para('body')],
      header: { blocks: [headerPara], marginFromEdge: 48 },
    });
    const { editor, container } = mount(store);
    // Every click that lands on the body exits header editing, so the
    // context is re-asserted before each one.
    const enterHeader = () => editor._setEditContextForTest('header');

    enterHeader();
    const boundary = await firstWrapBoundary(editor, container, headerPara.id);
    const lineY = findSecondLineY(editor, container, headerPara.id, boundary, enterHeader);

    enterHeader();
    clickAt(editor, container, CONTENT_LEFT, lineY, { blockId: headerPara.id, offset: 0 });
    expect(editor._getCursorForTest().blockId).toBe(headerPara.id);
    expect(editor._getCursorForTest().offset).toBe(boundary);
    expect(affinity(editor)).toBe('forward');

    enterHeader();
    clickAt(editor, container, CONTENT_LEFT + 12, lineY, { blockId: headerPara.id, offset: 0 });
    expect(editor._getCursorForTest().offset).toBeGreaterThan(boundary);
    expect(affinity(editor)).toBe('backward');
  });

  test('a caret typed onto a wrap boundary in the footer reads forward', async () => {
    const store = new MemDocStore();
    const footerPara = para(TEXT);
    store.setDocument({
      blocks: [para('body')],
      footer: { blocks: [footerPara], marginFromEdge: 48 },
    });
    const { editor, container } = mount(store);
    editor._setEditContextForTest('footer');

    await expectForwardAffinityAtBoundary(editor, container, footerPara.id);
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

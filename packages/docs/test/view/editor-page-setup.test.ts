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
    setup.orientation = 'landscape';
    setup.margins.top = 1;
    setup.paperSize.width = 1;

    // Read *fresh* values rather than comparing against `DEFAULT_PAGE_SETUP`:
    // if `getPageSetup()` handed back that shared constant by reference, the
    // mutations above would have landed on both sides of such a comparison
    // and it would pass while aliased. These assertions carry the expected
    // numbers literally, so nothing the mutation touched can move with them.
    const fresh = editor.getPageSetup();
    expect(fresh.orientation).toBe('portrait');
    expect(fresh.margins.top).toBe(96);
    expect(fresh.paperSize.width).toBe(816);

    // The module constants are the other thing an alias would have damaged,
    // and the damage would outlive this test — every later reader of
    // `DEFAULT_PAGE_SETUP` / `PAPER_SIZES` in this process would see it.
    expect(DEFAULT_PAGE_SETUP.orientation).toBe('portrait');
    expect(DEFAULT_PAGE_SETUP.margins.top).toBe(96);
    expect(DEFAULT_PAGE_SETUP.paperSize.width).toBe(816);
    expect(PAPER_SIZES.LETTER.width).toBe(816);
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

describe('EditorAPI page setup — bounds', () => {
  beforeEach(() => {
    installCanvasShim();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  /** Letter portrait: 816 × 1056 px. */
  const withMargins = (margins: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  }) => ({
    paperSize: PAPER_SIZES.LETTER,
    orientation: 'portrait' as const,
    margins,
  });

  const SQUARE = { top: 96, bottom: 96, left: 96, right: 96 };

  test.each([
    ['margins that close the page horizontally', withMargins({ ...SQUARE, left: 408, right: 408 })],
    ['margins that close the page vertically', withMargins({ ...SQUARE, top: 528, bottom: 528 })],
    ['margins wider than the page', withMargins({ ...SQUARE, left: 900, right: 900 })],
    ['a negative margin', withMargins({ ...SQUARE, top: -10 })],
    ['a NaN margin', withMargins({ ...SQUARE, left: Number.NaN })],
    ['an infinite margin', withMargins({ ...SQUARE, right: Number.POSITIVE_INFINITY })],
    [
      'a zero-width paper size',
      {
        paperSize: { name: 'Zero', width: 0, height: 1056 },
        orientation: 'portrait' as const,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
    ],
    [
      'a negative paper size',
      {
        paperSize: { name: 'Negative', width: -816, height: -1056 },
        orientation: 'portrait' as const,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
    ],
    [
      'a NaN paper size',
      {
        paperSize: { name: 'NaN', width: Number.NaN, height: 1056 },
        orientation: 'portrait' as const,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
    ],
  ])('refuses %s, and writes nothing', (_label, setup) => {
    // Every consumer of a page setup — `paginateLayout`, the renderer, the
    // ruler, the PDF exporter — assumes a positive content box. The ruler
    // keeps 20 px in hand and the Page Setup dialog disables Apply, but
    // `EditorAPI.setPageSetup` is public: the invariant belongs on the write.
    const { editor, store } = setupEditor();

    expect(() => editor.setPageSetup(setup)).toThrow(RangeError);

    // Nothing reached the document, and nothing was pushed onto the undo
    // stack on the way to the refusal.
    expect(editor.getPageSetup()).toEqual(DEFAULT_PAGE_SETUP);
    expect(store.getDocument().pageSetup).toBeUndefined();
    editor.dispose();
  });

  test('accepts a setup that leaves only a sliver of content', () => {
    // The guard rejects a *closed* box, not a small one — 816 px wide with
    // 815 px of margin still has a column to lay out in, and the ruler is
    // free to produce values this tight.
    const { editor } = setupEditor();

    editor.setPageSetup(withMargins({ top: 0, bottom: 0, left: 815, right: 0 }));

    expect(editor.getPageSetup().margins.left).toBe(815);
    editor.dispose();
  });

  test.each([
    ['no paperSize', { orientation: 'portrait' as const, margins: SQUARE }],
    ['no margins', { paperSize: PAPER_SIZES.LETTER, orientation: 'portrait' as const }],
    ['neither', { orientation: 'portrait' as const }],
    ['nothing at all', {}],
  ])('refuses a setup with %s as a RangeError, not a TypeError', (_label, setup) => {
    // `setPageSetup` is public and its argument arrives from a CLI, a test or
    // a future panel as easily as from the dialog. A missing sub-object is
    // the same class of mistake as a negative margin — bad geometry — and it
    // must be reported the same way. Reading through to `setup.paperSize.
    // width` first throws a TypeError, which no caller can tell apart from a
    // bug inside the editor.
    const { editor, store } = setupEditor();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => editor.setPageSetup(setup as any)).toThrow(RangeError);

    expect(store.getDocument().pageSetup).toBeUndefined();
    editor.dispose();
  });

  test('refuses a setup the resolver would silently rescale', () => {
    // The assert and `resolvePageSetup`'s clamp have to agree on where the
    // floor is, or the write path contradicts its own rationale: the assert
    // says it "throws rather than clamping" precisely so a caller is never
    // handed a different page than it asked for, and then `writePageSetup`
    // stores `resolvePageSetup(setup)`. In the sub-pixel band between the two
    // — the box is open, but narrower than the resolver's one-pixel minimum —
    // a deliberate write passed the assert and was then quietly rescaled.
    const { editor, store } = setupEditor();

    // 816 px wide, 815.5 px of margin: > 0 left over, but < 1 px.
    const sliver = withMargins({ top: 0, bottom: 0, left: 815.5, right: 0 });
    expect(() => editor.setPageSetup(sliver)).toThrow(RangeError);
    expect(store.getDocument().pageSetup).toBeUndefined();

    editor.dispose();
  });

  test('stores exactly the geometry it accepted', () => {
    // The other half of the same invariant: anything that clears the assert
    // must survive the resolver unchanged.
    const { editor } = setupEditor();

    const accepted = withMargins({ top: 0, bottom: 0, left: 815, right: 0 });
    editor.setPageSetup(accepted);

    expect(editor.getPageSetup()).toEqual(accepted);
    editor.dispose();
  });

  test('measures the room against the effective, rotated page box', () => {
    // Landscape swaps the page box: Letter is 816 × 1056 portrait and
    // 1056 × 816 landscape. Vertical margins of 500 + 500 close the landscape
    // box (1000 ≥ 816) while leaving 56 px in the portrait one, so a check
    // written against the stored dimensions rather than the effective ones
    // would let the unlayoutable case through.
    const { editor } = setupEditor();

    const landscape = {
      paperSize: PAPER_SIZES.LETTER,
      orientation: 'landscape' as const,
      margins: { top: 500, bottom: 500, left: 96, right: 96 },
    };
    expect(() => editor.setPageSetup(landscape)).toThrow(RangeError);

    // The same margins in portrait (1056 px tall) are fine.
    editor.setPageSetup({ ...landscape, orientation: 'portrait' });
    expect(editor.getPageSetup().margins.top).toBe(500);
    editor.dispose();
  });

  test('the store handed out by getStore() enforces the same geometry', () => {
    // `getStore()` is public and already used from the frontend, so the store
    // it returns is a second way to reach `setPageSetup` — one that would
    // walk straight past the guard above and persist a closed content box
    // into the CRDT for every collaborator. The invariant belongs to the
    // editor, not to one method on it.
    //
    // Geometry is the whole reason the wrapper exists; it guards no other
    // member of `DocStore` and is not an access-control boundary (issue #989).
    const { editor, store } = setupEditor();

    const closed = withMargins({ top: 0, bottom: 0, left: 816, right: 0 });
    expect(() => editor.getStore().setPageSetup(closed)).toThrow(RangeError);
    expect(store.getDocument().pageSetup).toBeUndefined();

    // Still a working store otherwise: geometry a layout pass can consume
    // goes through, and every other member delegates to the real store.
    const accepted = withMargins({ top: 48, bottom: 48, left: 72, right: 72 });
    editor.getStore().setPageSetup(accepted);
    expect(store.getDocument().pageSetup?.margins.left).toBe(72);
    expect(editor.getStore().getDocument().blocks[0].id).toBe('b1');
    // Bound members keep a stable identity across reads, so a caller that
    // holds on to one is holding the same function the next read returns.
    expect(editor.getStore().canUndo).toBe(editor.getStore().canUndo);

    editor.dispose();
  });
});

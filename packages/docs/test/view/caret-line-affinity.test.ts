// @vitest-environment jsdom
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { MemDocStore } from '../../src/store/memory.js';
import { initialize, type EditorAPI } from '../../src/view/editor.js';
import { normalizeBlockStyle } from '../../src/model/types.js';
import type { Block, DocPosition, DocRange } from '../../src/model/types.js';

const EMPTY_BLOCK_STYLE = normalizeBlockStyle({});

/**
 * Caret `lineAffinity` end-to-end through the real editor — the first docs
 * test that builds a `TextEditor` and drives keyboard events at it.
 *
 * The gap this closes (issue #933): `selection-line-affinity.test.ts` calls
 * `computeSelectionRects` with hand-built positions, so nothing failed when a
 * *call site* stopped attaching the affinity. Three had: the caret kept it in
 * a field beside `position` (so only mouse-derived carets ever published one),
 * peer caret rendering hardcoded `'backward'`, and the history presence write
 * republished `{blockId, offset}`.
 *
 * These tests assert what leaves the editor — the position handed to
 * `onCursorMove` (which is what presence publishes), the caret rebuilt by the
 * undo/redo presence restore, and the peer caret pixels from
 * `getPeerCursorPixels()` — rather than any internal field.
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

/** A paragraph long enough to wrap onto several visual lines. */
const WRAPPED_TEXT = ('lorem ipsum dolor sit amet '.repeat(12)).trim();

/**
 * A `MemDocStore` that also answers the two optional presence hooks the
 * editor's undo/redo caret restore reads. That restore is gated on
 * `'getPresenceCursorPos' in docStore`, and only `YorkieDocStore`
 * implements it in production — so without a store that has it, the branch
 * is unreachable from a docs-package test and the affinity it carries is
 * unasserted.
 */
class PresenceMemDocStore extends MemDocStore {
  presenceCursorPos: DocPosition | undefined;
  presenceSelection: DocRange | undefined;

  getPresenceCursorPos(): DocPosition | undefined {
    return this.presenceCursorPos;
  }

  getPresenceSelection(): DocRange | undefined {
    return this.presenceSelection;
  }
}

function setupEditor(): {
  editor: EditorAPI;
  container: HTMLElement;
  store: PresenceMemDocStore;
} {
  const block: Block = {
    id: 'b1',
    type: 'paragraph',
    inlines: [{ text: WRAPPED_TEXT, style: { fontFamily: 'Arial', fontSize: 12 } }],
    style: EMPTY_BLOCK_STYLE,
  };
  const store = new PresenceMemDocStore();
  store.setDocument({ blocks: [block] });
  const container = document.createElement('div');
  document.body.appendChild(container);
  return { editor: initialize(container, store), container, store };
}

/**
 * Drive the caret to the start of a continuation visual line — a real wrap
 * boundary, the only kind of offset where the reading decides which of two
 * visual lines the caret is drawn on.
 */
function wrapBoundary(editor: EditorAPI, container: HTMLElement): number {
  caretAt(editor, 0);
  press(container, 'ArrowDown');
  press(container, 'Home');
  const offset = editor._getCursorForTest().offset;
  expect(offset).toBeGreaterThan(0);
  return offset;
}

/** Send a key through the real `TextEditor` keydown handler. */
function press(container: HTMLElement, key: string, shiftKey = false): void {
  const textarea = container.querySelector('textarea');
  if (!textarea) throw new Error('editor did not create its hidden textarea');
  textarea.dispatchEvent(
    new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }),
  );
}

function caretAt(editor: EditorAPI, offset: number): void {
  const pos: DocPosition = { blockId: 'b1', offset };
  editor._setSelectionForTest({ anchor: pos, focus: pos });
}

describe('caret lineAffinity reaches presence', () => {
  beforeEach(() => {
    installCanvasShim();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('the caret position always states its reading', () => {
    const { editor, container } = setupEditor();
    // The affinity has to be *on the position*, because that is the object
    // presence, history and rendering are handed. A position with none reads
    // as 'backward', so a caret that carried nothing was indistinguishable
    // from one that had been read backwards on purpose.
    caretAt(editor, 5);
    expect(editor._getCursorForTest().lineAffinity).toBe('backward');
    // Rightward motion always reads forward (it lands on the far side of the
    // offset it crossed), which only matters when that offset is a wrap
    // boundary — but the caret states it either way.
    press(container, 'ArrowRight');
    expect(editor._getCursorForTest().lineAffinity).toBe('forward');
    editor.dispose();
  });

  test('Home on a wrapped line publishes forward affinity', () => {
    const { editor, container } = setupEditor();
    const seen: DocPosition[] = [];
    editor.onCursorMove((pos) => seen.push(pos));

    // Down then Home puts the caret on the start of a *continuation* visual
    // line — a real wrap boundary, where the reading is what decides which
    // of two visual lines the caret is drawn on.
    caretAt(editor, 0);
    press(container, 'ArrowDown');
    press(container, 'Home');

    const caret = editor._getCursorForTest();
    expect(caret.offset).toBeGreaterThan(0);
    expect(caret.lineAffinity).toBe('forward');

    // What presence publishes is the position handed to onCursorMove: before
    // #933 the affinity lived beside `position`, so this arrived without it
    // and every Home / arrow caret degraded to the default on peer screens.
    const published = seen[seen.length - 1];
    expect(published.offset).toBe(caret.offset);
    expect(published.lineAffinity).toBe('forward');

    editor.dispose();
  });

  test('shift+Home publishes the same affinity on the selection focus', () => {
    const { editor, container } = setupEditor();
    const seen: Array<DocRange | null | undefined> = [];
    editor.onCursorMove((_pos, sel) => seen.push(sel));

    // ArrowDown from offset 0 lands on the start of the next visual line;
    // start the selection a few characters into it so shift+Home extends
    // back to that wrap boundary instead of collapsing onto it.
    caretAt(editor, 0);
    press(container, 'ArrowDown');
    const lineStart = editor._getCursorForTest().offset;
    expect(lineStart).toBeGreaterThan(0);
    caretAt(editor, lineStart + 5);
    press(container, 'Home', true);

    const sel = seen.filter((s): s is DocRange => !!s).pop();
    expect(sel).toBeDefined();
    expect(sel!.focus.offset).toBe(lineStart);
    expect(sel!.focus.lineAffinity).toBe('forward');

    editor.dispose();
  });
});

describe('undo/redo restores the caret reading from presence', () => {
  beforeEach(() => {
    installCanvasShim();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('undo rebuilds the caret with the restored affinity', () => {
    const { editor, container, store } = setupEditor();
    const boundary = wrapBoundary(editor, container);

    // Park the caret away from the boundary with the opposite reading, so a
    // restore that dropped the affinity would be visible as 'backward'
    // rather than hidden behind whatever the caret already had.
    caretAt(editor, 0);
    expect(editor._getCursorForTest().lineAffinity).toBe('backward');

    // What Yorkie hands back after undo: the caret the mutation recorded,
    // reading included.
    store.presenceCursorPos = {
      blockId: 'b1',
      offset: boundary,
      lineAffinity: 'forward',
    };
    store.snapshot();
    editor.undo();

    const caret = editor._getCursorForTest();
    expect(caret.offset).toBe(boundary);
    // Before #933 the restore rebuilt `{blockId, offset}` from scratch, so
    // every undo re-collapsed a wrap-boundary caret onto the previous
    // visual line even though presence had stored the forward reading.
    expect(caret.lineAffinity).toBe('forward');

    editor.dispose();
  });

  test('redo rebuilds the caret with the restored affinity', () => {
    const { editor, container, store } = setupEditor();
    const boundary = wrapBoundary(editor, container);
    caretAt(editor, 0);

    store.snapshot();
    editor.undo();
    store.presenceCursorPos = {
      blockId: 'b1',
      offset: boundary,
      lineAffinity: 'forward',
    };
    editor.redo();

    const caret = editor._getCursorForTest();
    expect(caret.offset).toBe(boundary);
    expect(caret.lineAffinity).toBe('forward');

    editor.dispose();
  });

  test('a restored caret past the end of its block is still clamped', () => {
    const { editor, store } = setupEditor();
    caretAt(editor, 0);

    // The restore spreads the whole restored position and then overrides
    // `offset` with the clamped one; pin that order, because spreading last
    // would silently reinstate the out-of-range offset.
    store.presenceCursorPos = {
      blockId: 'b1',
      offset: WRAPPED_TEXT.length + 50,
      lineAffinity: 'forward',
    };
    store.snapshot();
    editor.undo();

    const caret = editor._getCursorForTest();
    expect(caret.offset).toBe(WRAPPED_TEXT.length);
    expect(caret.lineAffinity).toBe('forward');

    editor.dispose();
  });
});

describe('peer caret honours the peer position affinity', () => {
  beforeEach(() => {
    installCanvasShim();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('two peers on the same wrap boundary render a line apart', () => {
    const { editor, container } = setupEditor();

    // Find a real wrap boundary the same way the caret does: the start of a
    // continuation visual line.
    caretAt(editor, 0);
    press(container, 'ArrowDown');
    press(container, 'Home');
    const boundary = editor._getCursorForTest().offset;
    expect(boundary).toBeGreaterThan(0);

    const peer = (clientID: string, lineAffinity?: 'forward' | 'backward') => ({
      clientID,
      position: { blockId: 'b1', offset: boundary, ...(lineAffinity ? { lineAffinity } : {}) },
      color: '#ff0000',
      username: clientID,
      labelVisible: false,
    });

    editor.setPeerCursors([peer('fwd', 'forward'), peer('bwd', 'backward'), peer('none')]);
    const pixels = editor.getPeerCursorPixels();
    const yOf = (clientID: string) => pixels.find((p) => p.clientID === clientID)?.y;

    expect(pixels).toHaveLength(3);
    // The forward peer reads the boundary as the start of the next visual
    // line, so it renders exactly one line below the backward one. Hardcoding
    // 'backward' at the peer caret site collapsed these onto one line while
    // the peer's own highlight still bracketed the wrapped line.
    expect(yOf('fwd')).toBeGreaterThan(yOf('bwd')!);
    // A mixed-version peer publishing no affinity keeps the old reading.
    expect(yOf('none')).toBe(yOf('bwd'));

    editor.dispose();
  });
});

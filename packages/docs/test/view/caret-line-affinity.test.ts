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
 * `onCursorMove` (which is what presence publishes) and the peer caret pixels
 * from `getPeerCursorPixels()` — rather than any internal field.
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

function setupEditor(): { editor: EditorAPI; container: HTMLElement } {
  const block: Block = {
    id: 'b1',
    type: 'paragraph',
    inlines: [{ text: WRAPPED_TEXT, style: { fontFamily: 'Arial', fontSize: 12 } }],
    style: EMPTY_BLOCK_STYLE,
  };
  const store = new MemDocStore();
  store.setDocument({ blocks: [block] });
  const container = document.createElement('div');
  document.body.appendChild(container);
  return { editor: initialize(container, store), container };
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
    caretAt(editor, 5);
    expect(editor._getCursorForTest().lineAffinity).toBe('backward');
    press(container, 'ArrowRight');
    // Moving right lands on the far side of the offset it crossed, which at
    // a wrap boundary is the start of the next visual line.
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

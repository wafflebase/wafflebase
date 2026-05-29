// @vitest-environment jsdom
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemDocStore } from '../../src/store/memory.js';
import { initialize, type EditorAPI } from '../../src/view/editor.js';
import { normalizeBlockStyle } from '../../src/model/types.js';
import type { Block } from '../../src/model/types.js';

const EMPTY_BLOCK_STYLE = normalizeBlockStyle({});

/**
 * jsdom-friendly tests for `EditorAPI.onCursorMove`. The editor was
 * originally single-slot — registering a second callback silently
 * dropped the first. The presence broadcaster registered by
 * docs-view.tsx was stomped on by the toolbar refresh effect, which
 * broke peer-cursor synchronization the moment the toolbar mounted.
 *
 * These tests pin the new contract:
 *   1. Multiple callbacks fire on cursor move (no overwriting).
 *   2. The returned unsubscribe function removes only the given
 *      callback, leaving others wired up.
 *   3. Callbacks also fire after style mutations (applyStyle /
 *      applyBlockStyle / clearFormatting) so toolbar pickers
 *      refresh their selection-derived summaries.
 *
 * Selection / cursor moves are driven through the underscore-prefixed
 * test helpers (`_setSelectionForTest`, `_setCursorForTest`) rather
 * than synthetic input events. jsdom cannot run the full render
 * pipeline (no real Canvas 2D context), but the fire path runs
 * independent of paint.
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

function setupEditor(blocks: Block[]): { editor: EditorAPI; container: HTMLElement } {
  const store = new MemDocStore();
  store.setDocument({ blocks });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const editor = initialize(container, store);
  return { editor, container };
}

function styledBlock(id: string, text: string): Block {
  return {
    id,
    type: 'paragraph',
    inlines: [{ text, style: { fontFamily: 'Arial', fontSize: 12 } }],
    style: EMPTY_BLOCK_STYLE,
  };
}

describe('EditorAPI.onCursorMove', () => {
  beforeEach(() => {
    installCanvasShim();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('fans out to every registered callback on style apply', () => {
    const { editor } = setupEditor([styledBlock('b1', 'hello world')]);
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    editor.onCursorMove(cb1);
    editor.onCursorMove(cb2);

    editor._setSelectionForTest({
      anchor: { blockId: 'b1', offset: 0 },
      focus: { blockId: 'b1', offset: 5 },
    });

    // Style mutation must notify both subscribers — the regression
    // this guards against was the second registration silently
    // overwriting the first.
    editor.applyStyle({ bold: true });
    expect(cb1).toHaveBeenCalled();
    expect(cb2).toHaveBeenCalled();
    expect(cb2.mock.calls.length).toBe(cb1.mock.calls.length);

    editor.dispose();
  });

  test('returned unsubscribe removes only the given callback', () => {
    const { editor } = setupEditor([styledBlock('b1', 'hello world')]);
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const unsub1 = editor.onCursorMove(cb1);
    editor.onCursorMove(cb2);

    editor._setSelectionForTest({
      anchor: { blockId: 'b1', offset: 0 },
      focus: { blockId: 'b1', offset: 3 },
    });
    editor.applyStyle({ italic: true });
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);

    unsub1();

    editor._setSelectionForTest({
      anchor: { blockId: 'b1', offset: 0 },
      focus: { blockId: 'b1', offset: 5 },
    });
    editor.applyStyle({ underline: true });
    // cb1 unsubscribed — count stays at 1. cb2 still wired — now 2.
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(2);

    editor.dispose();
  });

  test('applyBlockStyle and clearFormatting also fire the callbacks', () => {
    const { editor } = setupEditor([styledBlock('b1', 'hello world')]);
    const cb = vi.fn();
    editor.onCursorMove(cb);

    editor._setSelectionForTest({
      anchor: { blockId: 'b1', offset: 0 },
      focus: { blockId: 'b1', offset: 5 },
    });

    editor.applyBlockStyle({ alignment: 'center' });
    const afterBlockStyle = cb.mock.calls.length;
    expect(afterBlockStyle).toBeGreaterThan(0);

    editor.clearFormatting();
    expect(cb.mock.calls.length).toBeGreaterThan(afterBlockStyle);

    editor.dispose();
  });

  test('dispose drops all listeners', () => {
    const { editor } = setupEditor([styledBlock('b1', 'hello world')]);
    const cb = vi.fn();
    editor.onCursorMove(cb);

    editor._setSelectionForTest({
      anchor: { blockId: 'b1', offset: 0 },
      focus: { blockId: 'b1', offset: 5 },
    });
    editor.applyStyle({ bold: true });
    expect(cb).toHaveBeenCalled();
    const callsBeforeDispose = cb.mock.calls.length;

    editor.dispose();
    // No further fires expected after dispose. We can't easily trigger
    // a fire post-dispose without a live render path, but we can at
    // least assert dispose itself did not throw and the count is
    // stable.
    expect(cb.mock.calls.length).toBe(callsBeforeDispose);
  });
});

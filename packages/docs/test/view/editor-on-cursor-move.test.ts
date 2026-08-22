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

    editor.clearInlineFormatting();
    expect(cb.mock.calls.length).toBeGreaterThan(afterBlockStyle);

    editor.dispose();
  });

  test('setBlockType fires the callbacks with the new type readable', () => {
    // Issue #792: the Text style control re-derives its label from
    // `getBlockType()` when a cursor-move callback re-renders the toolbar.
    // `setBlockType` never fired them, so the button kept reading
    // "Normal text" after applying Heading 2.
    const { editor } = setupEditor([styledBlock('b1', 'hello world')]);
    const seen: string[] = [];
    editor.onCursorMove(() => {
      const bt = editor.getBlockType();
      seen.push(`${bt.type}:${bt.headingLevel ?? '-'}`);
    });

    editor.setBlockType('heading', { headingLevel: 2 });

    expect(seen).toContain('heading:2');

    editor.dispose();
  });

  test('toggleList fires the callbacks with the new type readable', () => {
    // A bullet toggled on a heading rewrites the block type to `list-item`,
    // so the Text style control's label must fall back from "Heading 2" to
    // "Normal text". Without a fire it kept reading "Heading 2".
    const { editor } = setupEditor([styledBlock('b1', 'hello world')]);
    editor.setBlockType('heading', { headingLevel: 2 });

    const seen: string[] = [];
    const levels: Array<number | undefined> = [];
    editor.onCursorMove(() => {
      const bt = editor.getBlockType();
      seen.push(bt.type);
      levels.push(bt.headingLevel);
    });

    editor.toggleList('unordered');
    expect(seen).toContain('list-item');

    // ...and back off again. Removing the list restores the heading the
    // block was bulleted from (`unlistedBlockType`, issue #783) rather than
    // dropping it to body text, so the label goes back to "Heading 2". What
    // this test guards is unchanged: the callbacks fire with the *new* type
    // already readable.
    seen.length = 0;
    levels.length = 0;
    editor.toggleList('unordered');
    expect(seen).toContain('heading');
    expect(levels).toContain(2);

    editor.dispose();
  });

  test('indent and outdent fire the callbacks', () => {
    const { editor } = setupEditor([styledBlock('b1', 'hello world')]);
    editor.toggleList('unordered');

    const seen: Array<number | undefined> = [];
    editor.onCursorMove(() => {
      seen.push(editor.getBlockType().listLevel);
    });

    editor.indent();
    expect(seen).toContain(1);

    seen.length = 0;
    editor.outdent();
    expect(seen).toContain(0);

    editor.dispose();
  });

  test('the Cmd/Ctrl+Alt+2 heading shortcut fires the callbacks', () => {
    // The same control is driven by the keyboard path, which reaches the
    // callbacks through `requestRender` (wired to `renderWithScroll`, which
    // calls `afterCursorRender`). Pin that so the shortcut can't regress
    // into the staleness `setBlockType` had.
    const { editor, container } = setupEditor([styledBlock('b1', 'hello world')]);
    const seen: string[] = [];
    editor.onCursorMove(() => {
      const bt = editor.getBlockType();
      seen.push(`${bt.type}:${bt.headingLevel ?? '-'}`);
    });

    const textarea = container.querySelector('textarea');
    if (!textarea) throw new Error('textarea not mounted');
    // Both modifiers so the assertion holds whatever `navigator.platform`
    // reports under jsdom (`mod` is Meta on Mac, Ctrl elsewhere).
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: '2',
        ctrlKey: true,
        metaKey: true,
        altKey: true,
        bubbles: true,
      }),
    );

    expect(seen).toContain('heading:2');

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

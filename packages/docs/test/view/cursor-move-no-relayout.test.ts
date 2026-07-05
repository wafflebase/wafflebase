// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initialize, type EditorAPI } from '../../src/view/editor.js';
import { MemDocStore } from '../../src/store/memory.js';
import { createEmptyBlock } from '../../src/model/types.js';
import type { Block } from '../../src/model/types.js';

/**
 * Perf guard for issue: cursor movement forces a full-document re-layout.
 *
 * Pure caret navigation (arrow keys, Home/End) changes no document content,
 * so it must paint-only and reuse the cached layout. Before the fix, every
 * arrow keypress routed through a full `render()` → `recomputeLayout()` with
 * `dirtyBlockIds === undefined`, which re-measured every block in the
 * document. We assert here that a caret move does not re-measure the whole
 * body — the number of `measureText` calls during an ArrowRight must stay
 * small and independent of block count.
 *
 * `CanvasTextMeasurer` measures via an `OffscreenCanvas` context, so the
 * counter lives on the OffscreenCanvas stub (not the visible-canvas shim).
 */

let measureTextCalls = 0;

function installCanvasShim(): void {
  const measureText = (text: string) => {
    measureTextCalls++;
    return {
      width: typeof text === 'string' ? text.length * 8 : 0,
      actualBoundingBoxAscent: 8,
      actualBoundingBoxDescent: 2,
    };
  };
  const ctxHandler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === 'measureText') return measureText;
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
  // The measurer prefers OffscreenCanvas; route its measureText through the
  // same counter so layout measurement is what we observe.
  (globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
    constructor(public width: number, public height: number) {}
    getContext(): unknown {
      return { font: '12px sans-serif', measureText };
    }
  };
}

function makeBlock(text: string): Block {
  const block = createEmptyBlock();
  block.inlines = [{ text, style: {} }];
  return block;
}

describe('docs editor — cursor movement does not re-layout the whole document', () => {
  let container: HTMLElement;
  let editor: EditorAPI;
  let origGetContext: HTMLCanvasElement['getContext'];
  let origRAF: typeof window.requestAnimationFrame;
  let origResizeObserver: unknown;
  let origOffscreenCanvas: unknown;

  beforeEach(() => {
    origGetContext = HTMLCanvasElement.prototype.getContext;
    origRAF = window.requestAnimationFrame;
    origResizeObserver = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    origOffscreenCanvas = (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas;
    installCanvasShim();
    window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
      queueMicrotask(() => cb(performance.now()));
      return 0;
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    const store = new MemDocStore();
    // A multi-block body: a full re-layout would measure every block.
    const blocks: Block[] = [];
    for (let i = 0; i < 40; i++) {
      blocks.push(makeBlock(`Paragraph number ${i} with several words to measure.`));
    }
    store.setDocument({ blocks });
    editor = initialize(container, store);
  });

  afterEach(() => {
    editor.dispose();
    document.body.removeChild(container);
    HTMLCanvasElement.prototype.getContext = origGetContext;
    window.requestAnimationFrame = origRAF;
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = origResizeObserver;
    (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = origOffscreenCanvas;
  });

  function textarea(): HTMLTextAreaElement {
    const el = container.querySelector('textarea');
    if (!el) throw new Error('textarea not mounted');
    return el;
  }

  function pressArrow(key: string): void {
    textarea().dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
  }

  it('ArrowRight does not re-measure every block', () => {
    // Cursor starts at block 0, offset 0 (set by initialize). Reset the
    // counter after the initial full layout so we observe only the move.
    measureTextCalls = 0;
    pressArrow('ArrowRight');

    // A paint-only caret move measures at most the caret's own run. A full
    // re-layout of 40 multi-word blocks measures hundreds of times. 40 is a
    // generous ceiling that the caret-only path clears and the full-relayout
    // path blows past.
    expect(measureTextCalls).toBeLessThan(40);
  });

  it('ArrowDown does not re-measure every block', () => {
    measureTextCalls = 0;
    pressArrow('ArrowDown');
    expect(measureTextCalls).toBeLessThan(40);
  });
});

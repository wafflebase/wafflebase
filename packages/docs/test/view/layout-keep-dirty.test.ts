// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initialize, type EditorAPI } from '../../src/view/editor.js';
import { clearMeasureCache } from '../../src/view/layout.js';
import { MemDocStore } from '../../src/store/memory.js';
import { createEmptyBlock } from '../../src/model/types.js';
import type { Block } from '../../src/model/types.js';

/**
 * Perf guard for `recomputeLayout({ keepDirty })`, the sibling of
 * `cursor-move-no-relayout.test.ts`.
 *
 * Every keystroke runs inside an undo unit (`TextEditor.withUndoUnit`), and
 * the unit holds its paint until the batch commits — but the rest of the unit
 * still reads `getLayout()`, so `requestRender()` calls
 * `requestLayoutRefresh()` mid-unit. `recomputeLayout` normally ends by
 * clearing `dirtyBlockIds`, and `computeLayout` only consults its cache while
 * that set is non-null, so without `keepDirty` that extra pass would leave the
 * unit's own deferred paint re-measuring the WHOLE document on every single
 * character typed.
 *
 * Observed through `measureText`, the same counter the cursor-move guard uses:
 * a full pass over the body measures every block, an incremental one measures
 * the caret's block alone. `clearMeasureCache()` runs first — `layout.ts`
 * memoizes each (text, font) width process-wide, so a warm cache would let a
 * full second pass re-walk all 40 blocks for free and the two paths would be
 * indistinguishable. Cold, the walk is what costs.
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

describe('docs editor — an in-unit layout refresh stays incremental', () => {
  let container: HTMLElement;
  let editor: EditorAPI;
  let fullLayoutCost = 0;
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
    const blocks: Block[] = [];
    for (let i = 0; i < 40; i++) {
      blocks.push(makeBlock(`Paragraph number ${i} with several words to measure.`));
    }
    store.setDocument({ blocks });
    clearMeasureCache();
    measureTextCalls = 0;
    editor = initialize(container, store);
    // What one full pass over this body costs, measured rather than guessed —
    // it is the number a lost dirty set brings back.
    fullLayoutCost = measureTextCalls;
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

  function type(text: string): void {
    const ta = textarea();
    ta.value = text;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  it('typing a character does not re-measure every block', () => {
    // A full pass over 40 multi-word paragraphs is the expensive thing; the
    // fixture is only meaningful if it costs a lot more than one block.
    expect(fullLayoutCost).toBeGreaterThan(40);
    // Cold again, so the second pass cannot ride the memo of the first.
    clearMeasureCache();
    measureTextCalls = 0;

    type('x');

    // The caret sits in block 0, so the in-unit refresh, the unit's deferred
    // paint and the paint itself may all measure that block — but none of
    // them may walk the other 39. Half a full pass is the line: with
    // `keepDirty` this costs well under a third of one (58 of 204 as
    // written), and with the dirty set dropped it is a whole extra pass on
    // top (216).
    expect(measureTextCalls).toBeLessThan(fullLayoutCost / 2);
  });
});

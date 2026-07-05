// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initialize, type EditorAPI } from '../../src/view/editor.js';
import { MemDocStore } from '../../src/store/memory.js';
import { createEmptyBlock } from '../../src/model/types.js';
import type { Block } from '../../src/model/types.js';

/**
 * The text-measurement cache (word widths + char offsets) is keyed by
 * (font, text) with no load-state key, so the initial layout of a not-yet-
 * loaded web font pins run positions and caret offsets against the fallback
 * face's metrics. When the real face loads asynchronously, docs must clear
 * the cache and re-layout — otherwise the layout and caret stay on fallback
 * metrics and drift from the painted glyphs until a reload. Slides already
 * wires this via a `document.fonts` `loadingdone` listener; this guards the
 * matching docs wiring.
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

describe('docs editor — clears the measure cache and re-layouts on font load', () => {
  let container: HTMLElement;
  let editor: EditorAPI;
  let origGetContext: HTMLCanvasElement['getContext'];
  let origRAF: typeof window.requestAnimationFrame;
  let origResizeObserver: unknown;
  let origOffscreenCanvas: unknown;
  let origFonts: PropertyDescriptor | undefined;

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
    // jsdom omits document.fonts; install a stub EventTarget so the editor's
    // listener wiring runs the same addEventListener path as the browser.
    origFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
    Object.defineProperty(document, 'fonts', {
      value: new EventTarget(),
      configurable: true,
      writable: true,
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    const store = new MemDocStore();
    store.setDocument({
      blocks: [
        makeBlock('Paragraph one with several words to measure'),
        makeBlock('Paragraph two also with several words here'),
      ],
    });
    editor = initialize(container, store);
  });

  afterEach(() => {
    editor.dispose();
    document.body.removeChild(container);
    HTMLCanvasElement.prototype.getContext = origGetContext;
    window.requestAnimationFrame = origRAF;
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = origResizeObserver;
    (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = origOffscreenCanvas;
    if (origFonts) {
      Object.defineProperty(document, 'fonts', origFonts);
    } else {
      // @ts-expect-error — removing a configurable stub we installed.
      delete document.fonts;
    }
  });

  it('re-measures the document when a web font finishes loading', () => {
    // Caches are warm from the initial render. A no-op event would leave the
    // stale fallback-metric layout in place (0 re-measures).
    measureTextCalls = 0;
    document.fonts.dispatchEvent(new Event('loadingdone'));
    expect(measureTextCalls).toBeGreaterThan(0);
  });

  it('stops re-measuring after dispose (listener removed)', () => {
    editor.dispose();
    measureTextCalls = 0;
    document.fonts.dispatchEvent(new Event('loadingdone'));
    expect(measureTextCalls).toBe(0);
    // Re-create so afterEach's dispose() has a live editor to tear down.
    editor = initialize(container, new MemDocStore());
  });
});

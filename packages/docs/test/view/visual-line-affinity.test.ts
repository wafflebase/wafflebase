// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initialize, type EditorAPI } from '../../src/view/editor.js';
import { MemDocStore } from '../../src/store/memory.js';
import { createEmptyBlock, getBlockText } from '../../src/model/types.js';
import type { Block } from '../../src/model/types.js';

/**
 * Issue #67 — `getVisualLineRange` / `getVisualLineStart` /
 * `getVisualLineEnd` resolved a wrap-boundary offset by offset alone,
 * always picking the *later* visual line, ignoring `cursor.lineAffinity`.
 *
 * The boundary is reachable in one keystroke on text that has no space to
 * wrap at: `layoutBlock` falls back to character-level wrapping for a
 * token wider than the line, so `End` lands exactly on the boundary (no
 * trailing space to trim) with `'backward'` affinity — the caret is drawn
 * at the end of the first visual line. Before the fix, `Home` then
 * resolved that offset to the *second* line and "moved" to the same
 * offset (visibly stuck), `End` again walked one line further down, and
 * Cmd+Backspace deleted every earlier visual line instead of one.
 */

function installCanvasShim(): void {
  // 8px per character: a stable, integral advance so the wrap boundary is
  // deterministic without the test needing to know where it is.
  const measureText = (text: string) => ({
    width: typeof text === 'string' ? text.length * 8 : 0,
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

/** A single unbroken token — wraps at character granularity. */
const TEXT = 'x'.repeat(400);

function makeBlock(text: string): Block {
  const block = createEmptyBlock();
  block.inlines = [{ text, style: {} }];
  return block;
}

describe('docs editor — Home / End / Cmd+Backspace at a wrap boundary', () => {
  let container: HTMLElement;
  let editor: EditorAPI;
  let cursorOffset = 0;
  let origGetContext: HTMLCanvasElement['getContext'];
  let origRAF: typeof window.requestAnimationFrame;
  let origResizeObserver: unknown;
  let origOffscreenCanvas: unknown;
  let origPlatform: PropertyDescriptor | undefined;

  beforeEach(() => {
    origGetContext = HTMLCanvasElement.prototype.getContext;
    origRAF = window.requestAnimationFrame;
    origResizeObserver = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    origOffscreenCanvas = (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas;
    // Cmd+Backspace (delete to visual line start) is Mac-only in
    // handleKeyDown, which reads navigator.platform on each keypress.
    origPlatform = Object.getOwnPropertyDescriptor(window.navigator, 'platform');
    Object.defineProperty(window.navigator, 'platform', {
      value: 'MacIntel',
      configurable: true,
    });
    installCanvasShim();
    window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
      queueMicrotask(() => cb(performance.now()));
      return 0;
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    const store = new MemDocStore();
    store.setDocument({ blocks: [makeBlock(TEXT)] });
    editor = initialize(container, store);
    cursorOffset = 0;
    editor.onCursorMove((pos) => {
      cursorOffset = pos.offset;
    });
  });

  afterEach(() => {
    editor.dispose();
    document.body.removeChild(container);
    HTMLCanvasElement.prototype.getContext = origGetContext;
    window.requestAnimationFrame = origRAF;
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = origResizeObserver;
    (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = origOffscreenCanvas;
    if (origPlatform) {
      Object.defineProperty(window.navigator, 'platform', origPlatform);
    } else {
      // jsdom defines `platform` on Navigator.prototype, so there was no
      // own descriptor to put back — drop the stub instead of leaving a
      // Mac platform on the navigator for whatever runs next.
      delete (window.navigator as unknown as { platform?: string }).platform;
    }
  });

  function textarea(): HTMLTextAreaElement {
    const el = container.querySelector('textarea');
    if (!el) throw new Error('textarea not mounted');
    return el;
  }

  /** Dispatch a keydown and flush the rAF-scheduled render it queues. */
  async function press(key: string, init: KeyboardEventInit = {}): Promise<void> {
    textarea().dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  function blockText(): string {
    return getBlockText(editor.getDoc().document.blocks[0]);
  }

  it('End lands exactly on the wrap boundary of a character-wrapped line', async () => {
    await press('End');
    // The block wrapped, and End stopped at the first line's end rather
    // than the end of the block.
    expect(cursorOffset).toBeGreaterThan(0);
    expect(cursorOffset).toBeLessThan(TEXT.length);
  });

  it('Home from a wrap boundary returns to the start of the caret line', async () => {
    await press('End');
    const boundary = cursorOffset;
    await press('Home');
    // Before the fix the boundary resolved to the second visual line, so
    // Home "moved" to the boundary itself and the caret never budged.
    expect(cursorOffset).toBe(0);
    expect(boundary).toBeGreaterThan(0);
  });

  it('End twice does not walk onto the next visual line', async () => {
    await press('End');
    const boundary = cursorOffset;
    await press('End');
    expect(cursorOffset).toBe(boundary);
  });

  it('Cmd+Backspace at a wrap boundary deletes only that visual line', async () => {
    await press('End');
    const firstBoundary = cursorOffset;
    // Step onto the second visual line, then run End again to reach its
    // boundary — the first line's start coincides with the block start,
    // so only a later line distinguishes "delete visual line" from
    // "delete to block start".
    await press('ArrowRight');
    await press('End');
    const secondBoundary = cursorOffset;
    expect(secondBoundary).toBeGreaterThan(firstBoundary);

    await press('Backspace', { metaKey: true });
    expect(blockText()).toHaveLength(TEXT.length - (secondBoundary - firstBoundary));
    expect(cursorOffset).toBe(firstBoundary);
  });
});

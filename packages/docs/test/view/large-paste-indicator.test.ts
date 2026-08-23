// @vitest-environment jsdom
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { MemDocStore } from '../../src/store/memory.js';
import { initialize, type EditorAPI } from '../../src/view/editor.js';
import { normalizeBlockStyle } from '../../src/model/types.js';
import type { Block } from '../../src/model/types.js';

/**
 * Busy indicator for large pastes.
 *
 * A big paste blocks the tab for seconds (measured: ~1.5 s at 4000 blocks,
 * ~3.8 s at 8000) across two synchronous halves — parsing and the write —
 * so nothing paints during it. The editor therefore offers the host a hook
 * *before parsing*, waits for a painted frame so whatever the host put up
 * actually appears, and only then does any work. Below the threshold the
 * whole path stays synchronous — no yield, no hook, no behavior change for
 * ordinary pastes.
 */

const EMPTY_BLOCK_STYLE = normalizeBlockStyle({});

/** `LARGE_PASTE_WEIGHT_THRESHOLD` in text-editor.ts — clipboard characters. */
const THRESHOLD = 400_000;

let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;
let originalResizeObserver: typeof globalThis.ResizeObserver | undefined;

function installCanvasShim(): void {
  originalGetContext = HTMLCanvasElement.prototype.getContext;
  originalResizeObserver = (globalThis as { ResizeObserver?: typeof globalThis.ResizeObserver })
    .ResizeObserver;
  const ctxHandler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === 'measureText') {
        return (text: string) => ({
          width: typeof text === 'string' ? text.length * 6 : 0,
          actualBoundingBoxAscent: 8,
          actualBoundingBoxDescent: 2,
        });
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

function setupEditor(): {
  editor: EditorAPI;
  textarea: HTMLTextAreaElement;
  store: MemDocStore;
} {
  const store = new MemDocStore();
  store.setDocument({
    blocks: [{ id: 'b1', type: 'paragraph', inlines: [{ text: 'seed', style: {} }], style: EMPTY_BLOCK_STYLE }] as Block[],
  });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const editor = initialize(container, store);
  const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
  editor._setSelectionForTest({
    anchor: { blockId: 'b1', offset: 4 },
    focus: { blockId: 'b1', offset: 4 },
  });
  return { editor, textarea, store };
}

/**
 * HTML of at least `chars` characters, as paragraphs — the shape a large
 * document paste arrives as.
 */
function htmlOfSize(chars: number): string {
  const parts: string[] = [];
  let total = 0;
  for (let i = 0; total < chars; i++) {
    const p = `<p>Paragraph ${i}</p>`;
    parts.push(p);
    total += p.length;
  }
  return parts.join('');
}

function dispatchHtmlPaste(textarea: HTMLTextAreaElement, html: string): void {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      types: ['text/html'],
      getData: (t: string) => (t === 'text/html' ? html : ''),
      items: [] as unknown[],
    },
  });
  textarea.dispatchEvent(event);
}

/**
 * Let the editor's `yieldToPaintedFrame()` resolve: one animation frame,
 * then the macrotask scheduled from inside it.
 */
function flushPaintedFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(() => setTimeout(resolve, 0), 0));
  });
}

describe('large paste busy indicator', () => {
  beforeEach(() => {
    installCanvasShim();
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
      originalResizeObserver;
    document.body.innerHTML = '';
  });

  test('a paste under the threshold never calls the handler and writes synchronously', () => {
    const { editor, textarea, store } = setupEditor();
    let calls = 0;
    editor.onLargePaste(() => {
      calls++;
      return () => {};
    });

    dispatchHtmlPaste(textarea, htmlOfSize(1_000));

    expect(calls).toBe(0);
    // No await: an ordinary paste must still be done when the event returns.
    expect(store.getDocument().blocks.length).toBeGreaterThan(5);
  });

  test('a paste at the threshold raises the indicator before parsing and dismisses it after the write', async () => {
    const { editor, textarea, store } = setupEditor();
    let raised = 0;
    let dismissed = 0;
    editor.onLargePaste(() => {
      raised++;
      return () => {
        dismissed++;
      };
    });

    dispatchHtmlPaste(textarea, htmlOfSize(THRESHOLD));

    // The indicator is up and nothing has been parsed or written yet — that
    // gap is the whole point, it is what lets the toast paint.
    expect(raised).toBe(1);
    expect(dismissed).toBe(0);
    expect(store.getDocument().blocks.length).toBe(1);

    await flushPaintedFrame();

    expect(dismissed).toBe(1);
    expect(store.getDocument().blocks.length).toBeGreaterThan(100);
  });

  test('input queued during the yield does not run against the pending write', async () => {
    const { editor, textarea, store } = setupEditor();
    editor.onLargePaste(() => () => {});

    dispatchHtmlPaste(textarea, htmlOfSize(THRESHOLD));

    // A keystroke lands in the gap; it must be dropped, not applied to a
    // caret the paste is about to move.
    textarea.value = 'X';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    expect(textarea.value).toBe('');

    await flushPaintedFrame();

    const text = store
      .getDocument()
      .blocks.map((b) => b.inlines.map((i) => i.text).join(''))
      .join('\n');
    expect(text).not.toContain('X');
  });

  test('a second paste during the yield is ignored', async () => {
    const { editor, textarea } = setupEditor();
    let calls = 0;
    editor.onLargePaste(() => {
      calls++;
      return () => {};
    });

    dispatchHtmlPaste(textarea, htmlOfSize(THRESHOLD));
    dispatchHtmlPaste(textarea, htmlOfSize(THRESHOLD));

    expect(calls).toBe(1);
    await flushPaintedFrame();
  });

  test('with no handler installed a huge paste still writes synchronously', () => {
    const { textarea, store } = setupEditor();

    dispatchHtmlPaste(textarea, htmlOfSize(THRESHOLD));

    expect(store.getDocument().blocks.length).toBeGreaterThan(100);
  });

  /**
   * Pins `yieldToPaintedFrame` against a "simplification" back to
   * `yieldToPaint`. Measured in Chromium, a bare `MessageChannel` macrotask
   * renders zero frames before a long synchronous block, so that swap would
   * ship an indicator nobody can see — and every other test here would stay
   * green, because a macrotask resolves either way. jsdom cannot prove a
   * paint, but it can prove rAF is in the chain: stub it out and the write
   * must not happen.
   */
  test('the wait goes through requestAnimationFrame, not just a macrotask', async () => {
    const realRaf = globalThis.requestAnimationFrame;
    const pending: FrameRequestCallback[] = [];
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      pending.push(cb);
      return pending.length;
    }) as typeof globalThis.requestAnimationFrame;
    try {
      const { editor, textarea, store } = setupEditor();
      editor.onLargePaste(() => () => {});

      dispatchHtmlPaste(textarea, htmlOfSize(THRESHOLD));

      // Drain every macrotask a MessageChannel-only wait would need.
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));

      expect(pending.length).toBeGreaterThan(0);
      expect(store.getDocument().blocks.length).toBe(1);

      // Releasing the frame lets the paste through.
      for (const cb of pending.splice(0)) cb(0);
      await new Promise((r) => setTimeout(r, 0));
      expect(store.getDocument().blocks.length).toBeGreaterThan(100);
    } finally {
      globalThis.requestAnimationFrame = realRaf;
    }
  });

  /**
   * Browsers pause rAF in a backgrounded tab — and backgrounding is exactly
   * what a user does when they expect a wait. Without the timeout fallback
   * the paste would never apply, the indicator would never come down, and
   * `pasting` would swallow input until the tab was refocused.
   */
  test('a frame that never arrives (hidden tab) still lets the paste through', async () => {
    const realRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (() =>
      0) as unknown as typeof globalThis.requestAnimationFrame;
    try {
      const { editor, textarea, store } = setupEditor();
      let dismissed = 0;
      editor.onLargePaste(() => () => {
        dismissed++;
      });

      dispatchHtmlPaste(textarea, htmlOfSize(THRESHOLD));
      await new Promise((r) => setTimeout(r, 250));

      expect(store.getDocument().blocks.length).toBeGreaterThan(100);
      expect(dismissed).toBe(1);
    } finally {
      globalThis.requestAnimationFrame = realRaf;
    }
  });

  /**
   * `handleKeyDown`'s `preventDefault()` does not suppress an IME: the
   * browser dispatches keydown with keyCode 229 and composes anyway. An
   * unguarded `compositionstart` runs `deleteSelection()` on the range the
   * pending paste is about to replace.
   */
  test('an IME composition started during the yield is refused', async () => {
    const { editor, textarea, store } = setupEditor();
    editor.onLargePaste(() => () => {});

    dispatchHtmlPaste(textarea, htmlOfSize(THRESHOLD));

    textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    textarea.dispatchEvent(
      new CompositionEvent('compositionend', { data: '한', bubbles: true }),
    );

    await flushPaintedFrame();

    const text = store
      .getDocument()
      .blocks.map((b) => b.inlines.map((i) => i.text).join(''))
      .join('\n');
    expect(text).not.toContain('한');
    expect(store.getDocument().blocks.length).toBeGreaterThan(100);
  });
});

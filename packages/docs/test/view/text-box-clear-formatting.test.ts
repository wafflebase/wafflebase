// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initializeTextBox, type TextBoxEditorAPI } from '../../src/view/text-box-editor.js';
import type { Block } from '../../src/model/types.js';

/**
 * The text-box half of the Clear-formatting link coverage — the docs half
 * lives in `editor-clear-formatting.test.ts`. `initializeTextBox` powers both
 * Slides text boxes and Slides table cells, and it routes
 * `clearInlineFormatting` through the same `CLEAR_INLINE_STYLE` constant the
 * full docs editor and the Cmd+\ shortcut use, so the "a hyperlink survives
 * Clear formatting" rule of issue #1051 has to hold here too.
 *
 * Mirrors the mount / commit harness of `text-box-link-trailing-edge.test.ts`.
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
      if (prop === 'canvas') return null;
      if (prop === 'font') return '12px sans-serif';
      return () => {};
    },
    set() {
      return true;
    },
  };
  const fakeCtx = new Proxy({}, ctxHandler) as unknown as CanvasRenderingContext2D;
  (HTMLCanvasElement.prototype as unknown as { getContext: (k: string) => unknown }).getContext =
    (kind: string) => (kind === '2d' ? fakeCtx : null);
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

describe('initializeTextBox — clear formatting keeps hyperlinks', () => {
  let container: HTMLElement;
  let canvas: HTMLCanvasElement;
  let api: TextBoxEditorAPI;
  let committed: Block[] | null;
  let origRAF: typeof window.requestAnimationFrame;

  beforeEach(() => {
    installCanvasShim();
    origRAF = window.requestAnimationFrame;
    window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
      queueMicrotask(() => cb(performance.now()));
      return 0;
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 200;
    container.appendChild(canvas);
    committed = null;
    api = initializeTextBox({
      container,
      canvas,
      blocks: [],
      contentWidth: 400,
      contentHeight: 200,
      onCommit: (blocks) => {
        committed = blocks;
      },
    });
    api.focus();
  });

  afterEach(() => {
    api.detach();
    document.body.removeChild(container);
    window.requestAnimationFrame = origRAF;
  });

  function textarea(): HTMLTextAreaElement {
    const el = container.querySelector('textarea');
    if (!el) throw new Error('textarea not mounted');
    return el;
  }

  function selectAll(): void {
    // Both Meta and Ctrl are sent so the assertion holds whichever platform
    // the shortcut resolves `mod` to.
    textarea().dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'a',
        metaKey: true,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  }

  /** Flush the final onCommit and return the committed blocks. */
  function commitBlocks(): Block[] {
    api.detach();
    if (!committed) throw new Error('onCommit did not fire');
    return committed;
  }

  it('keeps the href while clearing the formatting on the same run', () => {
    api.insertLink('https://example.com');
    selectAll();
    api.applyStyle({ bold: true, color: '#ff0000' });
    api.clearInlineFormatting();

    const inlines = commitBlocks()[0].inlines;
    expect(inlines.map((i) => i.text).join('')).toBe('https://example.com');
    expect(inlines.some((i) => i.style.href === 'https://example.com')).toBe(true);
    for (const inline of inlines) {
      expect(inline.style.bold).toBeFalsy();
      expect(inline.style.color).toBeFalsy();
    }
  });

  it('removeLink still drops the hyperlink', () => {
    api.insertLink('https://example.com');
    selectAll();
    api.clearInlineFormatting();
    api.removeLink();

    const inlines = commitBlocks()[0].inlines;
    expect(inlines.every((i) => !i.style.href)).toBe(true);
  });
});

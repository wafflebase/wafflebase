// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initializeTextBox, type TextBoxEditorAPI } from '../../src/view/text-box-editor.js';
import type { Block } from '../../src/model/types.js';

/**
 * Regression coverage for issue #494 in the `initializeTextBox` path —
 * the factory that powers Slides text boxes and Slides table cells.
 * With a collapsed caret inside an existing hyperlink, `insertLink`
 * must update that link's href in place instead of inserting the URL
 * as a brand-new link at the caret.
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

describe('initializeTextBox — edit link in place (#494)', () => {
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

  function pressArrowLeft(times: number): void {
    for (let i = 0; i < times; i++) {
      textarea().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }),
      );
    }
  }

  /** Flush the final onCommit and return the committed blocks. */
  function commitBlocks(): Block[] {
    api.detach();
    if (!committed) throw new Error('onCommit did not fire');
    return committed;
  }

  it('caret at the trailing edge of a link + insertLink updates it in place', () => {
    api.insertLink('https://example.com');
    api.insertLink('https://example.org');

    const inlines = commitBlocks()[0].inlines;
    expect(inlines.map((i) => i.text).join('')).toBe('https://example.com');
    expect(inlines.every((i) => i.style.href === 'https://example.org')).toBe(true);
  });

  it('caret inside a link + insertLink updates it in place', () => {
    api.insertLink('https://example.com');
    pressArrowLeft(3);
    api.insertLink('https://example.org');

    const inlines = commitBlocks()[0].inlines;
    expect(inlines.map((i) => i.text).join('')).toBe('https://example.com');
    expect(inlines.every((i) => i.style.href === 'https://example.org')).toBe(true);
  });

  it('href residue on a fully-emptied text box falls back to inserting the URL', () => {
    api.insertLink('https://example.com');
    for (let i = 0; i < 'https://example.com'.length; i++) {
      textarea().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }),
      );
    }
    // The emptied run keeps its style, but the residue href is not an
    // editable run — getLinkAtCursor skips the empty-text inline, matching
    // findLinkRunAt, so the popover shows "add link" rather than prefilling
    // an invisible href.
    expect(api.getLinkAtCursor()).toBeUndefined();

    api.insertLink('https://example.org');

    const inlines = commitBlocks()[0].inlines;
    expect(inlines.map((i) => i.text).join('')).toBe('https://example.org');
    expect(inlines.every((i) => !i.text || i.style.href === 'https://example.org')).toBe(true);
  });

  it('removeLink with the caret inside the link still unlinks the whole run', () => {
    api.insertLink('https://example.com');
    pressArrowLeft(3);
    api.removeLink();

    const inlines = commitBlocks()[0].inlines;
    expect(inlines.map((i) => i.text).join('')).toBe('https://example.com');
    expect(inlines.every((i) => !i.style.href)).toBe(true);
  });
});

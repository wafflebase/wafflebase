// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initializeTextBox, type TextBoxEditorAPI } from '../../src/view/text-box-editor.js';
import type { Block } from '../../src/model/types.js';

/**
 * Regression coverage for exiting hyperlink formatting on Enter / Space /
 * paste in the `initializeTextBox` path — the factory that powers BOTH
 * Slides text boxes and Slides table cells (the caller just supplies the
 * `blocks` it wants edited).
 *
 * The trailing-edge fix (`TextEditor.exitLinkIfAtTrailingEdge`) is a no-op
 * unless the host wires a pending-style controller via
 * `TextEditor.setPendingStyle`. The full Docs editor already did this;
 * `initializeTextBox` did not, so the exit silently no-opped for every
 * Slides surface (issue #495 follow-up). This suite locks in the wiring
 * added to `text-box-editor.ts`.
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

describe('initializeTextBox — exit hyperlink formatting at a link trailing edge', () => {
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

  function type(text: string): void {
    const ta = textarea();
    ta.value = text;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function pressEnter(): void {
    textarea().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
  }

  /** Flush the final onCommit and return the committed blocks. */
  function commitBlocks(): Block[] {
    api.detach();
    if (!committed) throw new Error('onCommit did not fire');
    return committed;
  }

  function last<T>(arr: T[]): T {
    return arr[arr.length - 1];
  }

  it('typing a space right after an inserted link does not extend the link', () => {
    api.insertLink('https://example.com');
    type(' ');

    const blocks = commitBlocks();
    const inlines = blocks[0].inlines;
    expect(last(inlines).style.href).toBeFalsy();
    expect(inlines.map((i) => i.text).join('')).toBe('https://example.com ');
  });

  it('text typed after that space stays plain', () => {
    api.insertLink('https://example.com');
    type(' ');
    type('hello');

    const blocks = commitBlocks();
    const inlines = blocks[0].inlines;
    expect(last(inlines).style.href).toBeFalsy();
    expect(inlines.map((i) => i.text).join('')).toBe('https://example.com hello');
  });

  it('pressing Enter right after an inserted link starts a plain new paragraph', () => {
    api.insertLink('https://example.com');
    pressEnter();
    type('hello');

    const blocks = commitBlocks();
    expect(blocks).toHaveLength(2);
    const secondBlockInlines = blocks[1].inlines;
    expect(secondBlockInlines.map((i) => i.text).join('')).toBe('hello');
    expect(secondBlockInlines.every((i) => !i.style.href)).toBe(true);
  });
});

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

  function type(text: string): void {
    const ta = textarea();
    ta.value = text;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function pressShiftLeft(times: number): void {
    for (let i = 0; i < times; i++) {
      textarea().dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowLeft',
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    }
  }

  /**
   * `see <link> now` — a link with plain text on both sides, so a
   * selection can reach past it. The space is typed on its own because
   * the trailing-edge link exit fires on a single typed space; sending
   * `' now'` as one input event would pull the whole tail into the link.
   */
  function linkBetweenText(): void {
    type('see ');
    api.insertLink('https://example.com');
    type(' ');
    type('now');
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

  it('removeLink drops a link the selection covers, caret outside it or not', () => {
    // The natural gesture behind the Slides toolbar's Remove link button:
    // drag over the linked text and click it. `removeLink` used to resolve
    // the link purely from the caret, which after such a drag sits at the
    // selection's *focus* — past the link when the selection reaches
    // beyond it — so the click was a silent no-op. On Slides that left no
    // way at all to drop a hyperlink, since Clear formatting deliberately
    // keeps them now (#1051).
    linkBetweenText();
    selectAll();
    api.removeLink();

    const inlines = commitBlocks()[0].inlines;
    expect(inlines.map((i) => i.text).join('')).toBe('see https://example.com now');
    expect(inlines.every((i) => !i.style.href)).toBe(true);
  });

  it('removeLink leaves a link the selection does not touch', () => {
    // Over-reach guard for the case above: a selection is authority over
    // what it covers, not over every link in the text box.
    linkBetweenText();
    pressShiftLeft(3); // selects 'now', which the link does not reach

    api.removeLink();

    const inlines = commitBlocks()[0].inlines;
    expect(inlines.some((i) => i.style.href === 'https://example.com')).toBe(true);
  });

  it('a collapsed-caret font-size step at a link trailing edge does not re-arm the link', () => {
    // `stepSelectionFontSize` is the one collapsed-caret write in this
    // editor that *does* stage a caret-derived pending seed — and the seed
    // carries the link run's own `href`, so the next typed character used to
    // extend the hyperlink. It matters most here: a Slides text box has no
    // link popover, so nothing would undo it.
    api.insertLink('https://example.com');
    api.stepSelectionFontSize(1, (n) => n);
    type('x');

    const inlines = commitBlocks()[0].inlines;
    expect(inlines.map((i) => i.text).join('')).toBe('https://example.comx');
    expect(inlines[0].style.href).toBe('https://example.com');
    expect(inlines[inlines.length - 1].style.href).toBeFalsy();
  });

  it('a collapsed-caret font-size step inside link text keeps the link', () => {
    // Over-reach guard for the case above: stepping inside the link must not
    // invent an exit, so what follows the caret stays linked.
    api.insertLink('https://example.com');
    for (let i = 0; i < 14; i++) {
      textarea().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }),
      );
    }
    api.stepSelectionFontSize(1, (n) => n);
    type('X');

    const inlines = commitBlocks()[0].inlines;
    expect(inlines.map((i) => i.text).join('')).toBe('httpsX://example.com');
    expect(inlines.every((i) => i.style.href === 'https://example.com')).toBe(true);
  });

  it('a collapsed-caret clear at a link trailing edge keeps the link intact', () => {
    // The third Clear-formatting entry point. Unlike the two docs ones it
    // stages nothing at a collapsed caret — `applyStyleImpl` returns early
    // without a selection — so it needs no trailing-edge `href` override:
    // there is no caret-derived pending seed here to re-arm the link from.
    // What it must not do is *drop* the href, and it must leave the exit
    // machinery (`exitLinkIfAtTrailingEdge`, wired through the shared
    // pending style) working, which the typed space below asserts.
    api.insertLink('https://example.com');
    api.clearInlineFormatting();
    type(' ');
    type('now');

    const inlines = commitBlocks()[0].inlines;
    expect(inlines.map((i) => i.text).join('')).toBe('https://example.com now');
    expect(inlines[0].style.href).toBe('https://example.com');
    expect(inlines[inlines.length - 1].style.href).toBeFalsy();
  });
});

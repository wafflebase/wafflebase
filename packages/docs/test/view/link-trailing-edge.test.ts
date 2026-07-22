// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initialize, type EditorAPI } from '../../src/view/editor.js';
import { MemDocStore } from '../../src/store/memory.js';
import { createEmptyBlock } from '../../src/model/types.js';

/**
 * Regression coverage for exiting hyperlink formatting on Enter / Space.
 *
 * Before the fix, `insertLink` on a collapsed caret left the cursor
 * flush against the end of the newly-linked text. Typing a space, or
 * pressing Enter, then silently extended the `href` run because
 * `applyInsertText` / `applySplitBlock` inherit the style of whatever
 * run touches the caret. The fix arms the existing `pending` style
 * controller with `href: undefined` when the caret sits at a link's
 * trailing edge (see `exitLinkIfAtTrailingEdge` in text-editor.ts).
 */
function makeCtxSpy() {
  return {
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    font: '10px sans-serif',
    textAlign: 'start' as CanvasTextAlign,
    textBaseline: 'alphabetic' as CanvasTextBaseline,
    globalAlpha: 1,
    fillRect: vi.fn(),
    fillText: vi.fn(),
    clearRect: vi.fn(),
    setTransform: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    transform: vi.fn(),
    clip: vi.fn(),
    rect: vi.fn(),
    measureText: (text: string) => ({ width: text.length * 8 }),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    stroke: vi.fn(),
    quadraticCurveTo: vi.fn(),
    bezierCurveTo: vi.fn(),
  };
}

describe('docs editor — exit hyperlink formatting on Enter / Space', () => {
  let container: HTMLElement;
  let editor: EditorAPI;
  let origGetContext: HTMLCanvasElement['getContext'];
  let origRAF: typeof window.requestAnimationFrame;

  beforeEach(() => {
    if (!(globalThis as { ResizeObserver?: unknown }).ResizeObserver) {
      class FakeResizeObserver {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      }
      (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver;
    }
    if (!(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas) {
      class FakeOffscreenCanvas {
        constructor(public width: number, public height: number) {}
        getContext(_type: string): unknown {
          return {
            font: '10px sans-serif',
            measureText: (text: string) => ({ width: text.length * 8 }),
          };
        }
      }
      (globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = FakeOffscreenCanvas;
    }
    origGetContext = HTMLCanvasElement.prototype.getContext;
    const spy = makeCtxSpy();
    HTMLCanvasElement.prototype.getContext = function patched(
      contextId: string,
    ): unknown {
      if (contextId === '2d') return spy;
      return null;
    } as HTMLCanvasElement['getContext'];
    origRAF = window.requestAnimationFrame;
    window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
      queueMicrotask(() => cb(performance.now()));
      return 0;
    };
    container = document.createElement('div');
    document.body.appendChild(container);

    const store = new MemDocStore();
    store.setDocument({ blocks: [createEmptyBlock()] });
    editor = initialize(container, store);
  });

  afterEach(() => {
    editor.dispose();
    document.body.removeChild(container);
    HTMLCanvasElement.prototype.getContext = origGetContext;
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

  function pastePlainText(text: string): void {
    const ev = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'clipboardData', {
      value: {
        items: [] as DataTransferItem[],
        getData: (type: string) => (type === 'text/plain' ? text : ''),
      },
    });
    textarea().dispatchEvent(ev);
  }

  function firstBlockInlines() {
    return editor.getDoc().document.blocks[0].inlines;
  }

  function last<T>(arr: T[]): T {
    return arr[arr.length - 1];
  }

  it('typing a space right after an inserted link does not extend the link', () => {
    editor.insertLink('https://example.com');
    expect(last(firstBlockInlines()).style.href).toBe('https://example.com');

    type(' ');
    const inlines = firstBlockInlines();
    expect(last(inlines).style.href).toBeFalsy();
    expect(inlines.map((i) => i.text).join('')).toBe('https://example.com ');
  });

  it('text typed after that space stays plain', () => {
    editor.insertLink('https://example.com');
    type(' ');
    type('hello');

    const inlines = firstBlockInlines();
    expect(last(inlines).style.href).toBeFalsy();
    expect(inlines.map((i) => i.text).join('')).toBe('https://example.com hello');
  });

  it('pressing Enter right after an inserted link starts a plain new paragraph', () => {
    editor.insertLink('https://example.com');
    pressEnter();
    type('hello');

    const blocks = editor.getDoc().document.blocks;
    expect(blocks).toHaveLength(2);
    const secondBlockInlines = blocks[1].inlines;
    expect(secondBlockInlines.map((i) => i.text).join('')).toBe('hello');
    expect(secondBlockInlines.every((i) => !i.style.href)).toBe(true);
  });

  it('space in the middle of link text stays part of the link', () => {
    editor.insertLink('https://example.com');
    // Move the caret back inside the link text (not at the trailing edge).
    const block = editor.getDoc().document.blocks[0];
    editor.restoreLocalCursor({ blockId: block.id, offset: 5 }, null);

    type(' ');
    const inlines = firstBlockInlines();
    expect(inlines.map((i) => i.text).join('')).toBe('https ://example.com');
    expect(inlines.every((i) => i.style.href === 'https://example.com')).toBe(true);
  });

  it('space at the boundary between two same-link runs stays part of the link', () => {
    editor.insertLink('https://example.com');
    const block = editor.getDoc().document.blocks[0];

    // Bold just the first 5 characters of the link text ("https"), which
    // splits the link into two runs that share the same href.
    editor._setSelectionForTest({
      anchor: { blockId: block.id, offset: 0 },
      focus: { blockId: block.id, offset: 5 },
    });
    editor.applyStyle({ bold: true });
    editor._setSelectionForTest(null);

    // Caret sits exactly on the boundary between the two same-href runs —
    // this is not the link's trailing edge, so the link must not be exited.
    editor.restoreLocalCursor({ blockId: block.id, offset: 5 }, null);
    type(' ');

    const inlines = firstBlockInlines();
    expect(inlines.map((i) => i.text).join('')).toBe('https ://example.com');
    expect(inlines.every((i) => i.style.href === 'https://example.com')).toBe(true);
  });

  it('exiting a link on Space preserves a pending style armed at the same caret', () => {
    editor.insertLink('https://example.com');
    // Collapsed-caret toolbar toggle at the link's trailing edge arms
    // pending bold; the space must still exit the link while keeping it.
    editor.applyStyle({ bold: true });
    type(' ');

    const inlines = firstBlockInlines();
    expect(last(inlines).style.href).toBeFalsy();
    expect(last(inlines).style.bold).toBe(true);
  });

  it('pasting plain text right after an inserted link does not extend the link', () => {
    editor.insertLink('https://example.com');
    pastePlainText('hello');

    const inlines = firstBlockInlines();
    expect(last(inlines).style.href).toBeFalsy();
    expect(inlines.map((i) => i.text).join('')).toBe('https://example.comhello');
  });
});

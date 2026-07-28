// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initialize, type EditorAPI } from '../../src/view/editor.js';
import { MemDocStore } from '../../src/store/memory.js';
import { createEmptyBlock } from '../../src/model/types.js';

/**
 * Regression coverage for issue #494: with a collapsed caret inside an
 * existing hyperlink, `insertLink` (the link popover's Apply) must update
 * that link's href in place — before the fix it fell into the
 * insert-new-text branch and inserted the URL as a brand-new link at the
 * caret, leaving the original link untouched.
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

describe('docs editor — edit link in place (#494)', () => {
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

  function firstBlockInlines() {
    return editor.getDoc().document.blocks[0].inlines;
  }

  function blockText(): string {
    return firstBlockInlines().map((i) => i.text).join('');
  }

  /** Link "example" inside "example text" via a drag selection, then
   * collapse the caret to `offset` — the issue's repro setup. */
  function makeLinkedExample(caretOffset: number): string {
    type('example text');
    const blockId = editor.getDoc().document.blocks[0].id;
    editor._setSelectionForTest({
      anchor: { blockId, offset: 0 },
      focus: { blockId, offset: 7 },
    });
    editor.insertLink('https://example.com');
    editor._setSelectionForTest(null);
    editor.restoreLocalCursor({ blockId, offset: caretOffset }, null);
    return blockId;
  }

  function pressBackspace(times: number): void {
    for (let i = 0; i < times; i++) {
      textarea().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }),
      );
    }
  }

  it('caret click inside a link + Apply updates the existing link (issue repro)', () => {
    makeLinkedExample(3);
    editor.insertLink('https://example.org');

    expect(blockText()).toBe('example text');
    const inlines = firstBlockInlines();
    let pos = 0;
    for (const inline of inlines) {
      const end = pos + inline.text.length;
      if (end <= 7) expect(inline.style.href).toBe('https://example.org');
      if (pos >= 7) expect(inline.style.href).toBeFalsy();
      pos = end;
    }
    expect(editor.getDoc().document.blocks).toHaveLength(1);
  });

  it('caret at the trailing edge of the link also updates in place', () => {
    makeLinkedExample(7);
    editor.insertLink('https://example.org');

    expect(blockText()).toBe('example text');
    expect(firstBlockInlines()[0].style.href).toBe('https://example.org');
  });

  it('updates the whole run when the link is split into styled sub-runs', () => {
    const blockId = makeLinkedExample(3);
    // Bold just "exa", splitting the link into two same-href runs.
    editor._setSelectionForTest({
      anchor: { blockId, offset: 0 },
      focus: { blockId, offset: 3 },
    });
    editor.applyStyle({ bold: true });
    editor._setSelectionForTest(null);
    editor.restoreLocalCursor({ blockId, offset: 5 }, null);

    editor.insertLink('https://example.org');

    expect(blockText()).toBe('example text');
    let pos = 0;
    for (const inline of firstBlockInlines()) {
      const end = pos + inline.text.length;
      if (end <= 7) expect(inline.style.href).toBe('https://example.org');
      pos = end;
    }
  });

  it('caret outside any link still inserts the URL as new linked text', () => {
    makeLinkedExample(12); // end of " text", not in the link

    editor.insertLink('https://new.example.com');

    expect(blockText()).toBe('example texthttps://new.example.com');
    const inlines = firstBlockInlines();
    const last = inlines[inlines.length - 1];
    expect(last.style.href).toBe('https://new.example.com');
    // The original link is untouched.
    expect(inlines[0].style.href).toBe('https://example.com');
  });

  it('the caret does not move when a link is updated in place', () => {
    const blockId = makeLinkedExample(3);
    editor.insertLink('https://example.org');

    expect(editor._getCursorForTest()).toEqual({ blockId, offset: 3 });
  });

  it('at the boundary between two links, Apply edits the link the popover shows', () => {
    type('aaabbb');
    const blockId = editor.getDoc().document.blocks[0].id;
    editor._setSelectionForTest({
      anchor: { blockId, offset: 0 },
      focus: { blockId, offset: 3 },
    });
    editor.insertLink('https://a.example.com');
    editor._setSelectionForTest({
      anchor: { blockId, offset: 3 },
      focus: { blockId, offset: 6 },
    });
    editor.insertLink('https://b.example.com');
    editor._setSelectionForTest(null);
    editor.restoreLocalCursor({ blockId, offset: 3 }, null);

    // The popover prefills from getLinkAtCursor — link A at this boundary.
    expect(editor.getLinkAtCursor()).toBe('https://a.example.com');
    editor.insertLink('https://c.example.com');

    expect(blockText()).toBe('aaabbb');
    let pos = 0;
    for (const inline of firstBlockInlines()) {
      const end = pos + inline.text.length;
      if (end <= 3) expect(inline.style.href).toBe('https://c.example.com');
      if (pos >= 3) expect(inline.style.href).toBe('https://b.example.com');
      pos = end;
    }
  });

  it('href residue on a fully-emptied paragraph falls back to inserting the URL', () => {
    editor.insertLink('https://example.com');
    pressBackspace('https://example.com'.length);

    // normalizeInlines keeps the emptied run's style — the href residue
    // state that made in-place apply a silent no-op (zero-width run).
    const residue = firstBlockInlines();
    expect(residue.map((i) => i.text).join('')).toBe('');
    expect(residue[0].style.href).toBe('https://example.com');

    editor.insertLink('https://example.org');

    expect(blockText()).toBe('https://example.org');
    expect(firstBlockInlines().every((i) => !i.text || i.style.href === 'https://example.org')).toBe(true);
  });

  it('undo restores the previous href', () => {
    makeLinkedExample(3);
    editor.insertLink('https://example.org');
    expect(firstBlockInlines()[0].style.href).toBe('https://example.org');

    editor.undo();

    expect(blockText()).toBe('example text');
    expect(firstBlockInlines()[0].style.href).toBe('https://example.com');
  });

  it('removeLink with the caret inside the link still unlinks the whole run', () => {
    makeLinkedExample(3);
    editor.removeLink();

    expect(blockText()).toBe('example text');
    expect(firstBlockInlines().every((i) => !i.style.href)).toBe(true);
  });
});

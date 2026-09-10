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

  function pressClearFormatting(): void {
    textarea().dispatchEvent(
      new KeyboardEvent('keydown', {
        key: '\\',
        // jsdom's navigator.platform is not a Mac, so the editor reads
        // Ctrl as the mod key; send both so the helper is platform-proof.
        ctrlKey: true,
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  }

  function pressBold(): void {
    textarea().dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'b',
        // Same platform-proofing as `pressClearFormatting` above.
        ctrlKey: true,
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
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

  it('Cmd+\\ at a link trailing edge still exits the link', () => {
    editor.insertLink('https://example.com');
    // Clear formatting keeps hyperlinks (#1051), but `pending.set`
    // replaces rather than merges — so it must re-arm the trailing-edge
    // `href: undefined` it just overwrote, or the next typed character
    // would silently extend the link. A plain character, not a space or
    // Enter: those two re-arm the exit themselves at insert time, so
    // they hide the overwrite.
    pressClearFormatting();
    type('x');

    const inlines = firstBlockInlines();
    expect(last(inlines).style.href).toBeFalsy();
    expect(inlines.map((i) => i.text).join('')).toBe('https://example.comx');
  });

  it('Cmd+\\ inside link text leaves the link on what follows', () => {
    editor.insertLink('https://example.com');
    const block = editor.getDoc().document.blocks[0];
    // Caret inside the link, not at its trailing edge: clearing must not
    // invent a link exit there.
    editor.restoreLocalCursor({ blockId: block.id, offset: 5 }, null);
    pressClearFormatting();
    type('X');

    const inlines = firstBlockInlines();
    expect(inlines.map((i) => i.text).join('')).toBe('httpsX://example.com');
    expect(inlines.every((i) => i.style.href === 'https://example.com')).toBe(true);
  });

  it('the Clear formatting button at a link trailing edge also exits the link', () => {
    editor.insertLink('https://example.com');
    // Same scenario as the Cmd+\ case above, through the *other* entry
    // point: the toolbar button calls `clearInlineFormatting`, whose
    // collapsed-caret path seeds pending from the caret style — which at
    // the trailing edge carries the link's own `href`.
    editor.clearInlineFormatting();
    type('x');

    const inlines = firstBlockInlines();
    expect(last(inlines).style.href).toBeFalsy();
    expect(inlines.map((i) => i.text).join('')).toBe('https://example.comx');
  });

  it('the Clear formatting button inside link text leaves the link alone', () => {
    editor.insertLink('https://example.com');
    const block = editor.getDoc().document.blocks[0];
    // The over-reach guard for the test above: clearing inside a link must
    // not invent an exit, so what follows the caret stays linked.
    editor.restoreLocalCursor({ blockId: block.id, offset: 5 }, null);
    editor.clearInlineFormatting();
    type('X');

    const inlines = firstBlockInlines();
    expect(inlines.map((i) => i.text).join('')).toBe('httpsX://example.com');
    expect(inlines.every((i) => i.style.href === 'https://example.com')).toBe(true);
  });

  it('the Clear formatting button keeps a link a selection covers', () => {
    editor.insertLink('https://example.com');
    const block = editor.getDoc().document.blocks[0];
    // The other over-reach guard: the trailing-edge override is
    // collapsed-caret only, so a range clear must not strip the href even
    // when the selection ends exactly at the link's trailing edge.
    editor._setSelectionForTest({
      anchor: { blockId: block.id, offset: 0 },
      focus: { blockId: block.id, offset: 'https://example.com'.length },
    });
    editor.clearInlineFormatting();

    const inlines = firstBlockInlines();
    expect(inlines.every((i) => i.style.href === 'https://example.com')).toBe(true);
  });

  it('a toolbar toggle at a link trailing edge does not re-arm the link', () => {
    editor.insertLink('https://example.com');
    // Not a Clear-formatting path at all: the *sibling* toolbar buttons
    // go through the same collapsed-caret branch of `applyStyleImpl`,
    // which seeds pending from the caret style — the link run's own,
    // `href` included. Bold at the trailing edge then typing therefore
    // used to grow the hyperlink, the exact failure the Clear-formatting
    // override exists to prevent (round-5 review of #1052).
    editor.applyStyle({ bold: true });
    type('x');

    const inlines = firstBlockInlines();
    expect(last(inlines).style.href).toBeFalsy();
    expect(last(inlines).style.bold).toBe(true);
    expect(inlines.map((i) => i.text).join('')).toBe('https://example.comx');
  });

  it('a toolbar toggle inside link text still keeps the link', () => {
    editor.insertLink('https://example.com');
    const block = editor.getDoc().document.blocks[0];
    // Over-reach guard for the case above: the exit is armed only at the
    // trailing edge, so a toggle *inside* the link must leave what
    // follows linked.
    editor.restoreLocalCursor({ blockId: block.id, offset: 5 }, null);
    editor.applyStyle({ bold: true });
    type('X');

    const inlines = firstBlockInlines();
    expect(inlines.map((i) => i.text).join('')).toBe('httpsX://example.com');
    expect(inlines.every((i) => i.style.href === 'https://example.com')).toBe(true);
  });

  it('Cmd+B at a link trailing edge does not re-arm the link', () => {
    editor.insertLink('https://example.com');
    // The keyboard half of the toolbar case above. `TextEditor.toggleStyle`
    // has its own collapsed-caret `pending.set`, seeded from the caret's
    // visual style — the link run's, `href` included — so Cmd+B at the
    // trailing edge used to grow the hyperlink even though the identical
    // toolbar click no longer did.
    pressBold();
    type('x');

    const inlines = firstBlockInlines();
    expect(last(inlines).style.href).toBeFalsy();
    expect(last(inlines).style.bold).toBe(true);
    expect(inlines.map((i) => i.text).join('')).toBe('https://example.comx');
  });

  it('Cmd+B inside link text still keeps the link', () => {
    editor.insertLink('https://example.com');
    const block = editor.getDoc().document.blocks[0];
    // Over-reach guard: the exit is armed only at the trailing edge.
    editor.restoreLocalCursor({ blockId: block.id, offset: 5 }, null);
    pressBold();
    type('X');

    const inlines = firstBlockInlines();
    expect(inlines.map((i) => i.text).join('')).toBe('httpsX://example.com');
    expect(inlines.every((i) => i.style.href === 'https://example.com')).toBe(true);
  });

  it('stepping the font size at a link trailing edge does not re-arm the link', () => {
    editor.insertLink('https://example.com');
    // `stepSelectionFontSize`'s collapsed branch is the other route into
    // that same seed, so it has to be guarded by the same rule.
    editor.stepSelectionFontSize(1, (n) => n);
    type('x');

    const inlines = firstBlockInlines();
    expect(last(inlines).style.href).toBeFalsy();
    expect(inlines.map((i) => i.text).join('')).toBe('https://example.comx');
  });

  it('Clear formatting in an emptied linked paragraph does not re-arm the link', () => {
    editor.insertLink('https://example.com');
    const block = editor.getDoc().document.blocks[0];
    // Delete the link's whole text. `normalizeInlines` collapses the
    // block onto a single empty inline that *keeps* the style of the
    // first one — an `href` residue on a paragraph with no text. It
    // anchors no link (`findLinkRunAt` refuses an empty run, so
    // `removeLink` cannot reach it) yet the caret reads it, so before
    // this guard Clear formatting seeded pending with that stale href
    // and the next typed character became a hyperlink the user never
    // created. Clearing used to be the one escape from that residue.
    editor._setSelectionForTest({
      anchor: { blockId: block.id, offset: 0 },
      focus: { blockId: block.id, offset: 'https://example.com'.length },
    });
    textarea().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }),
    );
    expect(editor.getDoc().document.blocks[0].inlines.map((i) => i.text).join('')).toBe('');

    editor.clearInlineFormatting();
    type('x');

    const inlines = firstBlockInlines();
    expect(inlines.map((i) => i.text).join('')).toBe('x');
    expect(inlines.every((i) => !i.style.href)).toBe(true);
  });

  it('pasting plain text right after an inserted link does not extend the link', () => {
    editor.insertLink('https://example.com');
    pastePlainText('hello');

    const inlines = firstBlockInlines();
    expect(last(inlines).style.href).toBeFalsy();
    expect(inlines.map((i) => i.text).join('')).toBe('https://example.comhello');
  });
});

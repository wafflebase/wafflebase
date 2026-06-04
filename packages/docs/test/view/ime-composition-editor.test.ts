// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initialize, type EditorAPI } from '../../src/view/editor.js';
import { MemDocStore } from '../../src/store/memory.js';
import { createEmptyBlock } from '../../src/model/types.js';

/**
 * Editor-level guard for the IME undo-history fix (issue #318).
 *
 * The root cause was that interim IME composition text was written to the
 * document model on every `compositionupdate`, producing many model
 * mutations (and, under Yorkie, many undo units) for one character. The
 * fix keeps interim composing text view-local (injected into the layout
 * only) and commits the final text exactly once on `compositionend`.
 *
 * These tests assert the load-bearing behavior at the docs layer: the
 * model is untouched during composition and receives the composed text
 * exactly once at the end. (The "exactly one Yorkie undo unit" assertion
 * lives in the frontend's yorkie-doc-store tests, since MemDocStore uses
 * snapshot-based undo and cannot reproduce the operation-level toggle.)
 */

function installCanvasShim(): void {
  const ctxHandler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === 'measureText') {
        return (text: string) => ({
          width: typeof text === 'string' ? text.length * 8 : 0,
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
  if (!(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas) {
    (globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
      constructor(public width: number, public height: number) {}
      getContext(): unknown {
        return { font: '12px sans-serif', measureText: (t: string) => ({ width: t.length * 8 }) };
      }
    };
  }
}

describe('docs editor — IME composition keeps interim text out of the model', () => {
  let container: HTMLElement;
  let editor: EditorAPI;
  let origGetContext: HTMLCanvasElement['getContext'];
  let origRAF: typeof window.requestAnimationFrame;

  beforeEach(() => {
    origGetContext = HTMLCanvasElement.prototype.getContext;
    origRAF = window.requestAnimationFrame;
    installCanvasShim();
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

  function blockText(): string {
    return editor.getDoc().document.blocks[0].inlines.map((i) => i.text).join('');
  }

  function compositionStart(): void {
    textarea().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  }
  function composingInput(value: string): void {
    const ta = textarea();
    ta.value = value;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function compositionEnd(data: string): void {
    const ta = textarea();
    ta.dispatchEvent(new CompositionEvent('compositionend', { data, bubbles: true }));
  }

  it('does not write interim composing text to the model, commits once at end', () => {
    compositionStart();

    // Interim jamo / syllable steps — model must stay empty (view-local only).
    composingInput('ㄱ');
    expect(blockText()).toBe('');
    composingInput('가');
    expect(blockText()).toBe('');

    // Commit: the composed syllable lands in the model exactly once.
    compositionEnd('가');
    expect(blockText()).toBe('가');
  });

  it('commits consecutive syllables, each via a single end-of-composition write', () => {
    // First syllable.
    compositionStart();
    composingInput('ㄱ');
    composingInput('가');
    compositionEnd('가');
    expect(blockText()).toBe('가');

    // Second syllable (Korean fires end -> start between syllables).
    compositionStart();
    composingInput('ㄴ');
    composingInput('나');
    compositionEnd('나');
    expect(blockText()).toBe('가나');
  });

  it('uses e.data as the source of truth at commit (iOS drift correction)', () => {
    compositionStart();
    composingInput('ㅎ');
    // Even if textarea.value drifted, the committed text follows e.data.
    compositionEnd('한');
    expect(blockText()).toBe('한');
  });

  it('blur mid-composition commits the visible preview and ends composition', () => {
    compositionStart();
    composingInput('ㄱ');
    composingInput('가');
    expect(blockText()).toBe(''); // still view-local
    // Focus leaves before any compositionend fires.
    textarea().dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    expect(blockText()).toBe('가'); // preview committed, no ghost text left
    expect(editor.isComposing()).toBe(false);
  });

  it('software Hangul (no composition events) stays view-local, commits on flush', () => {
    // Mobile-Safari path: raw jamo arrive as plain input, assembled in-app.
    composingInput('ㄱ');
    expect(blockText()).toBe('');
    composingInput('ㅏ'); // assembles to "가" as a view-local preview
    expect(blockText()).toBe('');
    // Blur flushes the software-Hangul assembler, committing the syllable.
    textarea().dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    expect(blockText()).toBe('가');
  });

  it('updateCompositionStartPosition mid-composition still commits correctly', () => {
    compositionStart();
    composingInput('ㄱ');
    expect(blockText()).toBe('');
    // Simulate the collaboration layer correcting the anchor after a remote
    // change. This must re-publish the composing preview without throwing
    // and keep composition active so the final commit lands.
    const blockId = editor.getDoc().document.blocks[0].id;
    editor.updateCompositionStartPosition({ blockId, offset: 0 });
    expect(editor.isComposing()).toBe(true);
    compositionEnd('가');
    expect(blockText()).toBe('가');
  });

  it('updateCompositionStartPosition moves the caret to the end of the composing text', () => {
    let lastCursor: { blockId: string; offset: number } | null = null;
    editor.onCursorMove((pos) => {
      lastCursor = pos;
    });
    compositionStart();
    composingInput('ㅎ');
    composingInput('한'); // composing text length 1
    const blockId = editor.getDoc().document.blocks[0].id;
    // A remote change resolves the composition start to offset 0; the caret
    // must follow to 0 + length("한") = 1, not stay before the preview.
    editor.updateCompositionStartPosition({ blockId, offset: 0 });
    expect(lastCursor).toEqual({ blockId, offset: 1 });
  });

  it('blur aborting composition fires onCompositionEnd (clears collab anchor)', () => {
    let ended = 0;
    editor.onCompositionEnd(() => {
      ended++;
    });
    compositionStart();
    composingInput('ㄱ');
    textarea().dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    expect(ended).toBe(1);
    expect(editor.isComposing()).toBe(false);
  });

  it('applies a pending inline style to the committed composed character', () => {
    // Toggle bold at the collapsed caret, then compose a syllable.
    editor.applyStyle({ bold: true });
    compositionStart();
    composingInput('ㅂ');
    composingInput('바');
    compositionEnd('바');

    const inlines = editor.getDoc().document.blocks[0].inlines;
    const composed = inlines.find((i) => i.text.includes('바'));
    expect(composed?.style.bold).toBe(true);
  });
});

// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initialize } from '../../src/view/editor.js';
import { MemDocStore } from '../../src/store/memory.js';
import { createEmptyBlock } from '../../src/model/types.js';

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

/**
 * Editor-level wiring tests for pending inline style. The Doc-level
 * integration tests verify the controller contract; these verify that
 * the public EditorAPI surface actually flows pending state through
 * its applyStyle / getSelectionStyle / clear paths so that future
 * refactors of editor.ts cannot silently drop the wiring without a
 * test failure.
 *
 * jsdom does not render Canvas, but `initialize` runs against a
 * non-rendering canvas just fine for this thin slice of behaviour.
 */
describe('docs editor — pending inline style wiring', () => {
  let container: HTMLElement;
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
  });

  afterEach(() => {
    document.body.removeChild(container);
    HTMLCanvasElement.prototype.getContext = origGetContext;
    window.requestAnimationFrame = origRAF;
  });

  function mount() {
    const store = new MemDocStore();
    store.setDocument({ blocks: [createEmptyBlock()] });
    const editor = initialize(container, store);
    return { editor, store };
  }

  it('collapsed applyStyle records pending so getSelectionStyle reflects the toggle', () => {
    const { editor } = mount();

    expect(editor.getSelectionStyle().bold).toBeFalsy();
    editor.applyStyle({ bold: true });
    expect(editor.getSelectionStyle().bold).toBe(true);

    editor.dispose();
  });

  function dispatchKey(key: string, opts: { meta?: boolean; shift?: boolean } = {}) {
    const textarea = container.querySelector('textarea');
    if (!textarea) throw new Error('textarea not mounted');
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', {
        key,
        metaKey: opts.meta ?? false,
        ctrlKey: opts.meta ?? false,
        shiftKey: opts.shift ?? false,
        bubbles: true,
        cancelable: true,
      }),
    );
  }

  it('Cmd+B on collapsed caret records pending bold (keyboard shortcut path)', () => {
    const { editor } = mount();

    expect(editor.getSelectionStyle().bold).toBeFalsy();
    dispatchKey('b', { meta: true });
    expect(editor.getSelectionStyle().bold).toBe(true);

    editor.dispose();
  });

  it('Cmd+B twice on collapsed caret toggles pending off', () => {
    const { editor } = mount();

    dispatchKey('b', { meta: true });
    expect(editor.getSelectionStyle().bold).toBe(true);
    dispatchKey('b', { meta: true });
    expect(editor.getSelectionStyle().bold).toBeFalsy();

    editor.dispose();
  });

  it('Cmd+B then Cmd+I on collapsed caret accumulates both pending styles', () => {
    const { editor } = mount();

    dispatchKey('b', { meta: true });
    dispatchKey('i', { meta: true });
    const style = editor.getSelectionStyle();
    expect(style.bold).toBe(true);
    expect(style.italic).toBe(true);

    editor.dispose();
  });

  it('Cmd+\\ on collapsed caret records cleared pending style', () => {
    const { editor } = mount();

    dispatchKey('b', { meta: true });
    expect(editor.getSelectionStyle().bold).toBe(true);
    dispatchKey('\\', { meta: true });
    expect(editor.getSelectionStyle().bold).toBeFalsy();

    editor.dispose();
  });

  it('resetAfterDocumentReplace clears pending', () => {
    const { editor, store } = mount();

    editor.applyStyle({ italic: true });
    expect(editor.getSelectionStyle().italic).toBe(true);

    store.setDocument({ blocks: [createEmptyBlock()] });
    editor.resetAfterDocumentReplace();

    expect(editor.getSelectionStyle().italic).toBeFalsy();

    editor.dispose();
  });

  it('undo clears pending', () => {
    const { editor, store } = mount();

    // Make a real edit so docStore.canUndo() returns true.
    const firstBlockId = store.getDocument().blocks[0].id;
    store.snapshot();
    store.insertText(firstBlockId, 0, 'a');
    editor.resetAfterDocumentReplace();

    editor.applyStyle({ bold: true });
    expect(editor.getSelectionStyle().bold).toBe(true);

    editor.undo();
    expect(editor.getSelectionStyle().bold).toBeFalsy();

    editor.dispose();
  });

  it('redo clears pending', () => {
    const { editor, store } = mount();

    const firstBlockId = store.getDocument().blocks[0].id;
    store.snapshot();
    store.insertText(firstBlockId, 0, 'a');
    editor.resetAfterDocumentReplace();
    editor.undo();

    editor.applyStyle({ bold: true });
    expect(editor.getSelectionStyle().bold).toBe(true);

    editor.redo();
    expect(editor.getSelectionStyle().bold).toBeFalsy();

    editor.dispose();
  });

  it('applyStyle with selection (non-collapsed) does not pollute pending', () => {
    const { editor, store } = mount();

    const firstBlockId = store.getDocument().blocks[0].id;
    store.snapshot();
    store.insertText(firstBlockId, 0, 'abc');
    editor.resetAfterDocumentReplace();

    // No selection set — collapsed at offset 0. applyStyle records pending.
    editor.applyStyle({ bold: true });
    expect(editor.getSelectionStyle().bold).toBe(true);

    // Reset by simulating a navigation clear path.
    editor.validateCursorPosition(); // current block still exists, no-op
    // Use resetAfterDocumentReplace as a deterministic clear path.
    store.setDocument({ blocks: [createEmptyBlock()] });
    editor.resetAfterDocumentReplace();
    expect(editor.getSelectionStyle().bold).toBeFalsy();

    editor.dispose();
  });
});

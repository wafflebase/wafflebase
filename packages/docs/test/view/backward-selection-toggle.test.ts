// @vitest-environment jsdom
/**
 * Issue #715 — a backward (right-to-left) selection parks the caret at the
 * range's *start*, where the caret walk resolves the run *preceding* the
 * selection. Anything that decides add-vs-remove from the caret therefore
 * inverts the wrong value: after clearing bold from a sub-range of a bold
 * run, re-applying bold was a permanent no-op.
 *
 * These tests pin the two halves of the fix at the engine level:
 *
 *  1. `getSelectionStyle()` really does report the preceding run for a
 *     backward selection while `getRangeStyleSummary()` reports the range —
 *     the premise the toolbar toggles rely on (the frontend component tests
 *     mock this disagreement; here it is produced by the real editor).
 *  2. The Cmd/Ctrl+B keyboard path decides from the range too, so keyboard
 *     and toolbar agree on the same selection.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { MemDocStore } from '../../src/store/memory.js';
import { initialize, type EditorAPI } from '../../src/view/editor.js';
import { normalizeBlockStyle } from '../../src/model/types.js';
import type { Block } from '../../src/model/types.js';

const EMPTY_BLOCK_STYLE = normalizeBlockStyle({});
const BLOCK_ID = 'b1';

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
      if (prop === 'getImageData') {
        return (_x: number, _y: number, w: number, h: number) => ({
          data: new Uint8ClampedArray(Math.max(0, w) * Math.max(0, h) * 4),
          width: w, height: h,
        });
      }
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient' ||
          prop === 'createPattern') {
        return () => ({ addColorStop: () => {} });
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

/**
 * One paragraph, two runs: `head` (styled per `headBold`) then `tail`.
 * "ab" occupies offsets [0, 2), "cd" offsets [2, 4).
 */
function setupEditor(
  headBold: boolean,
  tailBold: boolean,
): { editor: EditorAPI; store: MemDocStore; container: HTMLElement } {
  const blocks: Block[] = [
    {
      id: BLOCK_ID,
      type: 'paragraph',
      inlines: [
        { text: 'ab', style: headBold ? { bold: true } : {} },
        { text: 'cd', style: tailBold ? { bold: true } : {} },
      ],
      style: EMPTY_BLOCK_STYLE,
    },
  ];
  const store = new MemDocStore();
  store.setDocument({ blocks });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const editor = initialize(container, store);
  return { editor, store, container };
}

/** Select "cd" right-to-left: anchor at the end, focus (caret) at the start. */
function selectTailBackward(editor: EditorAPI): void {
  editor._setSelectionForTest({
    anchor: { blockId: BLOCK_ID, offset: 4 },
    focus: { blockId: BLOCK_ID, offset: 2 },
  });
}

function dispatchKey(container: HTMLElement, key: string): void {
  const textarea = container.querySelector('textarea');
  if (!textarea) throw new Error('textarea not mounted');
  textarea.dispatchEvent(
    new KeyboardEvent('keydown', {
      key,
      metaKey: true,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
}

/** Is every character of "cd" bold in the stored document? */
function tailIsBold(store: MemDocStore): boolean {
  const inlines = store.getDocument().blocks[0].inlines;
  let pos = 0;
  let sawRun = false;
  let allBold = true;
  for (const inline of inlines) {
    const end = pos + inline.text.length;
    if (inline.text.length > 0 && end > 2 && pos < 4) {
      sawRun = true;
      if (!inline.style.bold) allBold = false;
    }
    pos = end;
  }
  return sawRun && allBold;
}

describe('backward selection style resolution (issue #715)', () => {
  beforeEach(() => {
    installCanvasShim();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('caret style reports the preceding run while the summary reports the range', () => {
    const { editor } = setupEditor(true, false);
    selectTailBackward(editor);

    // The caret sits at offset 2 — the boundary — and resolves the bold
    // run before the selection. This is the trap the toggles used to fall
    // into, reproduced here by the real editor rather than a mock.
    expect(editor.getSelectionStyle().bold).toBe(true);
    // The range summary looks at the selected runs only: "cd" is not bold.
    expect(editor.getRangeStyleSummary().bold).not.toBe(true);

    editor.dispose();
  });

  test('the summary still reads true when the backward range is uniformly bold', () => {
    const { editor } = setupEditor(false, true);
    selectTailBackward(editor);

    expect(editor.getSelectionStyle().bold).not.toBe(true);
    expect(editor.getRangeStyleSummary().bold).toBe(true);

    editor.dispose();
  });

  test('Cmd+B on a backward, unstyled range applies bold (was a silent no-op)', () => {
    const { editor, store, container } = setupEditor(true, false);
    selectTailBackward(editor);

    dispatchKey(container, 'b');

    expect(tailIsBold(store)).toBe(true);
    editor.dispose();
  });

  test('Cmd+B on a backward, uniformly bold range removes bold', () => {
    const { editor, store, container } = setupEditor(false, true);
    selectTailBackward(editor);

    dispatchKey(container, 'b');

    expect(tailIsBold(store)).toBe(false);
    editor.dispose();
  });

  test('Cmd+B on a forward range still toggles from the range', () => {
    const { editor, store, container } = setupEditor(true, true);
    editor._setSelectionForTest({
      anchor: { blockId: BLOCK_ID, offset: 2 },
      focus: { blockId: BLOCK_ID, offset: 4 },
    });

    dispatchKey(container, 'b');

    expect(tailIsBold(store)).toBe(false);
    editor.dispose();
  });
});

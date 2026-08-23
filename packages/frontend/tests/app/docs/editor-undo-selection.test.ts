// @vitest-environment jsdom
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import yorkie from '@yorkie-js/sdk';
import { YorkieDocStore } from '../../../src/app/docs/yorkie-doc-store.ts';
import {
  initialize,
  generateBlockId,
  DEFAULT_BLOCK_STYLE,
  type EditorAPI,
  type Block,
} from '@wafflebase/docs';

/**
 * Editor-level undo regressions driven through the *public editor API*
 * against a real `YorkieDocStore`, where the store unit tests only cover the
 * store contract:
 *
 * - issue #340 (toolbar/⌘B path): `applyStyleImpl` must record the caret +
 *   selection before mutating, or undo restores nothing.
 * - multi-block paste undo cost: it must stay constant in the size of the
 *   paste.
 *
 * Both live in one file deliberately. Mounting the docs editor pulls in the
 * whole `@wafflebase/docs` module graph, and a second frontend test file
 * doing the same adds enough parallel transform load to time out an
 * unrelated 5 s import smoke test elsewhere in the suite.
 *
 * jsdom has no real Canvas 2D context, so we shim `getContext` (mirrors the
 * docs-package editor tests). The undo/selection logic runs independent of
 * paint.
 */
function installCanvasShim(): () => void {
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
          width: w,
          height: h,
        });
      }
      if (
        prop === 'createLinearGradient' ||
        prop === 'createRadialGradient' ||
        prop === 'createPattern'
      ) {
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
  const proto = HTMLCanvasElement.prototype as unknown as {
    getContext: (kind: string) => unknown;
  };
  // Save the exact method before overriding so the shim can't leak into
  // subsequent tests; the returned closure restores it in afterEach.
  const original = proto.getContext;
  proto.getContext = (kind: string) => (kind === '2d' ? fakeCtx : null);
  return () => {
    proto.getContext = original;
  };
}

function makeBlock(text: string): Block {
  return {
    id: generateBlockId(),
    type: 'paragraph',
    inlines: [{ text, style: {} }],
    style: { ...DEFAULT_BLOCK_STYLE },
  };
}

describe('editor undo restores the selection (issue #340, toolbar style path)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let doc: any;
  let store: YorkieDocStore;
  let editor: EditorAPI;
  let container: HTMLDivElement;
  let restoreCanvas: () => void;

  beforeEach(() => {
    restoreCanvas = installCanvasShim();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    doc = new yorkie.Document<any>(`test-${Date.now()}-${Math.random()}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    doc.update((root: any) => {
      root.content = new yorkie.Tree({ type: 'doc', children: [] });
    });
    store = new YorkieDocStore(doc);
    store.setDocument({ blocks: [makeBlock('Hello World')] });
    container = document.createElement('div');
    document.body.appendChild(container);
    editor = initialize(container, store);
  });

  afterEach(() => {
    container.remove();
    restoreCanvas();
  });

  it('applyStyle(bold) via the editor API, then undo, restores the selected range', () => {
    const block = store.getDocument().blocks[0];
    const range = {
      anchor: { blockId: block.id, offset: 0 },
      focus: { blockId: block.id, offset: 5 },
    };
    editor._setSelectionForTest(range);
    editor.applyStyle({ bold: true });
    editor.undo();
    // Without applyStyleImpl calling setCursorForHistory(pos, selection), the
    // style op records no reversible presence and this is null / collapsed.
    expect(editor.getActiveSelection()).toEqual(range);
  });
});

/**
 * How many undo units a multi-block paste costs, end to end.
 *
 * Yorkie counts one `doc.update()` as one undo unit, and the docs store has
 * no transaction primitive (`DocStore.snapshot()` is a no-op there). Before
 * `insertBlocksAfter`, `insertBlocks()` wrote one `doc.update()` **per
 * pasted block**, so a 1000-block paste took 1000 Cmd+Z presses to undo.
 *
 * Batching the middle blocks collapses that to a constant, but *not* to one:
 * `insertBlocks()` still splits the destination block, rewrites the head,
 * inserts the batch, and rewrites the tail as separate store writes. This
 * test pins that constant so the cost stays independent of paste size — the
 * property that actually matters — and so nobody has to re-derive it from
 * the "one undo unit" phrasing, which describes `insertBlocksAfter` alone
 * and not the whole paste.
 */
function htmlWithParagraphs(n: number): string {
  const parts: string[] = [];
  for (let i = 0; i < n; i++) parts.push(`<p>Pasted ${i}</p>`);
  return parts.join('');
}

describe('multi-block paste undo cost', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let doc: any;
  let store: YorkieDocStore;
  let editor: EditorAPI;
  let container: HTMLDivElement;
  let restoreCanvas: () => void;

  beforeEach(() => {
    restoreCanvas = installCanvasShim();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    doc = new yorkie.Document<any>(`test-${Date.now()}-${Math.random()}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    doc.update((root: any) => {
      root.content = new yorkie.Tree({ type: 'doc', children: [] });
    });
    store = new YorkieDocStore(doc);
    store.setDocument({ blocks: [makeBlock('seed')] });
    container = document.createElement('div');
    document.body.appendChild(container);
    editor = initialize(container, store);
  });

  afterEach(() => {
    container.remove();
    restoreCanvas();
  });

  function pasteHtml(html: string): void {
    const block = store.getDocument().blocks[0];
    editor._setSelectionForTest({
      anchor: { blockId: block.id, offset: 4 },
      focus: { blockId: block.id, offset: 4 },
    });
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: {
        types: ['text/html'],
        getData: (t: string) => (t === 'text/html' ? html : ''),
        items: [] as unknown[],
      },
    });
    textarea.dispatchEvent(event);
  }

  it('costs the same number of undo units regardless of how many blocks are pasted', () => {
    const depthAfter = (n: number): number => {
      const before = doc.getUndoStackForTest().length;
      pasteHtml(htmlWithParagraphs(n));
      return doc.getUndoStackForTest().length - before;
    };

    const small = depthAfter(5);
    const large = depthAfter(120);

    // The property that matters: constant, not proportional to paste size.
    // Before batching, `large` would have been ~120. Kept modest on purpose:
    // this file mounts the whole docs editor, and the frontend suite runs
    // files in parallel against a 5 s per-test budget elsewhere.
    expect(large).toBe(small);
    // Measured at 4 — split, head rewrite, batched insert, tail rewrite.
    // Asserted as a ceiling rather than an equality so an unrelated store
    // refactor that merges two of them does not fail this test, while a
    // regression back to per-block writes still does.
    expect(small).toBeLessThanOrEqual(6);
  });
});

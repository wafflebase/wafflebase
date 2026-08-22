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
    const large = depthAfter(400);

    // The property that matters: constant, not proportional to paste size.
    // Before batching, `large` would have been ~400.
    expect(large).toBe(small);
    // Measured at 4 — split, head rewrite, batched insert, tail rewrite.
    // Asserted as a ceiling rather than an equality so an unrelated store
    // refactor that merges two of them does not fail this test, while a
    // regression back to per-block writes still does.
    expect(small).toBeLessThanOrEqual(6);
  });
});

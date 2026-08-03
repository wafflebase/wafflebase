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
 * Regression for issue #343's code-review finding: a single `±` press on a
 * mixed-size selection must write exactly ONE Yorkie undo unit, even though
 * it touches multiple runs (and, for cross-block selections, multiple
 * blocks). Before `DocStore.applyStyles()` batched the writes into one
 * `doc.update()`, `stepSelectionFontSizeImpl` looped `docStore.applyStyle()`
 * per run — each call is its own `doc.update()` on the real
 * `YorkieDocStore`, so undo only reverted the last run. `MemDocStore`-backed
 * tests couldn't see this: its `snapshot()` unconditionally pushes one
 * checkpoint regardless of how many subsequent `applyStyle` calls follow.
 *
 * jsdom has no real Canvas 2D context; shimmed as in editor-undo-selection.
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

/** [FONT_SIZE_MIN, FONT_SIZE_MAX] = [1, 400] — mirrors font-catalog.ts. */
const clamp = (n: number): number => Math.max(1, Math.min(400, Math.round(n)));

function multiRunBlock(runs: Array<[string, number]>): Block {
  return {
    id: generateBlockId(),
    type: 'paragraph',
    inlines: runs.map(([text, fontSize]) => ({ text, style: { fontSize } })),
    style: { ...DEFAULT_BLOCK_STYLE },
  };
}

describe('EditorAPI.stepSelectionFontSize undo granularity on YorkieDocStore (issue #343)', () => {
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
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    restoreCanvas();
  });

  it('a multi-run relative step within one block is a single undo unit', () => {
    const block = multiRunBlock([['aa', 11], ['bb', 36]]);
    store.setDocument({ blocks: [block] });
    editor = initialize(container, store);

    editor._setSelectionForTest({
      anchor: { blockId: block.id, offset: 0 },
      focus: { blockId: block.id, offset: 4 },
    });

    const before = doc.getUndoStackForTest().length;
    editor.stepSelectionFontSize(1, clamp);
    expect(doc.getUndoStackForTest().length).toBe(before + 1);

    const inlines = store.getDocument().blocks[0].inlines;
    expect(inlines[0].style.fontSize).toBe(12);
    expect(inlines[1].style.fontSize).toBe(37);

    editor.undo();
    const restored = store.getDocument().blocks[0].inlines;
    expect(restored[0].style.fontSize).toBe(11);
    expect(restored[1].style.fontSize).toBe(36);
  });

  it('a cross-block relative step is a single undo unit that restores every touched block', () => {
    const b1 = multiRunBlock([['first', 14]]);
    const b2 = multiRunBlock([['second', 18]]);
    store.setDocument({ blocks: [b1, b2] });
    editor = initialize(container, store);

    editor._setSelectionForTest({
      anchor: { blockId: b1.id, offset: 0 },
      focus: { blockId: b2.id, offset: 6 },
    });

    const before = doc.getUndoStackForTest().length;
    editor.stepSelectionFontSize(-1, clamp);
    expect(doc.getUndoStackForTest().length).toBe(before + 1);

    const afterStep = store.getDocument();
    expect(afterStep.blocks[0].inlines[0].style.fontSize).toBe(13);
    expect(afterStep.blocks[1].inlines[0].style.fontSize).toBe(17);

    editor.undo();
    const restored = store.getDocument();
    expect(restored.blocks[0].inlines[0].style.fontSize).toBe(14);
    expect(restored.blocks[1].inlines[0].style.fontSize).toBe(18);
  });

  it('does not push a phantom undo unit when every run is already at the clamp boundary', () => {
    const block = multiRunBlock([['aa', 400], ['bb', 400]]);
    store.setDocument({ blocks: [block] });
    editor = initialize(container, store);

    editor._setSelectionForTest({
      anchor: { blockId: block.id, offset: 0 },
      focus: { blockId: block.id, offset: 4 },
    });

    const before = doc.getUndoStackForTest().length;
    editor.stepSelectionFontSize(1, clamp);
    expect(doc.getUndoStackForTest().length).toBe(before);
  });
});

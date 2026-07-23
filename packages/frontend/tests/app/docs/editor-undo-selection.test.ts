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
 * Editor-level regression for issue #340 (toolbar/⌘B path). The store unit
 * tests cover the recording/restore contract when `setCursorForHistory` is
 * called with a selection; this test drives the *public editor API* end to
 * end to guard that `applyStyleImpl` actually records the caret + selection
 * before mutating — without it, undo restores nothing and this fails.
 *
 * jsdom has no real Canvas 2D context, so we shim `getContext` (mirrors the
 * docs-package editor tests). The undo/selection logic runs independent of
 * paint.
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
  (HTMLCanvasElement.prototype as unknown as {
    getContext: (kind: string) => unknown;
  }).getContext = (kind: string) => (kind === '2d' ? fakeCtx : null);
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

  beforeEach(() => {
    installCanvasShim();
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

// @vitest-environment jsdom
import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import yorkie from '@yorkie-js/sdk';
import { YorkieDocStore } from '../../../src/app/docs/yorkie-doc-store.ts';
import {
  initialize,
  generateBlockId,
  DEFAULT_BLOCK_STYLE,
  FindReplaceState,
  type EditorAPI,
  type Block,
  type DocPosition,
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
 * - issue #1045 (select-all then type): the whole replacement must be ONE
 *   undo unit, or a document larger than Yorkie's 50-entry undo cap loses its
 *   tail permanently.
 * - the live caret peers see: batching an edit must not swallow the caret
 *   publish that follows it, so presence still agrees with the local caret
 *   once the unit commits.
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
/**
 * Every 2D-context method call the shim saw, by name. `save` is called once
 * per `paint()` in this environment, which is what lets the render-deferral
 * test below count paints. Reset with {@link resetCtxCalls}.
 */
const ctxCalls: Record<string, number> = {};
function resetCtxCalls(): void {
  for (const key of Object.keys(ctxCalls)) delete ctxCalls[key];
}

function installCanvasShim(): () => void {
  const ctxHandler: ProxyHandler<object> = {
    get(_t, prop) {
      const name = String(prop);
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
      return () => {
        ctxCalls[name] = (ctxCalls[name] ?? 0) + 1;
      };
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
 * `insertBlocks()` still splits the destination block, rewrites the head,
 * inserts the batch, and rewrites the tail as separate store writes — four
 * of them, which is what this used to cost. `applyPastePlan`'s
 * `withUndoUnit` now folds those (and the delete a paste over a selection
 * runs first) into one `doc.update()`, so the cost is exactly ONE, whatever
 * is pasted and whatever it replaces. Both properties are asserted: the
 * absolute cost, which `applyPastePlan`'s doc comment claims, and the older,
 * weaker "constant in the size of the paste", which is what fails loudest if
 * the batch is ever dropped.
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

  function pasteHtml(html: string, range?: {
    anchor: { blockId: string; offset: number };
    focus: { blockId: string; offset: number };
  }): void {
    const block = store.getDocument().blocks[0];
    editor._setSelectionForTest(range ?? {
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
    // And the absolute cost `applyPastePlan` documents: the split, the head
    // rewrite, the batched insert and the tail rewrite are one `doc.update()`
    // now, not four. Asserted exactly — the claim in the doc comment is "one
    // undo unit", and a ceiling would let a regression to 4 pass.
    expect(small).toBe(1);
  });

  it('a paste over a multi-block selection is one undo unit', () => {
    // The paste path deletes first, so this is the composite case: the
    // delete's per-block writes and the insert's four all have to land in
    // the same unit. `seed` alone is not enough to span blocks, so grow the
    // document with a first paste and then paste over the result.
    pasteHtml(htmlWithParagraphs(8));
    const blocks = store.getDocument().blocks;
    const last = blocks[blocks.length - 1];
    const range = {
      anchor: { blockId: blocks[0].id, offset: 0 },
      focus: {
        blockId: last.id,
        offset: last.inlines.map((i) => i.text).join('').length,
      },
    };
    const original = store.getDocument().blocks.map((b) =>
      b.inlines.map((i) => i.text).join(''),
    );

    const before = doc.getUndoStackForTest().length;
    pasteHtml('<p>Replacement</p>', range);
    expect(doc.getUndoStackForTest().length).toBe(before + 1);

    editor.undo();
    expect(
      store.getDocument().blocks.map((b) => b.inlines.map((i) => i.text).join('')),
    ).toEqual(original);
  });
});

/**
 * Select-all then type (issue #1045).
 *
 * `deleteSelection()` removes one block per store write, and outside a
 * `DocStore.batch()` every write is its own `doc.update()` — one Yorkie undo
 * unit. On a 100-paragraph document that made a single keystroke cost ~102
 * units against a stack capped at 50, and because the delete runs backwards
 * the entries dropped first were the ones holding the *tail* of the document.
 * More than half the content could not be recovered by any number of undos.
 *
 * The document is deliberately larger than the 50-entry cap: at 40 paragraphs
 * the old code was merely annoying, at 100 it destroyed data.
 */
describe('select-all then type is one undo unit (issue #1045)', () => {
  const PARAGRAPHS = 100;
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
    store.setDocument({
      blocks: Array.from({ length: PARAGRAPHS }, (_, i) => makeBlock(`Paragraph ${i}`)),
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    editor = initialize(container, store);
  });

  afterEach(() => {
    container.remove();
    restoreCanvas();
  });

  const texts = (): string[] =>
    store.getDocument().blocks.map((b) => b.inlines.map((i) => i.text).join(''));

  function selectAll(): void {
    const blocks = store.getDocument().blocks;
    const last = blocks[blocks.length - 1];
    editor._setSelectionForTest({
      anchor: { blockId: blocks[0].id, offset: 0 },
      focus: {
        blockId: last.id,
        offset: last.inlines.map((i) => i.text).join('').length,
      },
    });
  }

  function type(char: string): void {
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = char;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  it('replaces the whole document for one undo unit', () => {
    selectAll();
    const before = doc.getUndoStackForTest().length;
    type('X');

    // The edit really did replace everything.
    expect(texts()).toEqual(['X']);
    // ...and cost one Cmd+Z, not one per deleted block.
    expect(doc.getUndoStackForTest().length).toBe(before + 1);
  });

  it('one undo brings every paragraph back', () => {
    const original = texts();
    expect(original).toHaveLength(PARAGRAPHS);

    selectAll();
    type('X');
    editor.undo();

    // Before the fix this restored ~48 blocks and the tail was gone for good.
    expect(texts()).toEqual(original);
  });

  // `withUndoUnit` holds every interior `requestRender()` and replays it once
  // after the outermost unit commits, so the screen never shows a half-written
  // batch. Counted through the canvas shim: `paint()` calls `ctx.save()`
  // exactly once per pass here, and typing over a selection runs two interior
  // renders (the delete's and the insert's). Without the hold this is 2.
  it('paints once for the whole action, after the unit commits', () => {
    selectAll();
    resetCtxCalls();
    type('X');

    expect(ctxCalls.save).toBe(1);
    // Held, not swallowed: the one paint really did happen, and it shows the
    // committed state rather than the pre-edit one.
    expect(texts()).toEqual(['X']);
  });

  it('backspace over a select-all is one undo unit too', () => {
    const original = texts();
    selectAll();
    const before = doc.getUndoStackForTest().length;
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }),
    );

    expect(doc.getUndoStackForTest().length).toBe(before + 1);
    editor.undo();
    expect(texts()).toEqual(original);
  });

  /**
   * The three remaining composite actions that wrap `deleteSelection()`
   * together with the writes that follow it: Enter (split), Cmd+Enter (page
   * break) and Cmd+Shift+V (plain-text paste). Each is the #1045 shape — delete
   * N blocks, then write — so each overflows the 50-entry cap on a document
   * this size if its unit is ever dropped, and the tail is unrecoverable.
   *
   * Asserted on both halves deliberately: the count alone would pass if the
   * unit committed nothing, and the round-trip alone would pass on a document
   * small enough to fit under the cap.
   */
  function pressKey(key: string, init: KeyboardEventInit = {}): void {
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
    );
  }

  it('enter over a select-all is one undo unit', () => {
    const original = texts();
    selectAll();
    const before = doc.getUndoStackForTest().length;
    pressKey('Enter');

    expect(doc.getUndoStackForTest().length).toBe(before + 1);
    editor.undo();
    expect(texts()).toEqual(original);
  });

  it('a page break over a select-all is one undo unit', () => {
    const original = texts();
    selectAll();
    const before = doc.getUndoStackForTest().length;
    pressKey('Enter', { metaKey: true });

    // The page break really was inserted, so the unit is not vacuously empty.
    expect(
      store.getDocument().blocks.some((b) => b.type === 'page-break'),
    ).toBe(true);
    expect(doc.getUndoStackForTest().length).toBe(before + 1);
    editor.undo();
    expect(texts()).toEqual(original);
  });

  /**
   * Korean typing over a select-all, on the software-Hangul path (Mobile
   * Safari sends raw jamo with no composition events, so the editor assembles
   * syllables itself). Both halves of that path replace the selection and are
   * therefore the #1045 shape:
   *
   * - a jamo that cannot start a syllable — `ㄳ`, a compound consonant with no
   *   lead mapping — commits immediately, so `applyHangulResult` deletes the
   *   selection and writes the character in one breath (`withUndoUnit`);
   * - an ordinary lead jamo starts a view-local preview instead, and the only
   *   thing written is the selection delete.
   *
   * Either one losing its unit costs one Cmd+Z per deleted block, which on a
   * document this size overflows Yorkie's 50-entry cap and takes the tail of
   * the document with it — unrecoverable, exactly as in #1045.
   */
  it('a Hangul commit over a select-all is one undo unit', () => {
    const original = texts();
    selectAll();
    const before = doc.getUndoStackForTest().length;
    type('ㄳ');

    // The commit really landed, so the unit is not vacuously empty.
    expect(texts().join('')).toBe('ㄳ');
    expect(doc.getUndoStackForTest().length).toBe(before + 1);
    editor.undo();
    expect(texts()).toEqual(original);
  });

  it('the first jamo of a syllable clears a select-all as one undo unit', () => {
    const original = texts();
    selectAll();
    const before = doc.getUndoStackForTest().length;
    type('ㄱ');

    // The syllable preview is view-local; only the delete reached the store.
    expect(texts().join('')).toBe('');
    expect(doc.getUndoStackForTest().length).toBe(before + 1);
    editor.undo();
    expect(texts()).toEqual(original);
  });

  it('a plain-text paste over a select-all is one undo unit', async () => {
    const original = texts();
    const readText = vi.fn().mockResolvedValue('Pasted');
    // Defined on the real `navigator` rather than stubbed wholesale: the
    // editor reads `navigator.platform` to decide whether Cmd or Ctrl is the
    // modifier, and that lives on the prototype, so a spread replacement
    // silently makes every `mod` shortcut dead.
    const hadClipboard = 'clipboard' in navigator;
    const priorClipboard = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', {
      value: { readText },
      configurable: true,
    });

    try {
      selectAll();
      const before = doc.getUndoStackForTest().length;
      // Both modifiers, so the assertion does not depend on the host platform.
      pressKey('v', { metaKey: true, ctrlKey: true, shiftKey: true });
      // `pastePlainTextFromClipboard` awaits the clipboard read, so the writes
      // land a microtask after the keydown returns.
      await vi.waitFor(() => expect(readText).toHaveBeenCalled());
      await Promise.resolve();

      expect(texts()).toEqual(['Pasted']);
      expect(doc.getUndoStackForTest().length).toBe(before + 1);
      editor.undo();
      expect(texts()).toEqual(original);
    } finally {
      if (hadClipboard) {
        Object.defineProperty(navigator, 'clipboard', {
          value: priorClipboard,
          configurable: true,
        });
      } else {
        delete (navigator as { clipboard?: unknown }).clipboard;
      }
    }
  });

  /**
   * The inline-style actions, which are the #1045 shape without deleting
   * anything. `Doc.applyInlineStyle` walks the range slice by slice and calls
   * `store.applyStyle` once per slice, so bolding this document cost 100
   * `doc.update()`s — twice the cap, so the first fifty paragraphs' styling
   * could never be undone.
   *
   * Both entry points are covered because they are separate code paths onto
   * the same `Doc` call: the keyboard's `TextEditor.applyStyleToSelection`
   * (which clear-formatting and the format painter share) and the toolbar's
   * `applyStyleImpl` in `editor.ts`.
   */
  const boldCount = (): number =>
    store
      .getDocument()
      .blocks.filter((b) => b.inlines.every((i) => i.style.bold === true))
      .length;

  it('bold over a select-all is one undo unit', () => {
    selectAll();
    const before = doc.getUndoStackForTest().length;
    // Both modifiers, so the assertion does not depend on the host platform.
    pressKey('b', { metaKey: true, ctrlKey: true });

    expect(boldCount()).toBe(PARAGRAPHS);
    expect(doc.getUndoStackForTest().length).toBe(before + 1);
    editor.undo();
    expect(boldCount()).toBe(0);
  });

  it('the toolbar style path over a select-all is one undo unit', () => {
    selectAll();
    const before = doc.getUndoStackForTest().length;
    editor.applyStyle({ bold: true });

    expect(boldCount()).toBe(PARAGRAPHS);
    expect(doc.getUndoStackForTest().length).toBe(before + 1);
    editor.undo();
    expect(boldCount()).toBe(0);
  });
});

/**
 * The block-level actions that write once per selected block: Tab / Shift+Tab
 * on a list, and Cmd+] / Cmd+[ anywhere. Each drives `forEachBlockInSelection`
 * with a `setBlockType` (or `applyBlockStyle`) inside, so over a selection
 * larger than Yorkie's 50-entry undo cap the earliest blocks' change was
 * dropped from the stack and could never be undone — #1045 again, with no
 * deletion involved.
 */
function makeListBlock(text: string): Block {
  return {
    id: generateBlockId(),
    type: 'list-item',
    listKind: 'unordered',
    listLevel: 1,
    inlines: [{ text, style: {} }],
    style: { ...DEFAULT_BLOCK_STYLE },
  };
}

describe('indenting a multi-block selection is one undo unit (issue #1045)', () => {
  const ITEMS = 100;
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
    store.setDocument({
      blocks: Array.from({ length: ITEMS }, (_, i) => makeListBlock(`Item ${i}`)),
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    editor = initialize(container, store);
  });

  afterEach(() => {
    container.remove();
    restoreCanvas();
  });

  const levels = (): number[] =>
    store.getDocument().blocks.map((b) => b.listLevel ?? 0);

  function selectAll(): void {
    const blocks = store.getDocument().blocks;
    const last = blocks[blocks.length - 1];
    editor._setSelectionForTest({
      anchor: { blockId: blocks[0].id, offset: 0 },
      focus: {
        blockId: last.id,
        offset: last.inlines.map((i) => i.text).join('').length,
      },
    });
  }

  function pressKey(key: string, init: KeyboardEventInit = {}): void {
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
    );
  }

  it('Tab over a multi-item list selection is one undo unit', () => {
    const original = levels();
    selectAll();
    const before = doc.getUndoStackForTest().length;
    pressKey('Tab');

    expect(levels()).toEqual(original.map((l) => l + 1));
    expect(doc.getUndoStackForTest().length).toBe(before + 1);
    editor.undo();
    expect(levels()).toEqual(original);
  });

  it('Cmd+] over a multi-block selection is one undo unit', () => {
    const original = levels();
    selectAll();
    const before = doc.getUndoStackForTest().length;
    pressKey(']', { metaKey: true, ctrlKey: true });

    expect(levels()).toEqual(original.map((l) => l + 1));
    expect(doc.getUndoStackForTest().length).toBe(before + 1);
    editor.undo();
    expect(levels()).toEqual(original);
  });

  it('Cmd+[ over a multi-block selection is one undo unit', () => {
    const original = levels();
    selectAll();
    const before = doc.getUndoStackForTest().length;
    pressKey('[', { metaKey: true, ctrlKey: true });

    expect(levels()).toEqual(original.map((l) => l - 1));
    expect(doc.getUndoStackForTest().length).toBe(before + 1);
    editor.undo();
    expect(levels()).toEqual(original);
  });
});

/**
 * The same #1045 shape reached through the **toolbar** rather than the
 * keyboard. `EditorAPI`'s block-level mutators each loop
 * `forEachBlockInSelection` with one `Doc` call inside, and one `Doc` call
 * outside a batch is one `doc.update()` — one Yorkie undo entry. Over a
 * selection longer than Yorkie's 50-entry cap `pushUndo` `shift()`s the
 * oldest of them off for good, so the earliest blocks' change becomes
 * un-undoable: exactly the data loss the keyboard twins above were fixed
 * for. Every one of these is a button a user clicks
 * (`docs-formatting-toolbar.tsx`, `text-paragraph-group.tsx`), so "Tab is
 * safe but Increase indent is not" was the shipped behaviour.
 */
describe('toolbar block mutators over a multi-block selection are one undo unit (issue #1045)', () => {
  const BLOCKS = 100;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let doc: any;
  let store: YorkieDocStore;
  let editor: EditorAPI;
  let container: HTMLDivElement;
  let restoreCanvas: () => void;

  function mount(blocks: Block[]): void {
    restoreCanvas = installCanvasShim();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    doc = new yorkie.Document<any>(`test-${Date.now()}-${Math.random()}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    doc.update((root: any) => {
      root.content = new yorkie.Tree({ type: 'doc', children: [] });
    });
    store = new YorkieDocStore(doc);
    store.setDocument({ blocks });
    container = document.createElement('div');
    document.body.appendChild(container);
    editor = initialize(container, store);
  }

  afterEach(() => {
    container.remove();
    restoreCanvas();
  });

  function selectAll(): void {
    const blocks = store.getDocument().blocks;
    const last = blocks[blocks.length - 1];
    editor._setSelectionForTest({
      anchor: { blockId: blocks[0].id, offset: 0 },
      focus: {
        blockId: last.id,
        offset: last.inlines.map((i) => i.text).join('').length,
      },
    });
  }

  const alignments = (): Array<string | undefined> =>
    store.getDocument().blocks.map((b) => b.style.alignment);
  const types = (): string[] => store.getDocument().blocks.map((b) => b.type);
  const levels = (): number[] =>
    store.getDocument().blocks.map((b) => b.listLevel ?? 0);
  const margins = (): number[] =>
    store.getDocument().blocks.map((b) => b.style.marginLeft ?? 0);

  it('applyBlockStyle over a select-all is one undo unit', () => {
    mount(Array.from({ length: BLOCKS }, (_, i) => makeBlock(`Paragraph ${i}`)));
    const original = alignments();
    selectAll();
    const before = doc.getUndoStackForTest().length;

    editor.applyBlockStyle({ alignment: 'center' });

    expect(alignments().every((a) => a === 'center')).toBe(true);
    expect(doc.getUndoStackForTest().length).toBe(before + 1);
    editor.undo();
    expect(alignments()).toEqual(original);
  });

  it('toggleList over a select-all is one undo unit', () => {
    mount(Array.from({ length: BLOCKS }, (_, i) => makeBlock(`Paragraph ${i}`)));
    const original = types();
    selectAll();
    const before = doc.getUndoStackForTest().length;

    editor.toggleList('unordered');

    expect(types().every((t) => t === 'list-item')).toBe(true);
    expect(doc.getUndoStackForTest().length).toBe(before + 1);
    editor.undo();
    expect(types()).toEqual(original);
  });

  it('the indent button over a select-all is one undo unit', () => {
    mount(Array.from({ length: BLOCKS }, (_, i) => makeListBlock(`Item ${i}`)));
    const original = levels();
    selectAll();
    const before = doc.getUndoStackForTest().length;

    editor.indent();

    expect(levels()).toEqual(original.map((l) => l + 1));
    expect(doc.getUndoStackForTest().length).toBe(before + 1);
    editor.undo();
    expect(levels()).toEqual(original);
  });

  it('the outdent button over a select-all is one undo unit', () => {
    mount(Array.from({ length: BLOCKS }, (_, i) => makeListBlock(`Item ${i}`)));
    const original = levels();
    selectAll();
    const before = doc.getUndoStackForTest().length;

    editor.outdent();

    expect(levels()).toEqual(original.map((l) => l - 1));
    expect(doc.getUndoStackForTest().length).toBe(before + 1);
    editor.undo();
    expect(levels()).toEqual(original);
  });

  it('the indent button over non-list paragraphs is one undo unit', () => {
    // The `applyBlockStyle` arm of the same loop — `marginLeft`, not
    // `listLevel` — so both branches of `indent()` are pinned.
    mount(Array.from({ length: BLOCKS }, (_, i) => makeBlock(`Paragraph ${i}`)));
    const original = margins();
    selectAll();
    const before = doc.getUndoStackForTest().length;

    editor.indent();

    expect(margins()).toEqual(original.map((m) => m + 36));
    expect(doc.getUndoStackForTest().length).toBe(before + 1);
    editor.undo();
    expect(margins()).toEqual(original);
  });
});

/**
 * `FindReplaceState` writes twice per match (a `deleteText` then an
 * `insertText`), so Replace All over a document with more than 25 matches
 * used to exceed Yorkie's 50-entry cap on its own — the earliest
 * replacements were unrecoverable. Driven the way `docs-find-bar.tsx`
 * drives it: against `editor.getDoc()`, with `editor.getStore().snapshot`
 * as the snapshot hook.
 */
describe('find & replace undo cost (issue #1045)', () => {
  const MATCHES = 100;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let doc: any;
  let store: YorkieDocStore;
  let editor: EditorAPI;
  let container: HTMLDivElement;
  let restoreCanvas: () => void;
  let find: FindReplaceState;

  beforeEach(() => {
    restoreCanvas = installCanvasShim();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    doc = new yorkie.Document<any>(`test-${Date.now()}-${Math.random()}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    doc.update((root: any) => {
      root.content = new yorkie.Tree({ type: 'doc', children: [] });
    });
    store = new YorkieDocStore(doc);
    store.setDocument({
      blocks: Array.from({ length: MATCHES }, () => makeBlock('needle here')),
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    editor = initialize(container, store);
    find = new FindReplaceState(editor.getDoc(), () =>
      editor.getStore().snapshot(),
    );
  });

  afterEach(() => {
    container.remove();
    restoreCanvas();
  });

  const texts = (): string[] =>
    store.getDocument().blocks.map((b) => b.inlines.map((i) => i.text).join(''));

  it('replaceAll over every match is one undo unit', () => {
    find.search('needle');
    expect(find.matches).toHaveLength(MATCHES);
    const before = doc.getUndoStackForTest().length;

    find.replaceAll('pin');

    expect(texts().every((t) => t === 'pin here')).toBe(true);
    expect(doc.getUndoStackForTest().length).toBe(before + 1);
    editor.undo();
    expect(texts().every((t) => t === 'needle here')).toBe(true);
  });

  it('replaceActive is one undo unit, not two', () => {
    // Delete-then-insert is two writes for one user action, so this cost a
    // dead Cmd+Z before the batch.
    find.search('needle');
    const before = doc.getUndoStackForTest().length;

    find.replaceActive('pin');

    expect(texts()[0]).toBe('pin here');
    expect(doc.getUndoStackForTest().length).toBe(before + 1);
    editor.undo();
    expect(texts()[0]).toBe('needle here');
  });
});

/**
 * The two cell-range write paths: `applyTableCellStyle` (one
 * `doc.applyCellStyle` per cell) and `insertLink`'s cell-range arm (which
 * reaches `Doc.applyInlineStyleToCells`, one `store.applyStyle` per slice).
 * An 8×8 table is 64 cells — past the 50-entry cap for a single click.
 */
describe('cell-range writes are one undo unit (issue #1045)', () => {
  const SIZE = 8;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let doc: any;
  let store: YorkieDocStore;
  let editor: EditorAPI;
  let container: HTMLDivElement;
  let restoreCanvas: () => void;
  let tableId: string;

  beforeEach(() => {
    restoreCanvas = installCanvasShim();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    doc = new yorkie.Document<any>(`test-${Date.now()}-${Math.random()}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    doc.update((root: any) => {
      root.content = new yorkie.Tree({ type: 'doc', children: [] });
    });
    store = new YorkieDocStore(doc);
    // Built by hand rather than through `editor.insertTable`, because the
    // cells have to hold text: `Doc.applyInlineStyleToCells` writes one
    // slice per non-empty block, so an empty table would make the
    // `insertLink` case below assert against zero writes.
    const table: Block = {
      id: generateBlockId(),
      type: 'table',
      inlines: [],
      style: { ...DEFAULT_BLOCK_STYLE },
      tableData: {
        rows: Array.from({ length: SIZE }, (_, r) => ({
          cells: Array.from({ length: SIZE }, (_, c) => ({
            blocks: [makeBlock(`r${r}c${c}`)],
            style: {},
          })),
        })),
        columnWidths: Array.from({ length: SIZE }, () => 1 / SIZE),
      },
    };
    store.setDocument({ blocks: [makeBlock('Intro'), table] });
    tableId = table.id;
    container = document.createElement('div');
    document.body.appendChild(container);
    editor = initialize(container, store);
    selectWholeTable();
  });

  afterEach(() => {
    container.remove();
    restoreCanvas();
  });

  function tableBlock(): Block {
    return store.getDocument().blocks.find((b) => b.id === tableId)!;
  }

  function selectWholeTable(): void {
    const rows = tableBlock().tableData!.rows;
    const first = rows[0].cells[0].blocks[0];
    const last = rows[SIZE - 1].cells[SIZE - 1].blocks[0];
    editor._setSelectionForTest({
      anchor: { blockId: first.id, offset: 0 },
      focus: { blockId: last.id, offset: 0 },
      tableCellRange: {
        blockId: tableId,
        start: { rowIndex: 0, colIndex: 0 },
        end: { rowIndex: SIZE - 1, colIndex: SIZE - 1 },
      },
    });
  }

  const cellBackgrounds = (): Array<string | undefined> =>
    tableBlock().tableData!.rows.flatMap((r) =>
      r.cells.map((c) => c.style?.backgroundColor),
    );

  it('applyTableCellStyle over a cell rectangle is one undo unit', () => {
    const before = doc.getUndoStackForTest().length;

    editor.applyTableCellStyle({ backgroundColor: '#ff0000' });

    expect(cellBackgrounds().every((c) => c === '#ff0000')).toBe(true);
    expect(doc.getUndoStackForTest().length).toBe(before + 1);
    editor.undo();
    expect(cellBackgrounds().every((c) => c === undefined)).toBe(true);
  });

  it("insertLink's cell-range arm is one undo unit", () => {
    const before = doc.getUndoStackForTest().length;

    editor.insertLink('https://example.com');

    expect(doc.getUndoStackForTest().length).toBe(before + 1);
  });
});

/**
 * `insertLink`'s **plain** range arm — the third of its three selection
 * shapes, and the one a ⌘K over a multi-block selection reaches:
 * `linkRunCoveringRange` returns nothing for a cross-block range, so neither
 * the cell-rectangle arm above nor the single-link rewrite arm applies.
 * `Doc.applyInlineStyle` writes one `store.applyStyle` per block, so the href
 * cost one Cmd+Z per block and, past Yorkie's 50-entry cap, stranded the
 * earliest blocks' `href` beyond any number of undo presses. Less severe than
 * the #1045 losses — a stranded link is repairable with Remove link, where a
 * dropped delete lost content — but the same defect, and the batch is the same
 * one line.
 */
describe("insertLink's plain multi-block arm is one undo unit (issue #1045)", () => {
  const BLOCKS = 60;
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
    store.setDocument({
      blocks: Array.from({ length: BLOCKS }, (_, i) => makeBlock(`Line ${i}`)),
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    editor = initialize(container, store);
    const blocks = store.getDocument().blocks;
    const last = blocks[blocks.length - 1];
    editor._setSelectionForTest({
      anchor: { blockId: blocks[0].id, offset: 0 },
      focus: {
        blockId: last.id,
        offset: last.inlines.map((i) => i.text).join('').length,
      },
    });
  });

  afterEach(() => {
    container.remove();
    restoreCanvas();
  });

  const hrefs = (): Array<string | undefined> =>
    store.getDocument().blocks.map((b) => b.inlines[0]?.style.href);

  it('links every selected block for one Cmd+Z', () => {
    const before = doc.getUndoStackForTest().length;

    editor.insertLink('https://example.com');

    expect(hrefs().every((h) => h === 'https://example.com')).toBe(true);
    expect(doc.getUndoStackForTest().length).toBe(before + 1);
    editor.undo();
    // The whole span comes back unlinked. Unbatched, 60 blocks past the
    // 50-entry cap left the first ten linked for good.
    expect(hrefs().every((h) => h === undefined)).toBe(true);
  });
});

/**
 * Redefining a named style is two store writes: the registry write itself
 * (`updateStyleDefinition` → `writeStylesAndRematerialize`) and the
 * stale-style-off sweep it triggers (`Doc.dropStaleStyleOffAll` →
 * `store.applyStyles`). Each is one `doc.update()`, and `YorkieDocStore`
 * takes its undo units from `doc.update()`, so before `DocStore.batch()`
 * this cost **two** Cmd+Z — the first of which looked like it did nothing.
 *
 * The setup below is the exact case docs-font-controls.md describes: the
 * built-in Heading 6 is italic, so `styleOffAsClear` legitimately keeps an
 * `italic: false` on a Heading 6 run. "Update Heading 6 to match" a caret
 * sitting in that run redefines Heading 6 as non-italic — which makes the
 * run's stored `false` a dead flag, and fires the sweep.
 */
function heading6Block(text: string, style: Record<string, unknown>): Block {
  return {
    id: generateBlockId(),
    type: 'heading',
    headingLevel: 6,
    inlines: [{ text, style }],
    style: { ...DEFAULT_BLOCK_STYLE },
  };
}

describe('named-style redefinition undo cost (DocStore.batch seam)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let doc: any;
  let store: YorkieDocStore;
  let editor: EditorAPI;
  let container: HTMLDivElement;
  let restoreCanvas: () => void;
  let block: Block;
  let untouched: Block;

  beforeEach(() => {
    restoreCanvas = installCanvasShim();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    doc = new yorkie.Document<any>(`test-${Date.now()}-${Math.random()}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    doc.update((root: any) => {
      root.content = new yorkie.Tree({ type: 'doc', children: [] });
    });
    store = new YorkieDocStore(doc);
    // The caret run also carries an explicit size, so "update to match"
    // redefines Heading 6 to something a *different* Heading 6 block would
    // visibly resolve — which is how the rollback test below observes the
    // editor's cached document.
    block = heading6Block('Heading text', { italic: false, fontSize: 33 });
    untouched = heading6Block('Second heading', {});
    store.setDocument({ blocks: [block, untouched] });
    container = document.createElement('div');
    document.body.appendChild(container);
    editor = initialize(container, store);
    editor._setSelectionForTest({
      anchor: { blockId: block.id, offset: 0 },
      focus: { blockId: block.id, offset: 0 },
    });
  });

  afterEach(() => {
    container.remove();
    restoreCanvas();
  });

  const italicOf = () => store.getDocument().blocks[0].inlines[0].style.italic;

  it('sanity: the fixture really does strand a style-off flag', () => {
    expect(italicOf()).toBe(false);
    editor.updateStyleToMatch('heading-6');
    // The registry now says Heading 6 is not italic, so the run's stored
    // `false` no longer overrides anything and the sweep drops it. If this
    // ever stops holding, the undo-cost assertion below stops testing the
    // two-write path it is named for.
    expect(store.getDocStyles()['heading-6']?.inline.italic).toBe(false);
    expect(italicOf()).toBeUndefined();
  });

  it('"Update to match" that strands a flag is a single undo unit', () => {
    const before = doc.getUndoStackForTest().length;
    editor.updateStyleToMatch('heading-6');
    expect(doc.getUndoStackForTest().length).toBe(before + 1);
  });

  it('one undo restores both the registry and the stranded flag', () => {
    editor.updateStyleToMatch('heading-6');
    expect(store.getDocStyles()['heading-6']).toBeDefined();

    editor.undo();
    expect(store.getDocStyles()['heading-6']).toBeUndefined();
    expect(italicOf()).toBe(false);
  });

  it('resetAllNamedStyles is a single undo unit too', () => {
    editor.updateStyleToMatch('heading-6');
    const before = doc.getUndoStackForTest().length;
    editor.resetAllNamedStyles();
    expect(doc.getUndoStackForTest().length).toBe(before + 1);
  });

  // Boundary: batching must fold one action's writes together, never two
  // separate actions into each other.
  it('two separate named-style actions stay two undo units', () => {
    const before = doc.getUndoStackForTest().length;
    editor.updateStyleToMatch('heading-6');
    editor.resetNamedStyle('heading-6');
    expect(doc.getUndoStackForTest().length).toBe(before + 2);
  });

  // Batching also changed what a *failure* mid-action means. The two writes
  // used to be two `doc.update()`s, so a failed second one left the first
  // committed and the editor's cached document matched it. Now the whole
  // batch is one update that Yorkie discards on a throw — while the sweep
  // has already refreshed the cache from the in-progress state. The cache
  // has to be re-read, or the editor is the only holder of a redefinition
  // that never landed.
  it('a failed redefinition leaves the editor matching the store', () => {
    const sweep = vi.spyOn(store, 'applyStyles').mockImplementation(() => {
      throw new Error('sweep failed');
    });
    expect(() => editor.updateStyleToMatch('heading-6')).toThrow('sweep failed');
    sweep.mockRestore();

    // The registry write is rolled back with the rest of the batch.
    expect(store.getDocStyles()['heading-6']).toBeUndefined();

    // A caret in the untouched Heading 6 block resolves its size from the
    // named-style layer, which the editor reads out of its cached document.
    // A stale cache would still report the never-committed 33.
    editor._setSelectionForTest({
      anchor: { blockId: untouched.id, offset: 0 },
      focus: { blockId: untouched.id, offset: 0 },
    });
    expect(editor.getRangeStyleSummary().fontSize).not.toBe(33);
  });
});

/**
 * The live caret peers see, across a batched edit.
 *
 * An undo unit is one `doc.update()`, and inside one `YorkieDocStore` drops a
 * presence write made without `addToHistory` (`skipNonHistoryPresence`) —
 * folding it into the same change would erase the reverse presence
 * `recordHistoryPresence` staged there. The caret publish is such a write, so
 * a unit that moves the caret has to emit it *after* the unit commits, which
 * is what `TextEditor.withUndoUnit`'s held render does: the caret publish
 * rides on the same replayed `requestRender()` the paint does
 * (`afterCursorRender` in `view/editor.ts` fires the `onCursorMove`
 * subscribers, and `DocsView`'s is the one that writes presence).
 *
 * What this pins is the end state rather than the mechanism: after an ordinary
 * keystroke, presence must agree with the local caret — **affinity included**.
 * Affinity is the part only the post-unit publish carries. Each write also
 * stages a history presence of its own, but as a bare `{blockId, offset}`
 * (see `YorkieDocStore.insertText`), so with the publish swallowed peers get a
 * caret with no reading of its wrap boundary and undo restores one too.
 *
 * The subscriber below is `DocsView`'s, reduced to its synchronous arm: at
 * ordinary typing cadence the throttle defers instead, which lands the same
 * publish on a timer. Either way it must not land inside the batch.
 */
describe('a batched edit publishes the caret it ends at', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let doc: any;
  let store: YorkieDocStore;
  let editor: EditorAPI;
  let container: HTMLDivElement;
  let restoreCanvas: () => void;
  let published: DocPosition[];

  beforeEach(() => {
    restoreCanvas = installCanvasShim();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    doc = new yorkie.Document<any>(`test-${Date.now()}-${Math.random()}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    doc.update((root: any) => {
      root.content = new yorkie.Tree({ type: 'doc', children: [] });
    });
    store = new YorkieDocStore(doc);
    store.setDocument({ blocks: [makeBlock('Hello')] });
    container = document.createElement('div');
    document.body.appendChild(container);
    editor = initialize(container, store);
    published = [];
    editor.onCursorMove((pos, sel) => {
      published.push(pos);
      store.updateCursorPos(pos, sel ?? null);
    });
  });

  afterEach(() => {
    container.remove();
    restoreCanvas();
  });

  function caretAt(offset: number): DocPosition {
    const pos = { blockId: store.getDocument().blocks[0].id, offset };
    editor._setSelectionForTest({ anchor: pos, focus: pos });
    return pos;
  }

  function type(char: string): void {
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = char;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  const blockTexts = (): string[] =>
    store.getDocument().blocks.map((b) => b.inlines.map((i) => i.text).join(''));

  it('typing leaves presence on the caret after the character', () => {
    const before = caretAt(5);
    published = [];
    type('X');

    expect(blockTexts()).toEqual(['HelloX']);
    // One publish for the whole action, and it happened at all.
    expect(published).toHaveLength(1);
    expect(published[0].offset).not.toBe(before.offset);
    // Presence is what peers read. Exact equality, so a publish that never
    // escaped the batch — leaving only the write's bare history presence —
    // fails here rather than passing on a partial match.
    expect(store.getPresenceCursorPos()).toEqual(editor._getCursorForTest());
    expect(store.getPresenceCursorPos()).toMatchObject({
      blockId: before.blockId,
      offset: 6,
    });
  });

  it('Enter leaves presence in the block it created', () => {
    caretAt(3);
    published = [];
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );

    expect(blockTexts()).toEqual(['Hel', 'lo']);
    expect(store.getPresenceCursorPos()).toEqual(editor._getCursorForTest());
    expect(store.getPresenceCursorPos()).toMatchObject({
      blockId: store.getDocument().blocks[1].id,
      offset: 0,
    });
  });
});

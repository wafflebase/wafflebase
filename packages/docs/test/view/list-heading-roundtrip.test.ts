// @vitest-environment jsdom
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { MemDocStore } from '../../src/store/memory.js';
import { Doc } from '../../src/model/document.js';
import { initialize, type EditorAPI } from '../../src/view/editor.js';
import { normalizeBlockStyle, unlistedBlockType } from '../../src/model/types.js';
import type { Block } from '../../src/model/types.js';

/**
 * Bulleting a heading and un-bulleting it must give the heading back
 * (Google Docs / Word parity — the bullet is applied *to* the heading).
 *
 * Regression guard for #783: `setBlockType` dropped `headingLevel` the
 * moment the list was applied and `toggleList` hardcoded `'paragraph'` on
 * the way out, so the round trip silently downgraded a Heading 2 to body
 * text.
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

function makeHeading(id: string, text: string, headingLevel: 1 | 2 | 3): Block {
  return {
    id,
    type: 'heading',
    headingLevel,
    inlines: [{ text, style: {} }],
    style: normalizeBlockStyle({}),
  };
}

function makeParagraph(id: string, text: string): Block {
  return {
    id,
    type: 'paragraph',
    inlines: [{ text, style: {} }],
    style: normalizeBlockStyle({}),
  };
}

function setupEditor(blocks: Block[]): { editor: EditorAPI; container: HTMLElement } {
  const store = new MemDocStore();
  store.setDocument({ blocks });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const editor = initialize(container, store);
  return { editor, container };
}

describe('MemDocStore.setBlockType — heading level across a list', () => {
  test('a bulleted heading remembers its level', () => {
    const store = new MemDocStore({ blocks: [makeHeading('b1', 'Quarterly results', 2)] });

    store.setBlockType('b1', 'list-item', { listKind: 'unordered', listLevel: 0 });

    const block = store.getBlock('b1')!;
    expect(block.type).toBe('list-item');
    expect(block.headingLevel).toBe(2);
  });

  test('indenting a bulleted heading keeps the remembered level', () => {
    const store = new MemDocStore({ blocks: [makeHeading('b1', 'Quarterly results', 2)] });

    store.setBlockType('b1', 'list-item', { listKind: 'unordered', listLevel: 0 });
    store.setBlockType('b1', 'list-item', { listKind: 'unordered', listLevel: 1 });

    expect(store.getBlock('b1')!.headingLevel).toBe(2);
  });

  test('an explicit Normal text still clears the level', () => {
    const store = new MemDocStore({ blocks: [makeHeading('b1', 'Quarterly results', 2)] });

    store.setBlockType('b1', 'list-item', { listKind: 'unordered', listLevel: 0 });
    store.setBlockType('b1', 'paragraph');

    const block = store.getBlock('b1')!;
    expect(block.type).toBe('paragraph');
    expect(block.headingLevel).toBeUndefined();
  });

  test('a bulleted paragraph has no level to remember', () => {
    const store = new MemDocStore({ blocks: [makeParagraph('b1', 'body text')] });

    store.setBlockType('b1', 'list-item', { listKind: 'unordered', listLevel: 0 });

    expect(store.getBlock('b1')!.headingLevel).toBeUndefined();
  });
});

describe('unlistedBlockType', () => {
  test('a list item that came from a heading returns to that heading', () => {
    const block = makeHeading('b1', 'Quarterly results', 2);
    block.type = 'list-item';
    expect(unlistedBlockType(block)).toEqual({ type: 'heading', opts: { headingLevel: 2 } });
  });

  test('a plain list item returns to a paragraph', () => {
    expect(unlistedBlockType(makeParagraph('b1', 'body text'))).toEqual({ type: 'paragraph' });
  });
});

describe('keyboard list exits restore the heading', () => {
  function bulletedHeading(level: 1 | 2 | 3): Doc {
    const store = new MemDocStore({ blocks: [makeHeading('b1', '', level)] });
    const doc = new Doc(store);
    doc.setBlockType('b1', 'list-item', { listKind: 'unordered', listLevel: 0 });
    return doc;
  }

  test('Enter on an empty bulleted heading leaves a heading', () => {
    const doc = bulletedHeading(2);

    expect(doc.splitBlock('b1', 0)).toBe('b1');

    const block = doc.document.blocks[0];
    expect(doc.document.blocks).toHaveLength(1);
    expect(block.type).toBe('heading');
    expect(block.headingLevel).toBe(2);
  });

  test('Backspace on an empty bulleted heading leaves a heading', () => {
    const doc = bulletedHeading(3);

    expect(doc.deleteBackward({ blockId: 'b1', offset: 0 })).toEqual({
      blockId: 'b1',
      offset: 0,
    });

    const block = doc.document.blocks[0];
    expect(doc.document.blocks).toHaveLength(1);
    expect(block.type).toBe('heading');
    expect(block.headingLevel).toBe(3);
  });

  test('splitting a bulleted heading hands the level to the new bullet', () => {
    const store = new MemDocStore({ blocks: [makeHeading('b1', 'Quarterly results', 2)] });
    const doc = new Doc(store);
    doc.setBlockType('b1', 'list-item', { listKind: 'unordered', listLevel: 0 });

    // Enter at the end of the bullet: the new bullet must remember the
    // heading too, else only the first bullet restores on exit.
    const newId = doc.splitBlock('b1', 'Quarterly results'.length);
    const second = doc.document.blocks[1];
    expect(second.id).toBe(newId);
    expect(second.type).toBe('list-item');
    expect(second.headingLevel).toBe(2);

    doc.deleteBackward({ blockId: newId, offset: 0 });
    const exited = doc.document.blocks[1];
    expect(exited.type).toBe('heading');
    expect(exited.headingLevel).toBe(2);
  });
});

describe('toggleList round trip', () => {
  beforeEach(() => {
    installCanvasShim();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('bullet on then off gives the heading back', () => {
    const { editor } = setupEditor([makeHeading('b1', 'Quarterly results', 2)]);
    editor._setSelectionForTest({
      anchor: { blockId: 'b1', offset: 0 },
      focus: { blockId: 'b1', offset: 0 },
    });

    editor.toggleList('unordered');
    expect(editor.getDoc().document.blocks[0].type).toBe('list-item');

    editor.toggleList('unordered');
    const block = editor.getDoc().document.blocks[0];
    expect(block.type).toBe('heading');
    expect(block.headingLevel).toBe(2);
    editor.dispose();
  });

  test('bullet on then off leaves a paragraph a paragraph', () => {
    const { editor } = setupEditor([makeParagraph('b1', 'body text')]);
    editor._setSelectionForTest({
      anchor: { blockId: 'b1', offset: 0 },
      focus: { blockId: 'b1', offset: 0 },
    });

    editor.toggleList('unordered');
    editor.toggleList('unordered');

    const block = editor.getDoc().document.blocks[0];
    expect(block.type).toBe('paragraph');
    expect(block.headingLevel).toBeUndefined();
    editor.dispose();
  });

  test('switching bullet kind keeps the heading recoverable', () => {
    const { editor } = setupEditor([makeHeading('b1', 'Quarterly results', 3)]);
    editor._setSelectionForTest({
      anchor: { blockId: 'b1', offset: 0 },
      focus: { blockId: 'b1', offset: 0 },
    });

    editor.toggleList('unordered');
    editor.toggleList('ordered');
    editor.toggleList('ordered');

    const block = editor.getDoc().document.blocks[0];
    expect(block.type).toBe('heading');
    expect(block.headingLevel).toBe(3);
    editor.dispose();
  });
});

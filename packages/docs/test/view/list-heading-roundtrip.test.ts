// @vitest-environment jsdom
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import JSZip from 'jszip';
import { MemDocStore } from '../../src/store/memory.js';
import { Doc } from '../../src/model/document.js';
import { initialize, type EditorAPI } from '../../src/view/editor.js';
import { normalizeBlockStyle, unlistedBlockType } from '../../src/model/types.js';
import { blockStyleId } from '../../src/model/named-styles.js';
import { serializeMarkdown } from '../../src/serialize/markdown.js';
import { serializeText } from '../../src/serialize/text.js';
import { DocxExporter } from '../../src/export/docx-exporter.js';
import type { Block, Document } from '../../src/model/types.js';

// jsdom's Blob shim lacks arrayBuffer(); polyfill via FileReader (same shim
// the docx-exporter test uses).
if (typeof Blob.prototype.arrayBuffer !== 'function') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Blob.prototype as any).arrayBuffer = function arrayBuffer(this: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

async function docxDocumentXml(doc: Document): Promise<string> {
  const blob = await DocxExporter.export(doc);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  return (await zip.file('word/document.xml')!.async('string')) ?? '';
}

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

  test('splitting a bulleted heading leaves the new bullet plain', () => {
    const store = new MemDocStore({ blocks: [makeHeading('b1', 'Quarterly results', 2)] });
    const doc = new Doc(store);
    doc.setBlockType('b1', 'list-item', { listKind: 'unordered', listLevel: 0 });

    // The memory belongs to the block that was bulleted. Body text typed in
    // the bullets after it must not come back as a heading on exit.
    const newId = doc.splitBlock('b1', 'Quarterly results'.length);
    const second = doc.document.blocks[1];
    expect(second.id).toBe(newId);
    expect(second.type).toBe('list-item');
    expect(second.headingLevel).toBeUndefined();

    doc.deleteBackward({ blockId: newId, offset: 0 });
    expect(doc.document.blocks[1].type).toBe('paragraph');
  });
});

describe('a merge drops a heading memory it no longer describes', () => {
  test('body text merged into an emptied bulleted heading exits as a paragraph', () => {
    const store = new MemDocStore({
      blocks: [makeHeading('b1', 'Quarterly results', 2), makeParagraph('b2', 'body text')],
    });
    const doc = new Doc(store);
    doc.setBlockType('b1', 'list-item', { listKind: 'unordered', listLevel: 0 });
    doc.setBlockType('b2', 'list-item', { listKind: 'unordered', listLevel: 0 });

    // Empty the bulleted heading, then Backspace at the start of the next
    // bullet so its body text merges into it. Nothing of the heading is left,
    // so the remembered level must not survive the merge (#783 follow-up).
    doc.deleteText({ blockId: 'b1', offset: 0 }, 'Quarterly results'.length);
    doc.deleteBackward({ blockId: 'b2', offset: 0 });

    const merged = doc.document.blocks[0];
    expect(doc.document.blocks).toHaveLength(1);
    expect(merged.id).toBe('b1');
    expect(merged.inlines.map((i) => i.text).join('')).toBe('body text');
    expect(merged.headingLevel).toBeUndefined();
    expect(unlistedBlockType(merged)).toEqual({ type: 'paragraph' });

    // And the keyboard exit agrees: emptying the merged bullet and pressing
    // Backspace leaves body text, not a Heading 2.
    doc.deleteText({ blockId: 'b1', offset: 0 }, 'body text'.length);
    doc.deleteBackward({ blockId: 'b1', offset: 0 });
    expect(doc.document.blocks[0].type).toBe('paragraph');
    expect(doc.document.blocks[0].headingLevel).toBeUndefined();
  });

  test('a bulleted heading that keeps its own text keeps the memory', () => {
    const store = new MemDocStore({
      blocks: [makeHeading('b1', 'Quarterly results', 2), makeParagraph('b2', ' addendum')],
    });
    const doc = new Doc(store);
    doc.setBlockType('b1', 'list-item', { listKind: 'unordered', listLevel: 0 });
    doc.setBlockType('b2', 'list-item', { listKind: 'unordered', listLevel: 0 });

    doc.deleteBackward({ blockId: 'b2', offset: 0 });

    const merged = doc.document.blocks[0];
    expect(merged.inlines.map((i) => i.text).join('')).toBe('Quarterly results addendum');
    expect(merged.headingLevel).toBe(2);
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

/**
 * The Cmd/Ctrl+Shift+7 / +8 shortcuts run `TextEditor.toggleList`, a separate
 * implementation from the toolbar's `EditorAPI.toggleList` above. Both must
 * exit through `unlistedBlockType` or the keyboard path silently drifts back
 * to flattening a bulleted heading into body text.
 */
describe('keyboard bullet shortcut round trip', () => {
  beforeEach(() => {
    installCanvasShim();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  function pressListShortcut(container: HTMLElement, kind: 'ordered' | 'unordered'): void {
    const textarea = container.querySelector('textarea');
    if (!textarea) throw new Error('textarea not mounted');
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', {
        // Both modifiers so the dispatch works whichever platform jsdom
        // reports (`mod` is Meta on Mac, Ctrl elsewhere).
        key: kind === 'ordered' ? '7' : '8',
        ctrlKey: true,
        metaKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  }

  test('Cmd/Ctrl+Shift+8 twice gives the heading back', () => {
    const { editor, container } = setupEditor([makeHeading('b1', 'Quarterly results', 2)]);

    pressListShortcut(container, 'unordered');
    let block = editor.getDoc().document.blocks[0];
    expect(block.type).toBe('list-item');
    expect(block.headingLevel).toBe(2);

    pressListShortcut(container, 'unordered');
    block = editor.getDoc().document.blocks[0];
    expect(block.type).toBe('heading');
    expect(block.headingLevel).toBe(2);
    editor.dispose();
  });

  test('Cmd/Ctrl+Shift+7 twice gives the heading back', () => {
    const { editor, container } = setupEditor([makeHeading('b1', 'Quarterly results', 3)]);

    pressListShortcut(container, 'ordered');
    expect(editor.getDoc().document.blocks[0].type).toBe('list-item');

    pressListShortcut(container, 'ordered');
    const block = editor.getDoc().document.blocks[0];
    expect(block.type).toBe('heading');
    expect(block.headingLevel).toBe(3);
    editor.dispose();
  });

  test('Cmd/Ctrl+Shift+8 twice leaves a paragraph a paragraph', () => {
    const { editor, container } = setupEditor([makeParagraph('b1', 'body text')]);

    pressListShortcut(container, 'unordered');
    pressListShortcut(container, 'unordered');

    const block = editor.getDoc().document.blocks[0];
    expect(block.type).toBe('paragraph');
    expect(block.headingLevel).toBeUndefined();
    editor.dispose();
  });
});

/**
 * A `list-item` that remembers a heading level is only safe because every
 * reader gates on `type === 'heading'` (see the `Block.headingLevel` doc
 * comment). Assert the invariant instead of trusting the comment.
 */
describe('a remembered heading level is inert while the block is a list item', () => {
  const bulletedHeading: Block = {
    id: 'b1',
    type: 'list-item',
    listKind: 'unordered',
    listLevel: 0,
    headingLevel: 2,
    inlines: [{ text: 'Quarterly results', style: {} }],
    style: normalizeBlockStyle({}),
  };

  test('markdown serializes it as a bullet, not a heading', () => {
    expect(serializeMarkdown({ blocks: [bulletedHeading] })).toBe('- Quarterly results');
  });

  test('blockStyleId (named styles, layout, toolbar label) reads Normal', () => {
    expect(blockStyleId(bulletedHeading)).toBe('normal');
  });

  test('plain-text serialization is unaffected', () => {
    expect(serializeText({ blocks: [bulletedHeading] })).toContain('Quarterly results');
  });

  test('DOCX export emits no Heading paragraph style', async () => {
    const xml = await docxDocumentXml({ blocks: [bulletedHeading] });
    expect(xml).toContain('Quarterly results');
    expect(xml).not.toContain('w:pStyle w:val="Heading');
  });
});

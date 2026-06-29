// @vitest-environment jsdom
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { MemDocStore } from '../../src/store/memory.js';
import { initialize, type EditorAPI } from '../../src/view/editor.js';
import { normalizeBlockStyle } from '../../src/model/types.js';
import type { Block } from '../../src/model/types.js';

const EMPTY_BLOCK_STYLE = normalizeBlockStyle({});

/**
 * jsdom-friendly tests for `EditorAPI.getRangeStyleSummary`. The editor
 * mounts a full canvas pipeline at `initialize()` time, so we stub the
 * pieces jsdom doesn't ship: `getContext('2d')` and `ResizeObserver`.
 * The Proxy-based ctx swallows every paint call and returns plausible
 * scalar values where the editor inspects them (e.g. `measureText`).
 *
 * Selection is driven through the underscore-prefixed
 * `editor._setSelectionForTest(range)` helper rather than synthetic
 * pointer events. The helper is documented on `EditorAPI` as
 * test-only.
 */

function installCanvasShim(): void {
  // Drive every ctx method/property access through a Proxy so we don't
  // have to enumerate the ~100 calls the renderer makes. measureText
  // and getImageData need actual return shapes; the rest can be no-ops.
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
      // Properties read elsewhere — return harmless defaults.
      if (prop === 'canvas') return null;
      if (prop === 'font') return '12px sans-serif';
      // Methods: no-op function. Property reads: undefined-ish but
      // assignable.
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

function setupEditor(blocks: Block[]): { editor: EditorAPI; container: HTMLElement } {
  const store = new MemDocStore();
  store.setDocument({ blocks });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const editor = initialize(container, store);
  return { editor, container };
}

describe('getRangeStyleSummary', () => {
  beforeEach(() => {
    installCanvasShim();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('returns a uniform value when every run agrees', () => {
    const blockId = 'b1';
    const { editor } = setupEditor([
      {
        id: blockId,
        type: 'paragraph',
        inlines: [
          { text: 'hello', style: { fontFamily: 'Arial', fontSize: 12 } },
        ],
        style: EMPTY_BLOCK_STYLE,
      },
    ]);
    editor._setSelectionForTest({
      anchor: { blockId, offset: 0 },
      focus: { blockId, offset: 5 },
    });
    const summary = editor.getRangeStyleSummary();
    expect(summary.fontFamily).toBe('Arial');
    expect(summary.fontSize).toBe(12);
    editor.dispose();
  });

  test("returns 'mixed' when runs disagree on a key", () => {
    const blockId = 'b1';
    const { editor } = setupEditor([
      {
        id: blockId,
        type: 'paragraph',
        inlines: [
          { text: 'aa', style: { fontFamily: 'Arial', fontSize: 12 } },
          { text: 'bb', style: { fontFamily: 'Georgia', fontSize: 12 } },
        ],
        style: EMPTY_BLOCK_STYLE,
      },
    ]);
    editor._setSelectionForTest({
      anchor: { blockId, offset: 0 },
      focus: { blockId, offset: 4 },
    });
    const summary = editor.getRangeStyleSummary();
    expect(summary.fontFamily).toBe('mixed');
    expect(summary.fontSize).toBe(12);
    editor.dispose();
  });

  test('returns undefined when the key is unset throughout', () => {
    const blockId = 'b1';
    const { editor } = setupEditor([
      {
        id: blockId,
        type: 'paragraph',
        inlines: [{ text: 'abc', style: {} }],
        style: EMPTY_BLOCK_STYLE,
      },
    ]);
    editor._setSelectionForTest({
      anchor: { blockId, offset: 0 },
      focus: { blockId, offset: 3 },
    });
    const summary = editor.getRangeStyleSummary();
    expect(summary.fontFamily).toBeUndefined();
    expect(summary.fontSize).toBeUndefined();
    editor.dispose();
  });

  test("treats 'set in one run, unset in another' as mixed", () => {
    const blockId = 'b1';
    const { editor } = setupEditor([
      {
        id: blockId,
        type: 'paragraph',
        inlines: [
          { text: 'aa', style: { bold: true } },
          { text: 'bb', style: {} },
        ],
        style: EMPTY_BLOCK_STYLE,
      },
    ]);
    editor._setSelectionForTest({
      anchor: { blockId, offset: 0 },
      focus: { blockId, offset: 4 },
    });
    const summary = editor.getRangeStyleSummary();
    expect(summary.bold).toBe('mixed');
    editor.dispose();
  });

  test('summarizes across multiple blocks', () => {
    const { editor } = setupEditor([
      {
        id: 'b1',
        type: 'paragraph',
        inlines: [{ text: 'first', style: { fontSize: 14, italic: true } }],
        style: EMPTY_BLOCK_STYLE,
      },
      {
        id: 'b2',
        type: 'paragraph',
        inlines: [{ text: 'second', style: { fontSize: 14, italic: true } }],
        style: EMPTY_BLOCK_STYLE,
      },
      {
        id: 'b3',
        type: 'paragraph',
        inlines: [{ text: 'third', style: { fontSize: 18, italic: true } }],
        style: EMPTY_BLOCK_STYLE,
      },
    ]);
    editor._setSelectionForTest({
      anchor: { blockId: 'b1', offset: 0 },
      focus: { blockId: 'b3', offset: 5 },
    });
    const summary = editor.getRangeStyleSummary();
    expect(summary.fontSize).toBe('mixed');
    expect(summary.italic).toBe(true);
    editor.dispose();
  });

  test('falls back to the cursor inline when there is no real selection', () => {
    const blockId = 'b1';
    const { editor } = setupEditor([
      {
        id: blockId,
        type: 'paragraph',
        inlines: [{ text: 'abc', style: { fontFamily: 'Arial' } }],
        style: EMPTY_BLOCK_STYLE,
      },
    ]);
    // Zero-width range (caret only) — hasSelection() returns false.
    editor._setSelectionForTest({
      anchor: { blockId, offset: 1 },
      focus: { blockId, offset: 1 },
    });
    const summary = editor.getRangeStyleSummary();
    expect(summary.fontFamily).toBe('Arial');
    editor.dispose();
  });

  // Toolbar font size +/- and family pickers drive their displayed value
  // from getRangeStyleSummary. With a collapsed caret, applyStyle records
  // a pending inline style instead of mutating the document — the summary
  // must layer that pending state on top of the caret's inline style so
  // the picker reflects the new value, otherwise the next click reads the
  // same pre-pending caret value and the picker freezes.
  test('reflects pending fontSize at a collapsed caret', () => {
    const blockId = 'b1';
    const { editor } = setupEditor([
      {
        id: blockId,
        type: 'paragraph',
        inlines: [{ text: 'abc', style: { fontSize: 11 } }],
        style: EMPTY_BLOCK_STYLE,
      },
    ]);
    editor._setSelectionForTest({
      anchor: { blockId, offset: 1 },
      focus: { blockId, offset: 1 },
    });
    editor.applyStyle({ fontSize: 14 });
    expect(editor.getRangeStyleSummary().fontSize).toBe(14);
    editor.dispose();
  });

  test('reflects pending fontFamily at a collapsed caret', () => {
    const blockId = 'b1';
    const { editor } = setupEditor([
      {
        id: blockId,
        type: 'paragraph',
        inlines: [{ text: 'abc', style: { fontFamily: 'Arial' } }],
        style: EMPTY_BLOCK_STYLE,
      },
    ]);
    editor._setSelectionForTest({
      anchor: { blockId, offset: 1 },
      focus: { blockId, offset: 1 },
    });
    editor.applyStyle({ fontFamily: 'Georgia' });
    expect(editor.getRangeStyleSummary().fontFamily).toBe('Georgia');
    editor.dispose();
  });
});

describe('getRangeStyleSummary reflects named-style defaults', () => {
  beforeEach(() => {
    installCanvasShim();
    document.body.innerHTML = '';
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('a Heading 1 with no explicit run style reports the built-in H1 size', () => {
    const blockId = 'h1';
    const { editor } = setupEditor([
      {
        id: blockId,
        type: 'heading',
        headingLevel: 1,
        inlines: [{ text: 'Title', style: {} }],
        style: EMPTY_BLOCK_STYLE,
      },
    ]);
    editor._setSelectionForTest({
      anchor: { blockId, offset: 0 },
      focus: { blockId, offset: 5 },
    });
    const summary = editor.getRangeStyleSummary();
    // Built-in Heading 1 is 20pt, non-bold (Google Docs).
    expect(summary.fontSize).toBe(20);
    expect(summary.bold).toBeUndefined();
    editor.dispose();
  });

  test('an explicit run size overrides the named-style default', () => {
    const blockId = 'h1';
    const { editor } = setupEditor([
      {
        id: blockId,
        type: 'heading',
        headingLevel: 1,
        inlines: [{ text: 'Title', style: { fontSize: 30 } }],
        style: EMPTY_BLOCK_STYLE,
      },
    ]);
    editor._setSelectionForTest({
      anchor: { blockId, offset: 0 },
      focus: { blockId, offset: 5 },
    });
    expect(editor.getRangeStyleSummary().fontSize).toBe(30);
    editor.dispose();
  });

  test('reports a document-level style override over the built-in default', () => {
    const blockId = 'h1';
    const store = new MemDocStore();
    store.setDocument({
      blocks: [
        {
          id: blockId,
          type: 'heading',
          headingLevel: 1,
          inlines: [{ text: 'Title', style: {} }],
          style: EMPTY_BLOCK_STYLE,
        },
      ],
      styles: { 'heading-1': { inline: { fontSize: 30 } } },
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = initialize(container, store);
    editor._setSelectionForTest({
      anchor: { blockId, offset: 0 },
      focus: { blockId, offset: 5 },
    });
    // The H1 run has no explicit size; the doc override (30) must win over the
    // built-in (20).
    expect(editor.getRangeStyleSummary().fontSize).toBe(30);
    editor.dispose();
  });

  test('a collapsed caret in a styled paragraph reports the effective size', () => {
    const blockId = 'h2';
    const { editor } = setupEditor([
      {
        id: blockId,
        type: 'heading',
        headingLevel: 2,
        inlines: [{ text: 'Sub', style: {} }],
        style: EMPTY_BLOCK_STYLE,
      },
    ]);
    editor._setSelectionForTest({
      anchor: { blockId, offset: 2 },
      focus: { blockId, offset: 2 },
    });
    // Built-in Heading 2 is 16pt.
    expect(editor.getRangeStyleSummary().fontSize).toBe(16);
    editor.dispose();
  });
});

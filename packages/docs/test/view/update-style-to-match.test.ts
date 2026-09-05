// @vitest-environment jsdom
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { MemDocStore } from '../../src/store/memory.js';
import { initialize, type EditorAPI } from '../../src/view/editor.js';
import { createBlock } from '../../src/model/types.js';
import type { Block } from '../../src/model/types.js';
import { resolveStyleInline } from '../../src/model/named-styles.js';
import { setThemeMode } from '../../src/view/theme.js';

/**
 * "Update <style> to match" through the real editor.
 *
 * The defect this file exists for: the capture is the *computed* style at the
 * caret, so a run that set nothing but Bold still hands over the built-in's
 * grey. Storing that whole object made the override — which
 * `resolveStyleInline` spreads last and unconditionally, on both surfaces —
 * claim a color the user never chose. A dark-mode user who toggled Bold on a
 * Heading 3 and updated the style repainted every Heading 3 in the document at
 * `#434343` on the `#2b2b2b` page (1.43:1), and only "Reset style" undid it,
 * which also dropped the italic.
 *
 * `test/model/caret-style-surface.test.ts` pins the model helper; this pins the
 * wiring — that `updateStyleToMatch` actually routes its capture through it.
 * Both are needed: the model half passing while the editor writes the raw
 * capture is precisely the state that shipped.
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

function heading3(text = 'Details'): Block {
  const b = createBlock('heading', { headingLevel: 3 }) as Block;
  b.id = 'h3';
  b.inlines = [{ text, style: {} }];
  return b;
}

function setupEditor(blocks: Block[]): { editor: EditorAPI; store: MemDocStore } {
  const store = new MemDocStore();
  store.setDocument({ blocks });
  const container = document.createElement('div');
  document.body.appendChild(container);
  return { editor: initialize(container, store), store };
}

function selectWholeFirstRun(editor: EditorAPI, block: Block): void {
  editor._setSelectionForTest({
    anchor: { blockId: block.id, offset: 0 },
    focus: { blockId: block.id, offset: block.inlines[0].text.length },
  });
}

describe('updateStyleToMatch stores only what the document redefined', () => {
  beforeEach(() => {
    installCanvasShim();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
    // `setThemeMode` is a module-level global shared with every other view
    // suite — leaving it dark corrupts unrelated files.
    setThemeMode('light');
  });

  test('an Italic toggle in dark mode does not freeze the light grey', () => {
    setThemeMode('dark');
    const block = heading3();
    const { editor, store } = setupEditor([block]);
    selectWholeFirstRun(editor, block);

    editor.applyStyle({ italic: true });
    editor.updateStyleToMatch('heading-3');

    const styles = store.getDocStyles();
    expect(styles['heading-3']?.inline).toEqual({ italic: true });

    // The point of all of it: Heading 3 still resolves per surface, so the dark
    // page keeps the legible grey instead of the 1.43:1 one.
    expect(resolveStyleInline('heading-3', styles, 'dark').color).toBe('#B0B0B0');
    expect(resolveStyleInline('heading-3', styles, 'light').color).toBe('#434343');
  });

  test('the same is true in light mode — nothing about the theme is consulted', () => {
    setThemeMode('light');
    const block = heading3();
    const { editor, store } = setupEditor([block]);
    selectWholeFirstRun(editor, block);

    editor.applyStyle({ italic: true });
    editor.updateStyleToMatch('heading-3');

    expect(store.getDocStyles()['heading-3']?.inline?.color).toBeUndefined();
  });

  test('a color the user picked is stored and wins on both surfaces', () => {
    setThemeMode('dark');
    const block = heading3();
    const { editor, store } = setupEditor([block]);
    selectWholeFirstRun(editor, block);

    editor.applyStyle({ color: '#ff0000' });
    editor.updateStyleToMatch('heading-3');

    const styles = store.getDocStyles();
    expect(styles['heading-3']?.inline?.color).toBe('#ff0000');
    expect(resolveStyleInline('heading-3', styles, 'dark').color).toBe('#ff0000');
    expect(resolveStyleInline('heading-3', styles, 'light').color).toBe('#ff0000');
  });

  test('a size the document already redefined survives a later unrelated update', () => {
    // Pruning against the *effective* style rather than the built-in would
    // revert this to the built-in 20 pt, silently, on the second update.
    const h1 = createBlock('heading', { headingLevel: 1 }) as Block;
    h1.id = 'h1';
    h1.inlines = [{ text: 'Decisions', style: {} }];
    const { editor, store } = setupEditor([h1]);
    selectWholeFirstRun(editor, h1);

    editor.applyStyle({ fontSize: 30 });
    editor.updateStyleToMatch('heading-1');
    expect(store.getDocStyles()['heading-1']?.inline?.fontSize).toBe(30);

    editor.applyStyle({ italic: true });
    editor.updateStyleToMatch('heading-1');
    expect(store.getDocStyles()['heading-1']?.inline)
      .toEqual({ fontSize: 30, italic: true });
  });

  test('spacing the paragraph authored is stored; spacing it inherited is not', () => {
    const block = heading3();
    const { editor, store } = setupEditor([block]);
    selectWholeFirstRun(editor, block);

    editor.updateStyleToMatch('heading-3');
    expect(store.getDocStyles()['heading-3']?.block).toEqual({});

    editor.applyBlockStyle({ lineHeight: 2 });
    editor.updateStyleToMatch('heading-3');
    expect(store.getDocStyles()['heading-3']?.block).toEqual({ lineHeight: 2 });
  });
});

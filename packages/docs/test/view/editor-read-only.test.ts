// @vitest-environment jsdom
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { MemDocStore } from '../../src/store/memory.js';
import { initialize, type EditorAPI } from '../../src/view/editor.js';
import { getBlockText, normalizeBlockStyle } from '../../src/model/types.js';
import type { Block } from '../../src/model/types.js';

const EMPTY_BLOCK_STYLE = normalizeBlockStyle({});

/**
 * Read-only (viewer) mode must block every document mutation while still
 * permitting the read interactions from issue #482 (selection, copy,
 * link opening). These jsdom tests pin the mutation-blocking guarantees
 * and that keyboard-driven selection still works; pointer/copy/link paths
 * that need real pixel layout are covered by manual / browser tests.
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

function setupEditor(
  blocks: Block[],
  readOnly: boolean,
): { editor: EditorAPI; container: HTMLElement; textarea: HTMLTextAreaElement } {
  const store = new MemDocStore();
  store.setDocument({ blocks });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const editor = initialize(container, store, undefined, readOnly);
  const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
  return { editor, container, textarea };
}

function para(id: string, text: string): Block {
  return {
    id,
    type: 'paragraph',
    inlines: [{ text, style: { fontFamily: 'Arial', fontSize: 12 } }],
    style: EMPTY_BLOCK_STYLE,
  };
}

function bodyText(editor: EditorAPI): string {
  return editor
    .getDoc()
    .document.blocks.map((b) => getBlockText(b))
    .join('\n');
}

describe('read-only docs editor (issue #482)', () => {
  beforeEach(() => {
    installCanvasShim();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('a text-editor is still constructed (owns selection/copy/link)', () => {
    const { editor, textarea } = setupEditor([para('b1', 'hello world')], true);
    expect(textarea).toBeTruthy();
    editor.dispose();
  });

  test('typing (input event) does not mutate the document', () => {
    const { editor, textarea } = setupEditor([para('b1', 'hello world')], true);
    textarea.value = 'X';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    expect(bodyText(editor)).toBe('hello world');
    editor.dispose();
  });

  test('control: typing DOES mutate when not read-only', () => {
    const { editor, textarea } = setupEditor([para('b1', 'hello world')], false);
    textarea.value = 'X';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    expect(bodyText(editor)).not.toBe('hello world');
    expect(bodyText(editor)).toContain('X');
    editor.dispose();
  });

  test('paste event does not mutate the document', () => {
    const { editor, textarea } = setupEditor([para('b1', 'hello world')], true);
    textarea.dispatchEvent(new Event('paste', { bubbles: true, cancelable: true }));
    expect(bodyText(editor)).toBe('hello world');
    editor.dispose();
  });

  test('Backspace does not delete text', () => {
    const { editor, textarea } = setupEditor([para('b1', 'hello world')], true);
    // Place a collapsed caret mid-word so Backspace would delete if allowed.
    editor._setSelectionForTest({
      anchor: { blockId: 'b1', offset: 5 },
      focus: { blockId: 'b1', offset: 5 },
    });
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }),
    );
    expect(bodyText(editor)).toBe('hello world');
    editor.dispose();
  });

  test('Enter does not split the block', () => {
    const { editor, textarea } = setupEditor([para('b1', 'hello world')], true);
    editor._setSelectionForTest({
      anchor: { blockId: 'b1', offset: 5 },
      focus: { blockId: 'b1', offset: 5 },
    });
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    expect(editor.getDoc().document.blocks.length).toBe(1);
    editor.dispose();
  });

  test('Shift+ArrowRight still extends the selection (navigation works)', () => {
    const { editor, textarea } = setupEditor([para('b1', 'hello world')], true);
    editor._setSelectionForTest({
      anchor: { blockId: 'b1', offset: 0 },
      focus: { blockId: 'b1', offset: 0 },
    });
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    const sel = editor.getActiveSelection();
    expect(sel).not.toBeNull();
    expect(sel!.anchor.offset).toBe(0);
    expect(sel!.focus.offset).toBe(1);
    // Text is unchanged by navigation.
    expect(bodyText(editor)).toBe('hello world');
    editor.dispose();
  });
});

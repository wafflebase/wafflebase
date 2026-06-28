// @vitest-environment jsdom
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { MemDocStore } from '../../src/store/memory.js';
import { initialize, type EditorAPI } from '../../src/view/editor.js';
import { normalizeBlockStyle } from '../../src/model/types.js';
import type { Block } from '../../src/model/types.js';

const EMPTY_BLOCK_STYLE = normalizeBlockStyle({});

/**
 * The editor surface is a Canvas; the browser's native context menu is
 * never meaningful over it. Right-clicking plain text (no selection, no
 * table, no misspelling) used to fall through to the system menu because
 * the spell handler only suppressed the native menu on a misspelling.
 *
 * These tests pin the contract: the editor's contextmenu handler always
 * calls preventDefault() (so the native menu never shows on the canvas),
 * and dispose() removes the listener again.
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

function setupEditor(blocks: Block[]): { editor: EditorAPI; container: HTMLElement } {
  const store = new MemDocStore();
  store.setDocument({ blocks });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const editor = initialize(container, store);
  return { editor, container };
}

function paragraph(id: string, text: string): Block {
  return {
    id,
    type: 'paragraph',
    inlines: [{ text, style: { fontFamily: 'Arial', fontSize: 12 } }],
    style: EMPTY_BLOCK_STYLE,
  };
}

function rightClick(container: HTMLElement): MouseEvent {
  const ev = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: 20,
    clientY: 20,
  });
  container.dispatchEvent(ev);
  return ev;
}

describe('editor context menu', () => {
  beforeEach(() => {
    installCanvasShim();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('suppresses the native menu on plain-text right-click', () => {
    const { editor, container } = setupEditor([paragraph('b1', 'hello world')]);
    // "hello world" is correctly spelled — no suggestions — yet the native
    // browser menu must still be suppressed over the canvas surface.
    const ev = rightClick(container);
    expect(ev.defaultPrevented).toBe(true);
    editor.dispose();
  });

  test('dispose removes the contextmenu listener', () => {
    const { editor, container } = setupEditor([paragraph('b1', 'hello world')]);
    editor.dispose();
    const ev = rightClick(container);
    // After teardown the editor no longer claims the event.
    expect(ev.defaultPrevented).toBe(false);
  });
});

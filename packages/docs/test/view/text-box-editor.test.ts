// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { initializeTextBox } from '../../src/view/text-box-editor.js';
import type { Block } from '../../src/model/types.js';

/**
 * Smoke tests for `initializeTextBox`. The full slides-side
 * interaction is exercised in the slides package (T4); here we just
 * confirm the factory constructs against a jsdom canvas, returns the
 * documented API surface, and tears itself down cleanly.
 */
describe('initializeTextBox', () => {
  function mount(blocks: Block[]) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 200;
    container.appendChild(canvas);
    const api = initializeTextBox({
      container,
      canvas,
      blocks,
      contentWidth: 400,
      contentHeight: 200,
    });
    return { container, canvas, api };
  }

  it('returns the documented API surface and does not auto-focus', () => {
    const { api } = mount([]);
    expect(typeof api.focus).toBe('function');
    expect(typeof api.blur).toBe('function');
    expect(typeof api.detach).toBe('function');
    // The factory should not have stolen focus on construction —
    // slides callers focus explicitly after the dblclick handler runs.
    expect(document.activeElement).not.toBe(document.querySelector('textarea'));
    api.detach();
  });

  it('seeds an empty paragraph when blocks is empty', () => {
    const { container, api } = mount([]);
    // The hidden textarea TextEditor mounts is a child of `container`.
    const textarea = container.querySelector('textarea');
    expect(textarea).not.toBeNull();
    api.detach();
  });

  it('detach() removes the hidden textarea', () => {
    const { container, api } = mount([]);
    expect(container.querySelector('textarea')).not.toBeNull();
    api.detach();
    expect(container.querySelector('textarea')).toBeNull();
  });

  it('detach() is idempotent', () => {
    const { api } = mount([]);
    api.detach();
    expect(() => api.detach()).not.toThrow();
  });

  it('emits onCommit on blur with the current store snapshot', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 200;
    container.appendChild(canvas);
    let committed: Block[] | null = null;
    const api = initializeTextBox({
      container,
      canvas,
      blocks: [],
      contentWidth: 400,
      contentHeight: 200,
      onCommit: (blocks) => { committed = blocks; },
    });
    api.focus();
    // Focus may not be granted in jsdom for every textarea. Force the
    // focus / blur path by dispatching the events directly so the
    // onFocusChange wiring inside TextEditor fires.
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    textarea.dispatchEvent(new FocusEvent('focus'));
    textarea.dispatchEvent(new FocusEvent('blur'));
    expect(committed).not.toBeNull();
    expect(Array.isArray(committed)).toBe(true);
    expect((committed as unknown as Block[]).length).toBeGreaterThan(0);
    api.detach();
  });

  it('detach() flushes onCommit when the editor is still focused', () => {
    // Repro: caller (e.g. React unmount) invokes detach() while the
    // textarea is the active element. Without an explicit flush,
    // textarea.remove() inside detach() fires blur synchronously, but
    // handleBlur's `if (!detached && !committedOnce)` guard short-
    // circuits because detach() already set `detached = true` →
    // in-flight text was silently dropped.
    const container = document.createElement('div');
    document.body.appendChild(container);
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 200;
    container.appendChild(canvas);
    let committed: Block[] | null = null;
    const api = initializeTextBox({
      container,
      canvas,
      blocks: [],
      contentWidth: 400,
      contentHeight: 200,
      onCommit: (blocks) => { committed = blocks; },
    });
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    // Drive focus so the editor's `focused` flag is true at the moment
    // detach() is called.
    api.focus();
    textarea.dispatchEvent(new FocusEvent('focus'));
    api.detach();
    expect(committed).not.toBeNull();
    expect(Array.isArray(committed)).toBe(true);
  });

  it('detach() does not double-fire onCommit when already blurred', () => {
    // If the user blurred (saving) and the parent then detaches, the
    // detach path must NOT fire onCommit a second time — the caller's
    // store would receive two writes for one user intent.
    const container = document.createElement('div');
    document.body.appendChild(container);
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 200;
    container.appendChild(canvas);
    let commitCount = 0;
    const api = initializeTextBox({
      container,
      canvas,
      blocks: [],
      contentWidth: 400,
      contentHeight: 200,
      onCommit: () => { commitCount++; },
    });
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    api.focus();
    textarea.dispatchEvent(new FocusEvent('focus'));
    textarea.dispatchEvent(new FocusEvent('blur'));
    expect(commitCount).toBe(1);
    api.detach();
    expect(commitCount).toBe(1);
  });
});

/**
 * Formatting surface tests.
 *
 * The formatting methods delegate to the internal Doc / MemDocStore / Cursor /
 * Selection closures. We verify they are present, callable, and delegate
 * correctly to the underlying model. Full integration (typing + selection +
 * style round-trip) is out of scope for unit tests — the jsdom TextEditor
 * lacks a real Canvas context; we test the model-level delegation instead.
 */
describe('TextBoxEditorAPI — formatting surface', () => {
  function mount(blocks: Block[] = []) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 200;
    container.appendChild(canvas);
    const api = initializeTextBox({
      container,
      canvas,
      blocks,
      contentWidth: 400,
      contentHeight: 200,
    });
    return { api };
  }

  it('exposes getSelectionStyle, applyStyle, applyBlockStyle', () => {
    const { api } = mount();
    expect(typeof api.getSelectionStyle).toBe('function');
    expect(typeof api.applyStyle).toBe('function');
    expect(typeof api.applyBlockStyle).toBe('function');
    api.detach();
  });

  it('exposes getBlockType and setBlockType', () => {
    const { api } = mount();
    expect(typeof api.getBlockType).toBe('function');
    expect(typeof api.setBlockType).toBe('function');
    const bt = api.getBlockType();
    expect(bt.type).toBe('paragraph');
    // setBlockType to heading should work without throwing.
    expect(() => api.setBlockType('heading', { headingLevel: 1 })).not.toThrow();
    api.detach();
  });

  it('exposes toggleList, indent, outdent', () => {
    const { api } = mount();
    expect(typeof api.toggleList).toBe('function');
    expect(typeof api.indent).toBe('function');
    expect(typeof api.outdent).toBe('function');
    // These are no-ops when there is no selection (cursor-only on paragraph).
    expect(() => api.toggleList('unordered')).not.toThrow();
    expect(() => api.indent()).not.toThrow();
    expect(() => api.outdent()).not.toThrow();
    api.detach();
  });

  it('exposes insertLink, removeLink, getLinkAtCursor, requestLink', () => {
    const { api } = mount();
    expect(typeof api.insertLink).toBe('function');
    expect(typeof api.removeLink).toBe('function');
    expect(typeof api.getLinkAtCursor).toBe('function');
    expect(typeof api.requestLink).toBe('function');
    // removeLink / getLinkAtCursor are no-ops when there is no link.
    expect(() => api.removeLink()).not.toThrow();
    expect(api.getLinkAtCursor()).toBeUndefined();
    api.detach();
  });

  it('exposes undo and redo', () => {
    const { api } = mount();
    expect(typeof api.undo).toBe('function');
    expect(typeof api.redo).toBe('function');
    // No-ops before any edits.
    expect(() => api.undo()).not.toThrow();
    expect(() => api.redo()).not.toThrow();
    api.detach();
  });

  it('exposes onCursorMove, registers the callback, and calling it does not throw', () => {
    // jsdom does not provide a real Canvas 2D context, so renderNow exits
    // early and the callback is never fired during the normal render path.
    // This test verifies: (1) the method exists, (2) registering does not
    // throw, and (3) calling onCursorMove multiple times replaces the handler.
    const { api } = mount();
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    expect(() => api.onCursorMove(cb1)).not.toThrow();
    expect(() => api.onCursorMove(cb2)).not.toThrow();
    // Neither callback should have been called yet (canvas context is null).
    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).not.toHaveBeenCalled();
    api.detach();
  });

  it('setBlockType ignores document-only block types (title, subtitle, horizontal-rule)', () => {
    const { api } = mount();
    // These should silently no-op; block type stays as paragraph.
    expect(() => api.setBlockType('title')).not.toThrow();
    expect(() => api.setBlockType('subtitle')).not.toThrow();
    expect(() => api.setBlockType('horizontal-rule')).not.toThrow();
    // Block type is unchanged (paragraph after seeding an empty block).
    expect(api.getBlockType().type).toBe('paragraph');
    api.detach();
  });

  it('applyStyle returns without mutating when there is no selection', () => {
    const { api } = mount();
    // applyStyle is a no-op when there is no selection; should not throw.
    expect(() => api.applyStyle({ bold: true })).not.toThrow();
    api.detach();
  });

  it('onLinkRequest fires when requestLink is called', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 200;
    container.appendChild(canvas);
    const onLinkRequest = vi.fn();
    const api = initializeTextBox({
      container,
      canvas,
      blocks: [],
      contentWidth: 400,
      contentHeight: 200,
      onLinkRequest,
    });
    api.requestLink();
    expect(onLinkRequest).toHaveBeenCalledTimes(1);
    api.detach();
  });
});

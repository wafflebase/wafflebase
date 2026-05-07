// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
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
});

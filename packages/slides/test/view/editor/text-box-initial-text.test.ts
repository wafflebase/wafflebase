// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import '../../../src/view/canvas/test-canvas-env';
import type { Block } from '@wafflebase/docs';
import { mountSlidesTextBox } from '../../../src/view/editor/text-box-editor';

/**
 * P2.6 — printable-key forwarding into the freshly mounted text-box.
 *
 * The slides type-to-edit keyboard rule consumes the printable key that
 * triggered text-edit entry and forwards it via
 * `enterEditMode({ initialText: e.key })` → `mountSlidesTextBox({
 * initialText })`. The wrapper inserts the character into the docs
 * editor's hidden textarea on first `focus()`, which routes through
 * `handleInput` → `docInsertText` at the caret.
 */

function flushRaf(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 16));
}

function emptyPara(id = 'p1'): Block {
  return { id, type: 'paragraph', inlines: [{ text: '', style: {} }], style: {} } as Block;
}

describe('mountSlidesTextBox initialText forwarding', () => {
  let overlay: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    overlay = document.createElement('div');
    overlay.style.position = 'absolute';
    document.body.appendChild(overlay);
  });

  it('inserts the initialText on first focus() and commits it', async () => {
    let committed: Block[] | null = null;
    const tb = mountSlidesTextBox({
      overlay,
      frame: { x: 0, y: 0, w: 400, h: 300, rotation: 0 },
      scale: 1,
      blocks: [emptyPara()],
      onCommit: (next) => { committed = next; },
      onCancel: () => {},
      initialText: 'H',
    });
    tb.focus();
    await flushRaf();
    tb.commit();
    await flushRaf();
    expect(committed).not.toBeNull();
    const text = committed![0].inlines.map((i) => i.text).join('');
    expect(text).toBe('H');
    tb.detach();
  });

  it('does NOT re-insert on a second focus() call', async () => {
    let committed: Block[] | null = null;
    const tb = mountSlidesTextBox({
      overlay,
      frame: { x: 0, y: 0, w: 400, h: 300, rotation: 0 },
      scale: 1,
      blocks: [emptyPara()],
      onCommit: (next) => { committed = next; },
      onCancel: () => {},
      initialText: 'H',
    });
    tb.focus();
    await flushRaf();
    // Toolbar round-trip simulation: re-focus the box. Must NOT inject
    // a second 'H' — the pending flag is consumed on the first focus.
    tb.focus();
    await flushRaf();
    tb.commit();
    await flushRaf();
    const text = committed![0].inlines.map((i) => i.text).join('');
    expect(text).toBe('H');
    tb.detach();
  });

  it('is a no-op when initialText is omitted (existing focus path)', async () => {
    let committed: Block[] | null = null;
    const tb = mountSlidesTextBox({
      overlay,
      frame: { x: 0, y: 0, w: 400, h: 300, rotation: 0 },
      scale: 1,
      blocks: [emptyPara()],
      onCommit: (next) => { committed = next; },
      onCancel: () => {},
    });
    tb.focus();
    await flushRaf();
    tb.commit();
    await flushRaf();
    const text = committed![0].inlines.map((i) => i.text).join('');
    expect(text).toBe('');
    tb.detach();
  });

  it('is a no-op for an empty initialText string', async () => {
    let committed: Block[] | null = null;
    const tb = mountSlidesTextBox({
      overlay,
      frame: { x: 0, y: 0, w: 400, h: 300, rotation: 0 },
      scale: 1,
      blocks: [emptyPara()],
      onCommit: (next) => { committed = next; },
      onCancel: () => {},
      initialText: '',
    });
    tb.focus();
    await flushRaf();
    tb.commit();
    await flushRaf();
    const text = committed![0].inlines.map((i) => i.text).join('');
    expect(text).toBe('');
    tb.detach();
  });
});

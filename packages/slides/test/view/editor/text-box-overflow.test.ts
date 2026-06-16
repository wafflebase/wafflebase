// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import '../../../src/view/canvas/test-canvas-env';
import type { Block } from '@wafflebase/docs';
import { mountSlidesTextBox } from '../../../src/view/editor/text-box-editor';

/**
 * `overflowBounds` mounts a LARGER editing canvas with the box positioned
 * `left`/`top` px inside it, so text that overflows a fixed box (shape /
 * table cell) is painted live in every direction — matching the committed
 * slide renderer (which clips only at the slide edge). The interactive box
 * stays frame-sized: the container keeps its size + mouse listeners, and
 * the enlarged canvas is `pointer-events: none` so clicks past the box
 * still fall through to commit-outside.
 */
function block(text: string): Block {
  return {
    id: 'b1', type: 'paragraph',
    inlines: [{ text, style: {} }],
    style: {},
  } as Block;
}

describe('mountSlidesTextBox overflow paint surface', () => {
  let overlay: HTMLDivElement;
  beforeEach(() => {
    document.body.innerHTML = '';
    overlay = document.createElement('div');
    overlay.style.position = 'absolute';
    document.body.appendChild(overlay);
  });

  const FRAME = { x: 200, y: 150, w: 100, h: 80, rotation: 0 };

  it('mounts a full-slide canvas offset so the box content lands at the origin', () => {
    const tb = mountSlidesTextBox({
      overlay,
      frame: FRAME,
      scale: 1,
      blocks: [block('Long overflowing text')],
      onCommit: (): void => {},
      onCancel: (): void => {},
      // Full slide rect the editor passes for a box at (200,150).
      overflowBounds: { left: 200, top: 150, width: 1920, height: 1080 },
    });

    const canvas = tb.container.querySelector('canvas')!;
    // Canvas spans the whole slide (logical * scale).
    expect(canvas.style.width).toBe('1920px');
    expect(canvas.style.height).toBe('1080px');
    // Positioned so the box sits left/top px inside it — extends up/left
    // (and down/right) of the box for overflow in every direction.
    expect(canvas.style.position).toBe('absolute');
    expect(canvas.style.left).toBe('-200px');
    expect(canvas.style.top).toBe('-150px');
    // Clicks over the overflow region must fall through to the slide.
    expect(canvas.style.pointerEvents).toBe('none');
    // The interactive box (container) stays frame-sized and keeps the I-beam.
    expect(tb.container.style.width).toBe('100px');
    expect(tb.container.style.height).toBe('80px');
    expect(tb.container.style.cursor).toBe('text');

    tb.detach();
  });

  it('keeps the canvas at frame size when overflowBounds is absent', () => {
    const tb = mountSlidesTextBox({
      overlay,
      frame: FRAME,
      scale: 1,
      blocks: [block('hi')],
      onCommit: (): void => {},
      onCancel: (): void => {},
    });

    const canvas = tb.container.querySelector('canvas')!;
    expect(canvas.style.width).toBe('100px');
    expect(canvas.style.height).toBe('80px');
    // No overflow → canvas keeps default flow + pointer events.
    expect(canvas.style.position).toBe('');
    expect(canvas.style.pointerEvents).toBe('');

    tb.detach();
  });

  it('does not offset the canvas when the box already fills the bounds', () => {
    const tb = mountSlidesTextBox({
      overlay,
      frame: FRAME,
      scale: 1,
      blocks: [block('hi')],
      onCommit: (): void => {},
      onCancel: (): void => {},
      // A box whose bounds equal its own size with no margin: no growth.
      overflowBounds: { left: 0, top: 0, width: 100, height: 80 },
    });

    const canvas = tb.container.querySelector('canvas')!;
    expect(canvas.style.width).toBe('100px');
    expect(canvas.style.height).toBe('80px');
    // Not overflowing → canvas stays in flow with pointer events.
    expect(canvas.style.position).toBe('');
    expect(canvas.style.pointerEvents).toBe('');

    tb.detach();
  });
});

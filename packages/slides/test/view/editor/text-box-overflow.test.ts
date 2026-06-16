// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import '../../../src/view/canvas/test-canvas-env';
import type { Block } from '@wafflebase/docs';
import { mountSlidesTextBox } from '../../../src/view/editor/text-box-editor';

/**
 * `overflowBounds` enlarges the editing paint surface past the box so
 * text that overflows a fixed box (shape / table cell) is painted live,
 * matching the committed slide renderer (which clips only at the slide
 * edge). The interactive box stays frame-sized: the container keeps its
 * size + mouse listeners, and the enlarged canvas is `pointer-events:
 * none` so clicks past the box still fall through to commit-outside.
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

  it('enlarges the canvas and disables its pointer events when overflowBounds is set', () => {
    const tb = mountSlidesTextBox({
      overlay,
      frame: FRAME,
      scale: 1,
      blocks: [block('Long overflowing text')],
      onCommit: (): void => {},
      onCancel: (): void => {},
      // Slide-bounds extent the editor would compute for a cell at (200,150).
      overflowBounds: { width: 1720, height: 930 },
    });

    const canvas = tb.container.querySelector('canvas')!;
    // Canvas grows to the overflow extent (logical * scale).
    expect(canvas.style.width).toBe('1720px');
    expect(canvas.style.height).toBe('930px');
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
    // No overflow → canvas keeps default pointer events (captured by container).
    expect(canvas.style.pointerEvents).toBe('');

    tb.detach();
  });

  it('does not shrink the canvas below the frame for small overflowBounds', () => {
    const tb = mountSlidesTextBox({
      overlay,
      frame: FRAME,
      scale: 1,
      blocks: [block('hi')],
      onCommit: (): void => {},
      onCancel: (): void => {},
      // A box flush against the slide edge: bounds == frame, no growth.
      overflowBounds: { width: 100, height: 80 },
    });

    const canvas = tb.container.querySelector('canvas')!;
    expect(canvas.style.width).toBe('100px');
    expect(canvas.style.height).toBe('80px');
    // Not overflowing → pointer events stay on the canvas.
    expect(canvas.style.pointerEvents).toBe('');

    tb.detach();
  });
});

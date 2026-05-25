// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import '../../../src/view/canvas/test-canvas-env';
import type { Block } from '@wafflebase/docs';
import { mountSlidesTextBox } from '../../../src/view/editor/text-box-editor';

// Drain the docs editor's rAF-scheduled renderNow (jsdom polyfills rAF
// via setTimeout; 16ms is enough to flush a frame + cursor-blink restart).
function flushRaf(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 16));
}

function para(id: string, text: string): Block {
  return { id, type: 'paragraph', inlines: [{ text, style: {} }], style: {} } as Block;
}

describe('mountSlidesTextBox auto-grow', () => {
  let overlay: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    overlay = document.createElement('div');
    overlay.style.position = 'absolute';
    document.body.appendChild(overlay);
  });

  it('reports content height and resizes the container on mount', async () => {
    const heights: number[] = [];
    const tb = mountSlidesTextBox({
      overlay,
      frame: { x: 0, y: 0, w: 400, h: 300, rotation: 0 },
      scale: 1,
      blocks: [para('p1', 'one line')],
      onCommit: () => {},
      onCancel: () => {},
      onContentHeightChange: (h) => heights.push(h),
    });
    await flushRaf();
    await flushRaf();
    expect(heights.length).toBeGreaterThan(0);
    const reported = heights[heights.length - 1];
    expect(reported).toBeGreaterThan(0);
    // Container is resized to the reported height (scale = 1).
    expect(tb.container.style.height).toBe(`${Math.max(1, Math.round(reported))}px`);
    tb.detach();
  });

  it('reports a larger height for more paragraphs', async () => {
    const oneH: number[] = [];
    const tb1 = mountSlidesTextBox({
      overlay,
      frame: { x: 0, y: 0, w: 400, h: 300, rotation: 0 },
      scale: 1,
      blocks: [para('p1', 'a')],
      onCommit: () => {},
      onCancel: () => {},
      onContentHeightChange: (h) => oneH.push(h),
    });
    await flushRaf();
    await flushRaf();
    tb1.detach();

    const fourH: number[] = [];
    const tb4 = mountSlidesTextBox({
      overlay,
      frame: { x: 0, y: 0, w: 400, h: 300, rotation: 0 },
      scale: 1,
      blocks: [para('p1', 'a'), para('p2', 'b'), para('p3', 'c'), para('p4', 'd')],
      onCommit: () => {},
      onCancel: () => {},
      onContentHeightChange: (h) => fourH.push(h),
    });
    await flushRaf();
    await flushRaf();
    expect(fourH[fourH.length - 1]).toBeGreaterThan(oneH[oneH.length - 1]);
    tb4.detach();
  });
});

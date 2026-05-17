// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import '../../../src/view/canvas/test-canvas-env';
import type { Block } from '@wafflebase/docs';
import { mountSlidesTextBox } from '../../../src/view/editor/text-box-editor';

/**
 * Regression: clicks inside a slides text-box landed at offset 0 of the
 * block whenever the editor was rendered at a scale ≠ 1 (i.e. every
 * real session — `scale = hostWidth / SLIDE_WIDTH`). The bug was
 * especially visible on right- and center-aligned paragraphs because
 * the visible glyphs sit far from the layout origin, so the (un-scaled)
 * click x dropped into the `localX < firstRun.x` branch of
 * `findPositionAtPixel` and snapped to the start of the line.
 *
 * The fix wires `opts.scale` through `initializeTextBox` to the docs
 * `TextEditor`'s `getScaleFactor` shim. Without it, the docs editor
 * divides `(clientX - rect.left)` by `1` instead of `scale`, mixing
 * host and logical coordinates.
 */
function flushRaf(): Promise<void> {
  // Drain rAF/microtask queues that the docs text-box editor uses for
  // paint scheduling. jsdom polyfills rAF via setTimeout, so a few
  // sequential macrotask flushes are enough.
  return new Promise((resolve) => setTimeout(resolve, 16));
}

function rightAlignedBlock(text: string): Block {
  return {
    id: 'b1',
    type: 'paragraph',
    inlines: [{ text, style: {} }],
    style: { alignment: 'right' },
  } as Block;
}

function mockBoundingRect(el: HTMLElement, width: number, height: number): void {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    width,
    height,
    x: 0,
    y: 0,
    toJSON: (): string => '',
  } as DOMRect);
}

describe('mountSlidesTextBox click positioning at scale != 1', () => {
  let overlay: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    overlay = document.createElement('div');
    overlay.style.position = 'absolute';
    document.body.appendChild(overlay);
  });

  it('right-aligned text: a click on the visible glyphs lands inside the text (not offset 0)', async () => {
    const SCALE = 0.5;
    const FRAME = { x: 0, y: 0, w: 400, h: 100, rotation: 0 };

    let lastCursor: { blockId: string; offset: number } | null = null;
    const tb = mountSlidesTextBox({
      overlay,
      frame: FRAME,
      scale: SCALE,
      blocks: [rightAlignedBlock('XXXXXXXX')],
      onCommit: (): void => {},
      onCancel: (): void => {},
    });
    tb.onCursorMove((pos): void => {
      lastCursor = { blockId: pos.blockId, offset: pos.offset };
    });
    tb.focus();
    await flushRaf();

    // Container is sized in host pixels (frame * scale). The docs editor
    // computes `(clientX - rect.left) / scale` to recover logical x.
    mockBoundingRect(tb.container, FRAME.w * SCALE, FRAME.h * SCALE);

    // FakeCanvas measureText returns text.length * 8 logical px, so
    // right-aligned "XXXXXXXX" (width = 64) sits at logical x ∈ [336, 400].
    // In host pixels (scale=0.5), the visible text spans x ∈ [168, 200].
    // A click at host x=195 should map to logical x=390 → near end of text.
    // Without the fix, host x=195 → logical x=195 → < firstRun.x=336 →
    // snaps to offset 0.
    tb.container.dispatchEvent(
      new MouseEvent('mousedown', {
        clientX: 195,
        clientY: 25,
        button: 0,
        bubbles: true,
      }),
    );
    tb.container.dispatchEvent(
      new MouseEvent('mouseup', {
        clientX: 195,
        clientY: 25,
        button: 0,
        bubbles: true,
      }),
    );

    await flushRaf();
    await flushRaf();

    expect(lastCursor).not.toBeNull();
    // Bug repro: offset would be 0. Fixed: offset is near 8 (end of text).
    expect(lastCursor!.offset).toBeGreaterThan(0);

    tb.detach();
  });

  it('left-aligned text: a click on the visible glyphs hits the correct offset at scale != 1', async () => {
    // Long left-aligned line so click-x and offset-N are distinguishable
    // with vs. without the fix. Text is 20 chars × 8 px = 160 logical wide;
    // visible (at scale 0.5) at host x ∈ [0, 80]. A click at host x = 40
    // (≈midpoint of visible text) maps to logical x = 80 → ~offset 10.
    // With the bug, logical x = 40 → ~offset 5 — so the assertion
    // `offset > 7` cleanly fails pre-fix and passes post-fix.
    const SCALE = 0.5;
    const FRAME = { x: 0, y: 0, w: 400, h: 100, rotation: 0 };

    let lastCursor: { blockId: string; offset: number } | null = null;
    const tb = mountSlidesTextBox({
      overlay,
      frame: FRAME,
      scale: SCALE,
      blocks: [
        {
          id: 'b1',
          type: 'paragraph',
          inlines: [{ text: 'A'.repeat(20), style: {} }],
          style: {},
        } as Block,
      ],
      onCommit: (): void => {},
      onCancel: (): void => {},
    });
    tb.onCursorMove((pos): void => {
      lastCursor = { blockId: pos.blockId, offset: pos.offset };
    });
    tb.focus();
    await flushRaf();

    mockBoundingRect(tb.container, FRAME.w * SCALE, FRAME.h * SCALE);

    tb.container.dispatchEvent(
      new MouseEvent('mousedown', {
        clientX: 40,
        clientY: 25,
        button: 0,
        bubbles: true,
      }),
    );

    await flushRaf();
    await flushRaf();

    expect(lastCursor).not.toBeNull();
    expect(lastCursor!.offset).toBeGreaterThan(7);

    tb.detach();
  });
});

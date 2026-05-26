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
  // Wait one frame so the docs text-box editor's rAF-scheduled
  // renderNow (and the cursor-blink restart that piggybacks on it)
  // actually fires. jsdom polyfills rAF via setTimeout; `setTimeout(0)`
  // is too tight to drain both.
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
    // Pre-fix: offset == 0 (snap to line start because logical click x
    // fell before firstRun.x). Post-fix: logical x = 195/0.5 = 390;
    // right-aligned "XXXXXXXX" runs from logical 336 to 400, so the
    // localRunX = 54 sits ~6 px before the 7th boundary at 56 — snap
    // to offset 7. A tight equality catches scale-direction inversions
    // (e.g. `1/scale`) which would push the offset elsewhere.
    expect(lastCursor!.offset).toBe(7);

    tb.detach();
  });

  it('left-aligned text: a click on the visible glyphs hits the correct offset at scale != 1', async () => {
    // Long left-aligned line so click-x and offset-N are distinguishable
    // with vs. without the fix. Text is 20 chars × 8 px = 160 logical wide;
    // visible (at scale 0.5) at host x ∈ [0, 80]. A click at host x = 40
    // (≈midpoint of visible text) maps to logical x = 80 → offset 10
    // post-fix; with the bug, logical x = 40 → offset 5. The post-fix
    // assertion below is `toBe(10)`, which is far enough from 5 to be
    // a clean pre-fix failure.
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
    // Pre-fix: logical x ≈ 40 → offset ≈ 5 (mid-text wrong position).
    // Post-fix: logical x ≈ 80 → offset === 10. Equality catches
    // scale-direction inversions and partial-scale-propagation regressions.
    expect(lastCursor!.offset).toBe(10);

    tb.detach();
  });

  it('y-axis: a click on a specific paragraph lands in that paragraph at scale != 1', async () => {
    // Y-axis sibling of the x-axis bug: TextEditor's pointer math does
    // `(clientY - rect.top - canvasOffsetTop) / scale`. The shim hands
    // back `canvasOffsetTop = -Theme.pageGap` (logical pixels) where
    // host pixels are required, so every click y is inflated by an
    // extra `(1 - scale) * pageGap / scale` logical pixels — at
    // scale = 0.5 that's an extra 40 px, enough to skip 2-3 paragraphs
    // and route the caret to the wrong block. User-visible symptom:
    // clicking paragraph 2 lands the caret in paragraph 3.
    const SCALE = 0.5;
    const FRAME = { x: 0, y: 0, w: 400, h: 400, rotation: 0 };

    let lastCursor: { blockId: string; offset: number } | null = null;
    const tb = mountSlidesTextBox({
      overlay,
      frame: FRAME,
      scale: SCALE,
      blocks: [
        { id: 'p1', type: 'paragraph', inlines: [{ text: 'first', style: {} }], style: {} },
        { id: 'p2', type: 'paragraph', inlines: [{ text: 'second', style: {} }], style: {} },
        { id: 'p3', type: 'paragraph', inlines: [{ text: 'third', style: {} }], style: {} },
        { id: 'p4', type: 'paragraph', inlines: [{ text: 'fourth', style: {} }], style: {} },
      ] as Block[],
      onCommit: (): void => {},
      onCancel: (): void => {},
    });
    tb.onCursorMove((pos): void => {
      lastCursor = { blockId: pos.blockId, offset: pos.offset };
    });
    tb.focus();
    await flushRaf();

    mockBoundingRect(tb.container, FRAME.w * SCALE, FRAME.h * SCALE);

    // Click at host y = 15. Post-fix logical y = 30 → middle of p2.
    // Pre-fix logical y = (15 + 40) / 0.5 = 110 — far past p4 — but the
    // paginated wrapper clamps "past last line on page" to the nearest
    // line, which empirically lands on p3 (one paragraph too far). The
    // user-visible symptom matches: clicking p2 puts the caret in p3.
    tb.container.dispatchEvent(
      new MouseEvent('mousedown', {
        clientX: 10,
        clientY: 15,
        button: 0,
        bubbles: true,
      }),
    );

    await flushRaf();
    await flushRaf();

    expect(lastCursor).not.toBeNull();
    expect(lastCursor!.blockId).toBe('p2');

    tb.detach();
  });
});

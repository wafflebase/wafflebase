// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderOverlay } from './overlay';
import type { Element } from '../../model/element';
import type { OverlayOptions } from './overlay';

/**
 * Board-mode pan support: when `panX`/`panY` are supplied, every world→CSS
 * position the overlay paints (selection frame, resize handles, connector
 * endpoint handles, snap guides) must be `world * scale + pan`. Sizes
 * (width/height) stay pan-invariant — panning slides the whole overlay
 * around the viewport, it doesn't rescale anything.
 *
 * Absent `panX`/`panY` (the pre-viewport call sites, still used by every
 * existing overlay test), pan must default to 0 so the rendered output is
 * byte-identical to before this change.
 */
function shapeAt(x: number, y: number, w: number, h: number): Element {
  return {
    id: 'e1',
    type: 'shape',
    frame: { x, y, w, h, rotation: 0 },
    data: { kind: 'rect' },
  } as unknown as Element;
}

describe('overlay honors pan offset', () => {
  it('positions the axis-aligned selection frame at world*scale + pan', () => {
    const overlay = document.createElement('div');
    const options: OverlayOptions = {
      scale: 2,
      slideWidth: 1920,
      slideHeight: 1080,
      panX: 100,
      panY: 50,
    };
    renderOverlay(overlay, [shapeAt(10, 10, 20, 20)], options);

    const frame = overlay.querySelector<HTMLElement>(
      '.wfb-slides-selection-frame',
    );
    // left = x*scale + panX = 10*2 + 100 = 120; top = y*scale + panY = 10*2 + 50 = 70
    expect(frame?.style.left).toBe('120px');
    expect(frame?.style.top).toBe('70px');
    // Size is pan-invariant: width = w*scale = 20*2 = 40 (unaffected by panX/panY).
    expect(frame?.style.width).toBe('40px');
    expect(frame?.style.height).toBe('40px');
  });

  it('positions a corner resize handle at world*scale + pan', () => {
    const overlay = document.createElement('div');
    const options: OverlayOptions = {
      scale: 2,
      slideWidth: 1920,
      slideHeight: 1080,
      panX: 100,
      panY: 50,
    };
    renderOverlay(overlay, [shapeAt(10, 10, 20, 20)], options);

    // The 'nw' handle div centers on (left, top) then offsets by half the
    // 8px handle size, so style.left = (10*2 + 100) - 4 = 116.
    const nw = overlay.querySelector<HTMLElement>('[data-handle="nw"]');
    expect(nw?.style.left).toBe('116px');
    expect(nw?.style.top).toBe('66px');
  });

  it('positions a permanent guide line at world*scale + pan on its axis', () => {
    const overlay = document.createElement('div');
    const options: OverlayOptions = {
      scale: 2,
      slideWidth: 1920,
      slideHeight: 1080,
      panX: 100,
      panY: 50,
      permanentGuides: [{ id: 'g1', axis: 'x', position: 30 }],
    };
    renderOverlay(overlay, [], options);

    const guide = overlay.querySelector<HTMLElement>('[data-guide="g1"]');
    // Vertical guide (axis 'x'): left = position*scale + panX = 30*2 + 100 = 160.
    expect(guide?.style.left).toBe('160px');
    // The line's perpendicular (top) edge tracks the panned slide origin too.
    expect(guide?.style.top).toBe(`${50 - 10_000}px`);
  });

  it('defaults pan to 0 so the no-viewport path is unchanged', () => {
    const overlay = document.createElement('div');
    const options: OverlayOptions = {
      scale: 2,
      slideWidth: 1920,
      slideHeight: 1080,
    };
    renderOverlay(overlay, [shapeAt(10, 10, 20, 20)], options);

    const frame = overlay.querySelector<HTMLElement>(
      '.wfb-slides-selection-frame',
    );
    expect(frame?.style.left).toBe('20px');
    expect(frame?.style.top).toBe('20px');
  });
});

// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderOverlay } from './overlay';
import type { Element, Frame } from '../../model/element';
import type { OverlayOptions } from './overlay';

/**
 * Regression guard for the iPad Safari selection-bleed bug: dragging a
 * shape's control handles (resize / rotate / yellow-diamond adjustment,
 * connector endpoints / bend, crop handles) must never let the browser
 * start a native text/element selection that "bleeds" over the canvas.
 * The cure lives on the handle DOM itself — every interactive handle
 * carries `user-select: none` (+ WebKit) and `touch-action: none` via
 * `styleHandleInteraction`. See `startAdjustmentDrag` / `onPointerDownHandle`.
 *
 * Each fixture below exercises a distinct handle factory so that dropping
 * the styling from any one of them fails CI:
 *   - smileyFace shape → makeHandle (resize/rotate) + makeAdjustmentHandle
 *   - curved connector → makeEndpointHandle (start/end) + makeBendHandle
 *   - crop session     → renderCropHandles' crop handles
 */

const BASE_OPTIONS: OverlayOptions = {
  scale: 1,
  slideWidth: 960,
  slideHeight: 540,
};

function expectAllHandlesInert(overlay: HTMLDivElement): void {
  const handles = overlay.querySelectorAll<HTMLElement>('[data-handle]');
  expect(handles.length).toBeGreaterThan(0);
  for (const handle of handles) {
    // `-webkit-user-select` is also set in code for older iOS Safari,
    // but jsdom's CSSOM drops vendor-prefixed properties, so only the
    // standard properties are asserted here.
    expect(handle.style.userSelect).toBe('none');
    expect(handle.style.touchAction).toBe('none');
  }
}

describe('selection-handle interaction styles', () => {
  it('marks shape resize/rotate + adjustment handles non-selectable', () => {
    const smiley = {
      id: 'e1',
      type: 'shape',
      frame: { x: 100, y: 100, w: 200, h: 200, rotation: 0 },
      data: { kind: 'smileyFace' },
    } as unknown as Element;

    const overlay = document.createElement('div');
    renderOverlay(overlay, [smiley], BASE_OPTIONS);

    expectAllHandlesInert(overlay);
  });

  it('marks connector endpoint + bend handles non-selectable', () => {
    // A curved connector renders both endpoint handles plus the
    // yellow-diamond bend handle (bendHandlePosition is non-null for a
    // bezier routing), covering makeEndpointHandle + makeBendHandle.
    const connector = {
      id: 'c1',
      type: 'connector',
      routing: 'curved',
      frame: { x: 0, y: 0, w: 300, h: 200, rotation: 0 },
      start: { kind: 'free', x: 100, y: 100 },
      end: { kind: 'free', x: 400, y: 300 },
      arrowheads: {},
    } as unknown as Element;

    const overlay = document.createElement('div');
    renderOverlay(overlay, [connector], BASE_OPTIONS);

    expectAllHandlesInert(overlay);
  });

  it('marks crop-session handles non-selectable', () => {
    const cropWindow: Frame = { x: 100, y: 100, w: 200, h: 200, rotation: 0 };
    const overlay = document.createElement('div');
    renderOverlay(overlay, [], { ...BASE_OPTIONS, cropWindow });

    expectAllHandlesInert(overlay);
  });
});

// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { RESIZE_HANDLE_CURSORS, rotatedResizeCursor } from './hit-test';
import type { ResizeHandle } from './hit-test';
import { renderOverlay } from './overlay';
import type { Element } from '../../model/element';
import type { OverlayOptions } from './overlay';

const HANDLES: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const deg = (d: number) => (d * Math.PI) / 180;

describe('rotatedResizeCursor', () => {
  it('reproduces the static cursor map at rotation 0', () => {
    for (const h of HANDLES) {
      expect(rotatedResizeCursor(h, 0)).toBe(RESIZE_HANDLE_CURSORS[h]);
    }
  });

  it('is invariant under full turns and 180° flips', () => {
    for (const h of HANDLES) {
      const base = RESIZE_HANDLE_CURSORS[h];
      expect(rotatedResizeCursor(h, deg(180))).toBe(base);
      expect(rotatedResizeCursor(h, deg(360))).toBe(base);
      expect(rotatedResizeCursor(h, deg(-180))).toBe(base);
    }
  });

  it('rotates the cursor axis with a 90° turn', () => {
    // A quarter turn swaps horizontal/vertical and both diagonals.
    expect(rotatedResizeCursor('n', deg(90))).toBe('ew-resize');
    expect(rotatedResizeCursor('e', deg(90))).toBe('ns-resize');
    expect(rotatedResizeCursor('ne', deg(90))).toBe('nwse-resize');
    expect(rotatedResizeCursor('se', deg(90))).toBe('nesw-resize');
  });

  it('maps a 45° turn to the neighbouring bucket', () => {
    // 45° shifts every handle one 45°-step: n's vertical axis becomes a
    // diagonal, e's horizontal axis becomes the other diagonal.
    expect(rotatedResizeCursor('n', deg(45))).toBe('nesw-resize');
    expect(rotatedResizeCursor('e', deg(45))).toBe('nwse-resize');
    expect(rotatedResizeCursor('ne', deg(45))).toBe('ew-resize');
    expect(rotatedResizeCursor('se', deg(45))).toBe('ns-resize');
  });

  it('snaps within a 45° bucket (±22° stays on the same cursor)', () => {
    expect(rotatedResizeCursor('n', deg(20))).toBe('ns-resize');
    expect(rotatedResizeCursor('n', deg(-20))).toBe('ns-resize');
  });
});

describe('renderOverlay wires rotated handle cursors', () => {
  const OPTIONS: OverlayOptions = { scale: 1, slideWidth: 960, slideHeight: 540 };

  const cursorOf = (overlay: HTMLDivElement, kind: string) =>
    overlay
      .querySelector<HTMLElement>(`[data-handle="${kind}"]`)!
      .style.cursor;

  it('keeps axis-aligned cursors when the element is not rotated', () => {
    const el = {
      id: 'e1',
      type: 'shape',
      frame: { x: 100, y: 100, w: 200, h: 200, rotation: 0 },
      data: { kind: 'rect' },
    } as unknown as Element;
    const overlay = document.createElement('div');
    renderOverlay(overlay, [el], OPTIONS);
    expect(cursorOf(overlay, 'n')).toBe('ns-resize');
    expect(cursorOf(overlay, 'e')).toBe('ew-resize');
  });

  it('rotates handle cursors with a 90° rotated element', () => {
    const el = {
      id: 'e1',
      type: 'shape',
      frame: { x: 100, y: 100, w: 200, h: 200, rotation: Math.PI / 2 },
      data: { kind: 'rect' },
    } as unknown as Element;
    const overlay = document.createElement('div');
    renderOverlay(overlay, [el], OPTIONS);
    // Rotated path is taken (single rotated element); n now stretches
    // horizontally, e vertically.
    expect(cursorOf(overlay, 'n')).toBe('ew-resize');
    expect(cursorOf(overlay, 'e')).toBe('ns-resize');
  });
});

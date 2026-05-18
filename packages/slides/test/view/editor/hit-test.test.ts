// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { handleHitTest } from '../../../src/view/editor/hit-test';

beforeEach(() => { document.body.innerHTML = ''; });

function makeOverlay(): HTMLDivElement {
  const overlay = document.createElement('div');
  overlay.style.position = 'absolute';
  overlay.style.left = '0';
  overlay.style.top = '0';
  overlay.style.width = '500px';
  overlay.style.height = '300px';
  document.body.appendChild(overlay);
  return overlay;
}

function addHandle(
  overlay: HTMLDivElement,
  type: string,
  x: number, y: number, w = 8, h = 8,
): HTMLDivElement {
  const el = document.createElement('div');
  el.dataset.handle = type;
  el.style.position = 'absolute';
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
  overlay.appendChild(el);
  return el;
}

describe('handleHitTest', () => {
  it('returns null when no handle is under the point', () => {
    const overlay = makeOverlay();
    expect(handleHitTest(overlay, 100, 100)).toBeNull();
  });

  it('returns the handle type when point is inside one', () => {
    const overlay = makeOverlay();
    addHandle(overlay, 'nw', 10, 10);
    expect(handleHitTest(overlay, 12, 12)).toBe('nw');
  });

  it('ignores handles without a data-handle attribute', () => {
    const overlay = makeOverlay();
    const stranger = document.createElement('div');
    stranger.style.position = 'absolute';
    stranger.style.left = '0px';
    stranger.style.top = '0px';
    stranger.style.width = '500px';
    stranger.style.height = '300px';
    overlay.appendChild(stranger);
    expect(handleHitTest(overlay, 100, 100)).toBeNull();
  });

  it('returns "rotate" for the rotate handle', () => {
    const overlay = makeOverlay();
    addHandle(overlay, 'rotate', 250, -20);
    expect(handleHitTest(overlay, 254, -16)).toBe('rotate');
  });

  it('tolerance expands the hit rectangle on every side', () => {
    const overlay = makeOverlay();
    // 8x8 handle at (100, 100): default hit area covers (100..108, 100..108).
    addHandle(overlay, 'nw', 100, 100);
    // 14px outside the right edge — outside default, inside tolerance=22.
    expect(handleHitTest(overlay, 122, 104)).toBeNull();
    expect(handleHitTest(overlay, 122, 104, 22)).toBe('nw');
    // 14px above the top edge.
    expect(handleHitTest(overlay, 104, 86)).toBeNull();
    expect(handleHitTest(overlay, 104, 86, 22)).toBe('nw');
  });

  it('tolerance does not reach beyond its radius', () => {
    const overlay = makeOverlay();
    addHandle(overlay, 'nw', 100, 100);
    // 30px outside — beyond 22px tolerance.
    expect(handleHitTest(overlay, 140, 104, 22)).toBeNull();
  });

  it('picks the closest-center handle when tolerance zones overlap', () => {
    const overlay = makeOverlay();
    // Two 8x8 handles 20px apart, centers at (104, 104) and (124, 104).
    // A 22px tolerance makes their expanded rects overlap, so both
    // rects contain the points below. Bias each point off the midpoint
    // so closest-center has a definitive winner.
    addHandle(overlay, 'nw', 100, 100);
    addHandle(overlay, 'n', 120, 100);
    expect(handleHitTest(overlay, 110, 104, 22)).toBe('nw'); // closer to nw
    expect(handleHitTest(overlay, 118, 104, 22)).toBe('n');  // closer to n
  });

  it('closest-center matters even without tolerance (overlapping handles)', () => {
    const overlay = makeOverlay();
    // Two large handles sharing area at (100..130, 100..130).
    addHandle(overlay, 'nw', 100, 100, 30, 30); // center (115, 115)
    addHandle(overlay, 'rotate', 110, 110, 30, 30); // center (125, 125)
    // (118, 118) is inside both; closer to nw center.
    expect(handleHitTest(overlay, 118, 118)).toBe('nw');
    // (124, 124) is closer to rotate center.
    expect(handleHitTest(overlay, 124, 124)).toBe('rotate');
  });
});

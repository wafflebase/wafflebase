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
});

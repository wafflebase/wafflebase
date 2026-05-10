// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import type { Element, ShapeElement } from '../../model/element';
import { renderOverlay } from './overlay';

const HANDLE_SIZE = 8;
const HOST_SCALE = 1; // demo uses 1:1 for these tests
const SLIDE_W = 1920;
const SLIDE_H = 1080;

beforeEach(() => { document.body.innerHTML = ''; });

function makeOverlay(): HTMLDivElement {
  const overlay = document.createElement('div');
  document.body.appendChild(overlay);
  return overlay;
}

function shape(x: number, y: number, w: number, h: number, rotation = 0): Element {
  return {
    id: 'e1', type: 'shape',
    frame: { x, y, w, h, rotation },
    data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
  };
}

describe('renderOverlay', () => {
  it('clears the overlay when no elements are selected', () => {
    const overlay = makeOverlay();
    renderOverlay(overlay, [], { scale: HOST_SCALE, slideWidth: SLIDE_W, slideHeight: SLIDE_H });
    expect(overlay.children.length).toBe(0);
  });

  it('renders 9 handles + 1 frame for a single selected element', () => {
    const overlay = makeOverlay();
    renderOverlay(overlay, [shape(100, 50, 200, 100)], { scale: HOST_SCALE, slideWidth: SLIDE_W, slideHeight: SLIDE_H });
    // 8 resize handles + 1 rotate handle + 1 frame outline = 10 children.
    expect(overlay.children.length).toBe(10);
    const handles = overlay.querySelectorAll('[data-handle]');
    expect(handles.length).toBe(9);
  });

  it('places the nw handle at the frame top-left (centred on the corner)', () => {
    const overlay = makeOverlay();
    renderOverlay(overlay, [shape(100, 50, 200, 100)], { scale: HOST_SCALE, slideWidth: SLIDE_W, slideHeight: SLIDE_H });
    const nw = overlay.querySelector<HTMLDivElement>('[data-handle="nw"]')!;
    expect(parseFloat(nw.style.left)).toBe(100 - HANDLE_SIZE / 2);
    expect(parseFloat(nw.style.top)).toBe(50 - HANDLE_SIZE / 2);
  });

  it('places the rotate handle above the top centre', () => {
    const overlay = makeOverlay();
    renderOverlay(overlay, [shape(100, 50, 200, 100)], { scale: HOST_SCALE, slideWidth: SLIDE_W, slideHeight: SLIDE_H });
    const rot = overlay.querySelector<HTMLDivElement>('[data-handle="rotate"]')!;
    // Top centre = (200, 50); rotate handle sits 24 px above (HANDLE_OFFSET).
    expect(parseFloat(rot.style.left)).toBe(200 - HANDLE_SIZE / 2);
    expect(parseFloat(rot.style.top)).toBe(50 - 24 - HANDLE_SIZE / 2);
  });

  it('uses the combined bbox for multi-select', () => {
    const overlay = makeOverlay();
    renderOverlay(overlay, [
      shape(0, 0, 100, 100),
      shape(200, 50, 50, 50),
    ], { scale: HOST_SCALE, slideWidth: SLIDE_W, slideHeight: SLIDE_H });
    const nw = overlay.querySelector<HTMLDivElement>('[data-handle="nw"]')!;
    expect(parseFloat(nw.style.left)).toBe(0 - HANDLE_SIZE / 2);
    expect(parseFloat(nw.style.top)).toBe(0 - HANDLE_SIZE / 2);
    const se = overlay.querySelector<HTMLDivElement>('[data-handle="se"]')!;
    expect(parseFloat(se.style.left)).toBe(250 - HANDLE_SIZE / 2);
    expect(parseFloat(se.style.top)).toBe(100 - HANDLE_SIZE / 2);
  });

  it('scales handle positions by the host scale factor', () => {
    const overlay = makeOverlay();
    renderOverlay(overlay, [shape(100, 50, 200, 100)], { scale: 0.5, slideWidth: SLIDE_W, slideHeight: SLIDE_H });
    const nw = overlay.querySelector<HTMLDivElement>('[data-handle="nw"]')!;
    expect(parseFloat(nw.style.left)).toBe(100 * 0.5 - HANDLE_SIZE / 2);
  });

  it('rotated single element: handles sit on the rotated frame corners', () => {
    const overlay = makeOverlay();
    // 200×100 frame at (100, 100), rotated 90° (π/2).
    // Centre = (200, 150). After 90° rotation, the LOCAL nw corner
    // (which was at (100, 100) world before rotation) ends up at:
    //   local nw = (-w/2, -h/2) = (-100, -50) relative to centre
    //   R(π/2) * (-100, -50) = (50, -100) relative to centre
    //   world = centre + (50, -100) = (250, 50)
    renderOverlay(overlay, [shape(100, 100, 200, 100, Math.PI / 2)], { scale: 1, slideWidth: SLIDE_W, slideHeight: SLIDE_H });
    const nw = overlay.querySelector<HTMLDivElement>('[data-handle="nw"]')!;
    expect(parseFloat(nw.style.left)).toBeCloseTo(250 - HANDLE_SIZE / 2, 5);
    expect(parseFloat(nw.style.top)).toBeCloseTo(50 - HANDLE_SIZE / 2, 5);

    // The selection outline div uses CSS rotate to align with the
    // rotated frame.
    const outline = overlay.querySelector<HTMLDivElement>('.wfb-slides-selection-frame')!;
    expect(outline.style.transform).toBe(`rotate(${Math.PI / 2}rad)`);
  });

  it('rotated single element: rotate handle sits in the local "up" direction', () => {
    const overlay = makeOverlay();
    // 200×100 frame at origin, 90° rotation. Centre = (100, 50).
    // Top centre local = (100, 0). After 90° rotation around centre:
    //   (100 - 100, 0 - 50) = (0, -50) relative to centre
    //   R(π/2) * (0, -50) = (50, 0) relative to centre
    //   world = (150, 50)
    // Local "up" direction in world = (sin(π/2), -cos(π/2)) = (1, 0).
    // Rotate handle = (150 + 24, 50) = (174, 50) at scale=1.
    renderOverlay(overlay, [shape(0, 0, 200, 100, Math.PI / 2)], { scale: 1, slideWidth: SLIDE_W, slideHeight: SLIDE_H });
    const rot = overlay.querySelector<HTMLDivElement>('[data-handle="rotate"]')!;
    expect(parseFloat(rot.style.left)).toBeCloseTo(174 - HANDLE_SIZE / 2, 5);
    expect(parseFloat(rot.style.top)).toBeCloseTo(50 - HANDLE_SIZE / 2, 5);
  });

  it('renders no snap-guide nodes when guides is empty', () => {
    const overlay = makeOverlay();
    renderOverlay(overlay, [shape(100, 50, 200, 100)], {
      scale: HOST_SCALE,
      slideWidth: SLIDE_W,
      slideHeight: SLIDE_H,
    });
    expect(overlay.querySelectorAll('.wfb-slides-snap-guide').length).toBe(0);
  });

  it('renders a vertical guide line at the slide-center position', () => {
    const overlay = makeOverlay();
    renderOverlay(overlay, [shape(100, 50, 200, 100)], {
      scale: 0.5,
      slideWidth: SLIDE_W,
      slideHeight: SLIDE_H,
      guides: [{ axis: 'x', position: 960, kind: 'slide-center' }],
    });
    const guides = overlay.querySelectorAll<HTMLDivElement>('.wfb-slides-snap-guide');
    expect(guides.length).toBe(1);
    const g = guides[0];
    expect(g.style.left).toBe('480px');
    expect(g.style.top).toBe('0px');
    expect(g.style.width).toBe('1px');
    expect(g.style.height).toBe('540px');
  });

  it('renders a horizontal guide line at the slide-center position', () => {
    const overlay = makeOverlay();
    renderOverlay(overlay, [shape(100, 50, 200, 100)], {
      scale: 0.5,
      slideWidth: SLIDE_W,
      slideHeight: SLIDE_H,
      guides: [{ axis: 'y', position: 540, kind: 'slide-center' }],
    });
    const guides = overlay.querySelectorAll<HTMLDivElement>('.wfb-slides-snap-guide');
    expect(guides.length).toBe(1);
    const g = guides[0];
    expect(g.style.left).toBe('0px');
    expect(g.style.top).toBe('270px');
    expect(g.style.width).toBe('960px');
    expect(g.style.height).toBe('1px');
  });
});

function makeShape(kind: ShapeElement['data']['kind']): ShapeElement {
  return {
    id: 'el1',
    type: 'shape',
    frame: { x: 100, y: 100, w: 200, h: 100, rotation: 0 },
    data: { kind },
  };
}

describe('renderOverlay — adjustment handles', () => {
  let overlay: HTMLDivElement;
  beforeEach(() => {
    overlay = document.createElement('div');
  });

  it('paints a yellow diamond for a selected pilot shape (roundRect)', () => {
    renderOverlay(overlay, [makeShape('roundRect')], { scale: 1 });
    const adj = overlay.querySelector('[data-handle="adjust-0"]');
    expect(adj).not.toBeNull();
  });

  it('paints no adjustment handle for a non-pilot shape (rect)', () => {
    renderOverlay(overlay, [makeShape('rect')], { scale: 1 });
    const adj = overlay.querySelector('[data-handle^="adjust-"]');
    expect(adj).toBeNull();
  });

  it('paints no adjustment handle on multi-selection', () => {
    renderOverlay(
      overlay,
      [makeShape('roundRect'), makeShape('star5')],
      { scale: 1 },
    );
    const adj = overlay.querySelector('[data-handle^="adjust-"]');
    expect(adj).toBeNull();
  });

  it('appends adjustment handles AFTER resize handles in DOM order', () => {
    renderOverlay(overlay, [makeShape('roundRect')], { scale: 1 });
    const children = Array.from(overlay.children);
    const lastResize = children.findIndex(
      (c) => c.getAttribute('data-handle') === 'rotate',
    );
    const firstAdjust = children.findIndex((c) =>
      c.getAttribute('data-handle')?.startsWith('adjust-'),
    );
    expect(firstAdjust).toBeGreaterThan(lastResize);
  });

  it('adjustment handle is the LAST sibling for a pilot shape (z-order check)', () => {
    renderOverlay(overlay, [makeShape('roundRect')], { scale: 1 });
    const lastChild = overlay.lastElementChild;
    expect(lastChild?.getAttribute('data-handle')).toMatch(/^adjust-/);
  });
});

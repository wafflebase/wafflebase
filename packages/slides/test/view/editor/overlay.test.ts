// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import type { Element, ShapeElement } from '../../../src/model/element';
import type { ConnectorElement } from '../../../src/model/connector';
import { renderOverlay } from '../../../src/view/editor/overlay';

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
    renderOverlay(overlay, [makeShape('roundRect')], { scale: 1, slideWidth: SLIDE_W, slideHeight: SLIDE_H });
    const adj = overlay.querySelector('[data-handle="adjust-0"]');
    expect(adj).not.toBeNull();
  });

  it('paints no adjustment handle for a non-pilot shape (rect)', () => {
    renderOverlay(overlay, [makeShape('rect')], { scale: 1, slideWidth: SLIDE_W, slideHeight: SLIDE_H });
    const adj = overlay.querySelector('[data-handle^="adjust-"]');
    expect(adj).toBeNull();
  });

  it('paints no adjustment handle on multi-selection', () => {
    renderOverlay(
      overlay,
      [makeShape('roundRect'), makeShape('star5')],
      { scale: 1, slideWidth: SLIDE_W, slideHeight: SLIDE_H },
    );
    const adj = overlay.querySelector('[data-handle^="adjust-"]');
    expect(adj).toBeNull();
  });

  it('appends adjustment handles AFTER resize handles in DOM order', () => {
    renderOverlay(overlay, [makeShape('roundRect')], { scale: 1, slideWidth: SLIDE_W, slideHeight: SLIDE_H });
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
    renderOverlay(overlay, [makeShape('roundRect')], { scale: 1, slideWidth: SLIDE_W, slideHeight: SLIDE_H });
    const lastChild = overlay.lastElementChild;
    expect(lastChild?.getAttribute('data-handle')).toMatch(/^adjust-/);
  });
});

describe('renderOverlay — connector endpoint handles', () => {
  function freeConnector(): ConnectorElement {
    return {
      id: 'c1',
      type: 'connector',
      routing: 'straight',
      start: { kind: 'free', x: 100, y: 100 },
      end: { kind: 'free', x: 300, y: 100 },
      arrowheads: {},
      frame: { x: 100, y: 100, w: 200, h: 0, rotation: 0 },
    };
  }

  function attachedToRect(
    site: number,
  ): { connector: ConnectorElement; host: Element } {
    const host: Element = {
      id: 'r1',
      type: 'shape',
      frame: { x: 200, y: 200, w: 100, h: 100, rotation: 0 },
      data: { kind: 'rect' },
    };
    const connector: ConnectorElement = {
      id: 'c1',
      type: 'connector',
      routing: 'straight',
      start: { kind: 'attached', elementId: 'r1', siteIndex: site },
      end: { kind: 'free', x: 400, y: 400 },
      arrowheads: {},
      frame: { x: 0, y: 0, w: 0, h: 0, rotation: 0 },
    };
    return { connector, host };
  }

  it('renders exactly two endpoint handles (start + end) for a selected connector', () => {
    const overlay = makeOverlay();
    renderOverlay(overlay, [freeConnector()], {
      scale: 1,
      slideWidth: SLIDE_W,
      slideHeight: SLIDE_H,
    });
    const handles = overlay.querySelectorAll('[data-handle]');
    expect(handles.length).toBe(2);
    expect(overlay.querySelector('[data-handle="start"]')).not.toBeNull();
    expect(overlay.querySelector('[data-handle="end"]')).not.toBeNull();
  });

  it('omits 8-corner resize handles and rotate handle for connectors', () => {
    const overlay = makeOverlay();
    renderOverlay(overlay, [freeConnector()], {
      scale: 1,
      slideWidth: SLIDE_W,
      slideHeight: SLIDE_H,
    });
    for (const k of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w', 'rotate']) {
      expect(overlay.querySelector(`[data-handle="${k}"]`)).toBeNull();
    }
  });

  it('places handles at free-endpoint coords', () => {
    const overlay = makeOverlay();
    renderOverlay(overlay, [freeConnector()], {
      scale: 1,
      slideWidth: SLIDE_W,
      slideHeight: SLIDE_H,
    });
    const start = overlay.querySelector<HTMLDivElement>('[data-handle="start"]')!;
    expect(parseFloat(start.style.left)).toBe(100 - HANDLE_SIZE / 2);
    expect(parseFloat(start.style.top)).toBe(100 - HANDLE_SIZE / 2);
    const end = overlay.querySelector<HTMLDivElement>('[data-handle="end"]')!;
    expect(parseFloat(end.style.left)).toBe(300 - HANDLE_SIZE / 2);
    expect(parseFloat(end.style.top)).toBe(100 - HANDLE_SIZE / 2);
  });

  it('resolves attached endpoints through allElements', () => {
    const overlay = makeOverlay();
    const { connector, host } = attachedToRect(0); // N site
    // r1 at (200, 200), 100×100 — N site = (250, 200).
    renderOverlay(overlay, [connector], {
      scale: 1,
      slideWidth: SLIDE_W,
      slideHeight: SLIDE_H,
      allElements: [connector, host],
    });
    const start = overlay.querySelector<HTMLDivElement>('[data-handle="start"]')!;
    expect(parseFloat(start.style.left)).toBe(250 - HANDLE_SIZE / 2);
    expect(parseFloat(start.style.top)).toBe(200 - HANDLE_SIZE / 2);
  });

  it('marks attached vs free endpoints with distinct classes', () => {
    const overlay = makeOverlay();
    const { connector, host } = attachedToRect(0);
    renderOverlay(overlay, [connector], {
      scale: 1,
      slideWidth: SLIDE_W,
      slideHeight: SLIDE_H,
      allElements: [connector, host],
    });
    const start = overlay.querySelector<HTMLDivElement>('[data-handle="start"]')!;
    const end = overlay.querySelector<HTMLDivElement>('[data-handle="end"]')!;
    expect(start.className).toContain('wfb-slides-endpoint-attached');
    expect(end.className).toContain('wfb-slides-endpoint-free');
  });

  it('multi-select including a connector falls back to combined bbox handles', () => {
    const overlay = makeOverlay();
    const { connector, host } = attachedToRect(0);
    renderOverlay(overlay, [connector, host], {
      scale: 1,
      slideWidth: SLIDE_W,
      slideHeight: SLIDE_H,
      allElements: [connector, host],
    });
    // Resize/rotate handles return for multi-select; endpoint handles
    // should NOT appear.
    expect(overlay.querySelector('[data-handle="start"]')).toBeNull();
    expect(overlay.querySelector('[data-handle="end"]')).toBeNull();
    expect(overlay.querySelector('[data-handle="rotate"]')).not.toBeNull();
  });
});

describe('renderOverlay — connection-points affordance', () => {
  // Helper to build a rect at the given frame. The 4-cardinal sites
  // for a rect at (200, 200, 100, 100) are:
  //   N (0): (250, 200)
  //   E (1): (300, 250)
  //   S (2): (250, 300)
  //   W (3): (200, 250)
  function rectAt(
    id: string,
    x: number,
    y: number,
    w: number,
    h: number,
  ): Element {
    return {
      id,
      type: 'shape',
      frame: { x, y, w, h, rotation: 0 },
      data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
    };
  }

  function connectorAt(): ConnectorElement {
    return {
      id: 'c1',
      type: 'connector',
      routing: 'straight',
      start: { kind: 'free', x: 1000, y: 1000 },
      end: { kind: 'free', x: 1100, y: 1100 },
      arrowheads: {},
      frame: { x: 1000, y: 1000, w: 100, h: 100, rotation: 0 },
    };
  }

  it('renders connection-site dots for the nearest shape when cursor is within hover radius', () => {
    const overlay = makeOverlay();
    const rect = rectAt('r1', 200, 200, 100, 100);
    // N site at (250, 200); cursor 15px below it — well within 24px.
    renderOverlay(overlay, [], {
      scale: 1,
      slideWidth: SLIDE_W,
      slideHeight: SLIDE_H,
      allElements: [rect],
      connectorAffordance: { cursor: { x: 250, y: 215 }, zoom: 1 },
    });
    const dots = overlay.querySelectorAll('[data-connection-site]');
    expect(dots.length).toBe(4); // four cardinal sites
  });

  it("doesn't render connection-site dots when cursor is too far from any shape", () => {
    const overlay = makeOverlay();
    const rect = rectAt('r1', 200, 200, 100, 100);
    // Rect centre is (250, 250); cursor far away.
    renderOverlay(overlay, [], {
      scale: 1,
      slideWidth: SLIDE_W,
      slideHeight: SLIDE_H,
      allElements: [rect],
      connectorAffordance: { cursor: { x: 1000, y: 1000 }, zoom: 1 },
    });
    expect(overlay.querySelectorAll('[data-connection-site]').length).toBe(0);
  });

  it('highlights a connection-site dot when the cursor is within snap radius', () => {
    const overlay = makeOverlay();
    // Small rect so the cursor can land within hover radius of the
    // centre AND within snap radius of a single site. 20x20 at (240,
    // 240): centre = (250, 250); N site = (250, 240); distance N to
    // centre = 10 (well inside the 24 hover radius). Cursor on N site
    // is 0 from N → highlighted; 14.14 from E/W and 20 from S → none
    // of those highlight.
    const rect = rectAt('r1', 240, 240, 20, 20);
    renderOverlay(overlay, [], {
      scale: 1,
      slideWidth: SLIDE_W,
      slideHeight: SLIDE_H,
      allElements: [rect],
      connectorAffordance: { cursor: { x: 250, y: 240 }, zoom: 1 },
    });
    const dots = overlay.querySelectorAll<HTMLDivElement>(
      '[data-connection-site]',
    );
    expect(dots.length).toBe(4);
    const highlighted = Array.from(dots).filter((d) =>
      d.className.includes('wfb-slides-connection-site-highlighted'),
    );
    // Exactly the N site (at (250, 240)) is within 12px of cursor (250,240).
    expect(highlighted.length).toBe(1);
    // The N dot uses the highlighted size (12px), positioned so its centre
    // is at (250, 240).
    expect(parseFloat(highlighted[0].style.left)).toBeCloseTo(250 - 12 / 2);
    expect(parseFloat(highlighted[0].style.top)).toBeCloseTo(240 - 12 / 2);
  });

  it('uses default 8px dot size when cursor is outside snap radius but inside hover radius', () => {
    const overlay = makeOverlay();
    const rect = rectAt('r1', 200, 200, 100, 100);
    // N site at (250, 200); cursor 18px below it — outside the 12px snap
    // radius but inside the 24px hover radius. Affordance fires with no
    // highlighted dots.
    renderOverlay(overlay, [], {
      scale: 1,
      slideWidth: SLIDE_W,
      slideHeight: SLIDE_H,
      allElements: [rect],
      connectorAffordance: { cursor: { x: 250, y: 218 }, zoom: 1 },
    });
    const dots = overlay.querySelectorAll<HTMLDivElement>(
      '[data-connection-site]',
    );
    expect(dots.length).toBe(4);
    for (const d of dots) {
      expect(d.className).not.toContain('wfb-slides-connection-site-highlighted');
      // Default dot size is 8px.
      expect(parseFloat(d.style.width)).toBe(8);
      expect(parseFloat(d.style.height)).toBe(8);
    }
  });

  it('skips connector elements when picking the nearest shape', () => {
    const overlay = makeOverlay();
    const rect = rectAt('r1', 400, 400, 100, 100); // centre (450, 450) — far
    const conn = connectorAt(); // bbox centre (1050, 1050)
    // Cursor sits between rect and connector — neither rect centre nor
    // connector centre is inside 24px; affordance should be empty.
    renderOverlay(overlay, [], {
      scale: 1,
      slideWidth: SLIDE_W,
      slideHeight: SLIDE_H,
      allElements: [rect, conn],
      connectorAffordance: { cursor: { x: 700, y: 700 }, zoom: 1 },
    });
    expect(overlay.querySelectorAll('[data-connection-site]').length).toBe(0);

    // Now place the cursor right on top of the connector's bbox centre.
    // A connector element exposes connection sites in theory, but the
    // affordance must skip connectors so no dots render.
    overlay.innerHTML = '';
    renderOverlay(overlay, [], {
      scale: 1,
      slideWidth: SLIDE_W,
      slideHeight: SLIDE_H,
      allElements: [rect, conn],
      connectorAffordance: { cursor: { x: 1050, y: 1050 }, zoom: 1 },
    });
    // No non-connector shape is within hover radius of the cursor, and
    // the connector itself is skipped — so no dots.
    expect(overlay.querySelectorAll('[data-connection-site]').length).toBe(0);
  });

  it('renders dots for only the single nearest shape (multi-shape does not flood overlay)', () => {
    const overlay = makeOverlay();
    // Two overlapping rects. r1 N site = (250, 200); r2 N site = (260, 210).
    // Cursor at (250, 205) is 5px from r1 N, ~11.2px from r2 N → r1 wins.
    const r1 = rectAt('r1', 200, 200, 100, 100);
    const r2 = rectAt('r2', 210, 210, 100, 100);
    renderOverlay(overlay, [], {
      scale: 1,
      slideWidth: SLIDE_W,
      slideHeight: SLIDE_H,
      allElements: [r1, r2],
      connectorAffordance: { cursor: { x: 250, y: 205 }, zoom: 1 },
    });
    const dots = overlay.querySelectorAll('[data-connection-site]');
    // Only one shape contributes; 4 sites per shape.
    expect(dots.length).toBe(4);
    // Confirm the rendered N dot belongs to r1 (at x=250, not 260).
    const n = overlay.querySelector<HTMLDivElement>(
      '[data-connection-site="0"]',
    )!;
    // Dot is centred on the site, so left = site.x - size/2. Size depends
    // on highlight state, but we don't care — just verify x matches r1.
    const size = parseFloat(n.style.width);
    expect(parseFloat(n.style.left)).toBeCloseTo(250 - size / 2);
  });

  it('no affordance dots when connectorAffordance is omitted', () => {
    const overlay = makeOverlay();
    const rect = rectAt('r1', 200, 200, 100, 100);
    renderOverlay(overlay, [], {
      scale: 1,
      slideWidth: SLIDE_W,
      slideHeight: SLIDE_H,
      allElements: [rect],
    });
    expect(overlay.querySelectorAll('[data-connection-site]').length).toBe(0);
  });

  it('scales dot positions by host scale (pixel-constant size)', () => {
    const overlay = makeOverlay();
    const rect = rectAt('r1', 200, 200, 100, 100);
    // At scale 0.5, the N site at logical (250, 200) maps to host (125, 100).
    // Cursor at (250, 220) is 20px from N site; zoom=0.5 → hover radius is
    // 24/0.5 = 48 logical px, so the site qualifies.
    renderOverlay(overlay, [], {
      scale: 0.5,
      slideWidth: SLIDE_W,
      slideHeight: SLIDE_H,
      allElements: [rect],
      connectorAffordance: { cursor: { x: 250, y: 220 }, zoom: 0.5 },
    });
    const n = overlay.querySelector<HTMLDivElement>(
      '[data-connection-site="0"]',
    )!;
    const size = parseFloat(n.style.width);
    // Dot size stays in host pixels (8 or 12), positioned around the
    // scaled site coords.
    expect(parseFloat(n.style.left)).toBeCloseTo(125 - size / 2);
    expect(parseFloat(n.style.top)).toBeCloseTo(100 - size / 2);
  });

  it('zoom in expands the hover-radius logical reach (24 host px / zoom)', () => {
    const overlay = makeOverlay();
    // Rect centre at (300, 300); cursor at (270, 270) → distance ≈ 42 px.
    // At zoom=1, hover radius is 24 logical → too far, no dots.
    // At zoom=0.5, hover radius is 48 logical → in range, dots render.
    const rect = rectAt('r1', 250, 250, 100, 100);
    renderOverlay(overlay, [], {
      scale: 1,
      slideWidth: SLIDE_W,
      slideHeight: SLIDE_H,
      allElements: [rect],
      connectorAffordance: { cursor: { x: 270, y: 270 }, zoom: 1 },
    });
    expect(overlay.querySelectorAll('[data-connection-site]').length).toBe(0);

    overlay.innerHTML = '';
    renderOverlay(overlay, [], {
      scale: 0.5,
      slideWidth: SLIDE_W,
      slideHeight: SLIDE_H,
      allElements: [rect],
      connectorAffordance: { cursor: { x: 270, y: 270 }, zoom: 0.5 },
    });
    expect(overlay.querySelectorAll('[data-connection-site]').length).toBe(4);
  });

  it('connection-site dots have pointer-events: none so they do not block dragging', () => {
    const overlay = makeOverlay();
    const rect = rectAt('r1', 200, 200, 100, 100);
    // Cursor near N site so the affordance renders dots.
    renderOverlay(overlay, [], {
      scale: 1,
      slideWidth: SLIDE_W,
      slideHeight: SLIDE_H,
      allElements: [rect],
      connectorAffordance: { cursor: { x: 250, y: 215 }, zoom: 1 },
    });
    const dots = overlay.querySelectorAll<HTMLDivElement>(
      '[data-connection-site]',
    );
    expect(dots.length).toBeGreaterThan(0);
    for (const d of dots) {
      expect(d.style.pointerEvents).toBe('none');
    }
  });

  it('renders dots when cursor sits ON a connection site of a large shape', () => {
    const overlay = makeOverlay();
    // Big placeholder-sized rect — centre is FAR from any of its edge sites.
    // r1 at (100, 100, 400, 200): centre (300, 200), N=(300, 100), E=(500, 200).
    // Cursor exactly on N → centre distance is 100 (way outside hover
    // radius) but site distance is 0 → affordance must still fire.
    const rect = rectAt('r1', 100, 100, 400, 200);
    renderOverlay(overlay, [], {
      scale: 1,
      slideWidth: SLIDE_W,
      slideHeight: SLIDE_H,
      allElements: [rect],
      connectorAffordance: { cursor: { x: 300, y: 100 }, zoom: 1 },
    });
    const dots = overlay.querySelectorAll('[data-connection-site]');
    expect(dots.length).toBe(4);
  });
});

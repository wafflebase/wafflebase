// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  EDGE_ZONE_MAX_ROTATION_RAD,
  EDGE_ZONE_THRESHOLD_PX,
  edgeZoneAt,
  edgeZoneCursor,
  handleHitTest,
} from '../../../src/view/editor/hit-test';

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

describe('edgeZoneAt — P2.7 edge-zone region detection', () => {
  const frame = { x: 100, y: 100, w: 200, h: 100, rotation: 0 };

  it('returns null for a point well inside the frame (not near any edge)', () => {
    expect(edgeZoneAt(200, 150, frame)).toBeNull();
  });

  it('returns null for a point well outside the extended bbox', () => {
    expect(edgeZoneAt(0, 0, frame)).toBeNull();
    expect(edgeZoneAt(500, 500, frame)).toBeNull();
  });

  it('detects each single-edge direction just inside the bbox', () => {
    // Mid-edge, 1 px inside.
    expect(edgeZoneAt(200, 101, frame)).toBe('n');
    expect(edgeZoneAt(200, 199, frame)).toBe('s');
    expect(edgeZoneAt(101, 150, frame)).toBe('w');
    expect(edgeZoneAt(299, 150, frame)).toBe('e');
  });

  it('detects each single-edge direction just outside the bbox', () => {
    // Mid-edge, 1 px outside.
    expect(edgeZoneAt(200, 99, frame)).toBe('n');
    expect(edgeZoneAt(200, 201, frame)).toBe('s');
    expect(edgeZoneAt(99, 150, frame)).toBe('w');
    expect(edgeZoneAt(301, 150, frame)).toBe('e');
  });

  it('detects each corner when within threshold of two perpendicular edges', () => {
    expect(edgeZoneAt(101, 101, frame)).toBe('nw');
    expect(edgeZoneAt(299, 101, frame)).toBe('ne');
    expect(edgeZoneAt(101, 199, frame)).toBe('sw');
    expect(edgeZoneAt(299, 199, frame)).toBe('se');
    // Outside-corner cases too.
    expect(edgeZoneAt(98, 98, frame)).toBe('nw');
    expect(edgeZoneAt(302, 202, frame)).toBe('se');
  });

  it('returns null beyond the extended bbox by even 1 px', () => {
    // EDGE_ZONE_THRESHOLD_PX = 4 — 5 px outside any edge fails.
    const t = EDGE_ZONE_THRESHOLD_PX;
    expect(edgeZoneAt(100 - t - 1, 150, frame)).toBeNull();
    expect(edgeZoneAt(300 + t + 1, 150, frame)).toBeNull();
    expect(edgeZoneAt(200, 100 - t - 1, frame)).toBeNull();
    expect(edgeZoneAt(200, 200 + t + 1, frame)).toBeNull();
  });

  it('skips edge detection when rotation exceeds the cap', () => {
    const rotated = { ...frame, rotation: EDGE_ZONE_MAX_ROTATION_RAD + 0.001 };
    expect(edgeZoneAt(101, 150, rotated)).toBeNull();
    expect(edgeZoneAt(200, 101, rotated)).toBeNull();
  });

  it('still detects at the rotation cap (small rotations stay readable)', () => {
    const rotated = { ...frame, rotation: EDGE_ZONE_MAX_ROTATION_RAD };
    expect(edgeZoneAt(101, 150, rotated)).toBe('w');
  });

  it('treats negative rotations symmetrically', () => {
    const rotated = { ...frame, rotation: -EDGE_ZONE_MAX_ROTATION_RAD - 0.001 };
    expect(edgeZoneAt(101, 150, rotated)).toBeNull();
  });

  it('both-axes-narrow frame returns single closest edge, not a corner', () => {
    // 4×4 shape at (0, 0); every interior point is within threshold (4)
    // of all four edges. The cascade default would return 'se' for the
    // geometric center; the collapse picks the strictly-closest single
    // edge instead so the cursor doesn't pretend to be a diagonal.
    const tiny = { x: 0, y: 0, w: 4, h: 4, rotation: 0 };
    // Centroid: equidistant from all 4 edges → first candidate in the
    // sort wins (stable sort keeps insertion order). Acceptable because
    // there is no single "right" answer; the test asserts we don't
    // return a corner cursor.
    const result = edgeZoneAt(2, 2, tiny);
    expect(result).not.toBeNull();
    expect(['n', 's', 'e', 'w']).toContain(result);
    // Off-center pointer favours the closer pair of edges.
    expect(edgeZoneAt(0.5, 2, tiny)).toBe('w');
    expect(edgeZoneAt(2, 3.5, tiny)).toBe('s');
  });
});

describe('edgeZoneCursor — direction → CSS cursor mapping', () => {
  it('maps NW/SE to nwse-resize', () => {
    expect(edgeZoneCursor('nw')).toBe('nwse-resize');
    expect(edgeZoneCursor('se')).toBe('nwse-resize');
  });
  it('maps NE/SW to nesw-resize', () => {
    expect(edgeZoneCursor('ne')).toBe('nesw-resize');
    expect(edgeZoneCursor('sw')).toBe('nesw-resize');
  });
  it('maps N/S to ns-resize', () => {
    expect(edgeZoneCursor('n')).toBe('ns-resize');
    expect(edgeZoneCursor('s')).toBe('ns-resize');
  });
  it('maps E/W to ew-resize', () => {
    expect(edgeZoneCursor('e')).toBe('ew-resize');
    expect(edgeZoneCursor('w')).toBe('ew-resize');
  });
});

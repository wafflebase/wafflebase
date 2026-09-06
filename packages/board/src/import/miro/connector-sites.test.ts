import { describe, it, expect } from 'vitest';
import type { Frame } from '@wafflebase/slides';
import { pickConnectorSite, siteAnchor, siteIndexFor, DIR_E, DIR_N } from './connector-sites';

// Index into the DEFAULT four-cardinal site list, which is what every target
// in this file uses ('rect'). A kind with an override resolves differently —
// see the `siteIndexFor` block at the bottom.
const SITE_N = 0;
const SITE_E = 1;
const SITE_S = 2;
const SITE_W = 3;

/** Frame from a CENTER point, mirroring what `miroFrame` produces. */
const at = (cx: number, cy: number, w = 100, h = 100): Frame => ({
  x: cx - w / 2, y: cy - h / 2, w, h, rotation: 0,
});

// Two frames far apart on the x axis; used where the geometric rule must
// NOT be the one that decides (so a wrong precedence is visible).
const left = at(0, 0);
const right = at(500, 0);

describe('pickConnectorSite — rule 1: explicit relative position', () => {
  it('maps the four cardinal offsets', () => {
    const cases: Array<[{ x: string; y: string }, number]> = [
      [{ x: '50%', y: '0%' }, SITE_N],
      [{ x: '100%', y: '50%' }, SITE_E],
      [{ x: '50%', y: '100%' }, SITE_S],
      [{ x: '0%', y: '50%' }, SITE_W],
    ];
    for (const [position, expected] of cases) {
      expect(pickConnectorSite({ position }, left, right, 'rect')).toBe(expected);
    }
  });

  it('snaps an off-axis offset to the nearest cardinal', () => {
    // 10% across the top edge is still overwhelmingly "north".
    expect(pickConnectorSite({ position: { x: '10%', y: '0%' } }, left, right, 'rect')).toBe(SITE_N);
    // Just past the vertical middle on the right edge is still "east".
    expect(pickConnectorSite({ position: { x: '100%', y: '60%' } }, left, right, 'rect')).toBe(SITE_E);
  });

  it('wins over both snapTo and geometry', () => {
    // snapTo says east, geometry says east, position says north — north wins.
    const site = pickConnectorSite(
      { snapTo: 'right', position: { x: '50%', y: '0%' } },
      left,
      right,
      'rect',
    );
    expect(site).toBe(SITE_N);
  });

  it('tolerates a missing "%" suffix', () => {
    expect(pickConnectorSite({ position: { x: '50', y: '100' } }, left, right, 'rect')).toBe(SITE_S);
  });

  it('falls through to snapTo when the position is malformed', () => {
    const malformed = [
      { x: 'abc', y: '0%' },        // non-numeric junk
      { x: '50%' },                  // missing axis
      { y: '0%' },                   // missing axis
      { x: '', y: '' },              // empty strings
      { x: '50%%', y: '0%' },        // unparseable
      { x: 'NaN%', y: '0%' },
    ];
    for (const position of malformed) {
      expect(pickConnectorSite({ snapTo: 'bottom', position }, left, right, 'rect')).toBe(SITE_S);
    }
  });

  it('falls through to geometry when the position is malformed and snapTo is auto', () => {
    // `left` faces `right`, so the geometric answer for this end is east.
    expect(pickConnectorSite({ snapTo: 'auto', position: { x: 'junk' } }, left, right, 'rect')).toBe(SITE_E);
  });

  it('falls through for a dead-centre offset, which names no edge', () => {
    expect(pickConnectorSite({ position: { x: '50%', y: '50%' } }, left, right, 'rect')).toBe(SITE_E);
  });
});

describe('pickConnectorSite — rule 2: snapTo', () => {
  it('maps each explicit side', () => {
    expect(pickConnectorSite({ snapTo: 'top' }, left, right, 'rect')).toBe(SITE_N);
    expect(pickConnectorSite({ snapTo: 'right' }, left, right, 'rect')).toBe(SITE_E);
    expect(pickConnectorSite({ snapTo: 'bottom' }, left, right, 'rect')).toBe(SITE_S);
    expect(pickConnectorSite({ snapTo: 'left' }, left, right, 'rect')).toBe(SITE_W);
  });

  it('falls through to geometry on "auto"', () => {
    // Geometry: the OTHER frame sits below, so this end leaves the south edge.
    const below = at(0, 500);
    expect(pickConnectorSite({ snapTo: 'auto' }, left, below, 'rect')).toBe(SITE_S);
  });

  it('falls through to geometry on an unknown value', () => {
    const below = at(0, 500);
    expect(pickConnectorSite({ snapTo: 'diagonal' }, left, below, 'rect')).toBe(SITE_S);
  });
});

describe('pickConnectorSite — rule 3: geometric auto', () => {
  it('faces a target to the RIGHT: source E, target W', () => {
    expect(pickConnectorSite(undefined, left, right, 'rect')).toBe(SITE_E);
    expect(pickConnectorSite(undefined, right, left, 'rect')).toBe(SITE_W);
  });

  it('faces a target BELOW: source S, target N (y grows downward)', () => {
    const below = at(0, 500);
    expect(pickConnectorSite(undefined, left, below, 'rect')).toBe(SITE_S);
    expect(pickConnectorSite(undefined, below, left, 'rect')).toBe(SITE_N);
  });

  it('prefers the horizontal axis on a |dx| >= |dy| tie', () => {
    const diagonal = at(300, 300);
    // |dx| === |dy| → horizontal wins.
    expect(pickConnectorSite(undefined, left, diagonal, 'rect')).toBe(SITE_E);
    expect(pickConnectorSite(undefined, diagonal, left, 'rect')).toBe(SITE_W);
  });

  it('picks the dominant axis on an off-tie diagonal', () => {
    // dx 100, dy 400 → vertical dominates.
    const lowerRight = at(100, 400);
    expect(pickConnectorSite(undefined, left, lowerRight, 'rect')).toBe(SITE_S);
    expect(pickConnectorSite(undefined, lowerRight, left, 'rect')).toBe(SITE_N);
  });

  it('uses frame CENTRES, not top-left corners', () => {
    // A very wide, short neighbour whose top-left is to the right of `self`
    // but whose centre is above it: the vertical axis must win.
    const self = at(0, 0, 100, 100);
    const above = at(0, -400, 2000, 100);
    expect(pickConnectorSite(undefined, self, above, 'rect')).toBe(SITE_N);
  });

  it('falls back to east when a frame is unknown', () => {
    expect(pickConnectorSite(undefined, left, undefined, 'rect')).toBe(SITE_E);
    expect(pickConnectorSite(undefined, undefined, right, 'rect')).toBe(SITE_E);
  });

  it('falls back to east for two perfectly coincident frames', () => {
    expect(pickConnectorSite(undefined, left, at(0, 0), 'rect')).toBe(SITE_E);
  });
});

describe('siteIndexFor', () => {
  // The default list is [N, E, S, W], so a cardinal direction and its index
  // happen to coincide — which is exactly what made the ellipse case invisible.
  it('resolves the cardinals against the default four-site list', () => {
    expect(siteIndexFor('rect', DIR_N)).toBe(SITE_N);
    expect(siteIndexFor('rect', DIR_E)).toBe(SITE_E);
    expect(siteIndexFor(undefined, DIR_E)).toBe(SITE_E);
  });

  // An ellipse has EIGHT sites — [N, NW, W, SW, S, SE, E, NE] — so "east" is
  // index 6, not 1. Index 1 is NW: a connector meant for a circle's right-hand
  // side attached to its top-left and bowed away along that outward normal.
  // Every Miro `circle` becomes an ellipse; there are 722 on the reference
  // board.
  it('resolves east on an ellipse to its own east site, not index 1', () => {
    expect(siteIndexFor('ellipse', DIR_E)).toBe(6);
    expect(siteIndexFor('ellipse', DIR_N)).toBe(0);
  });

  it('routes a connector into a circle through the circle-aware index', () => {
    const circle = at(500, 0, 200, 200);
    expect(pickConnectorSite(undefined, circle, left, 'ellipse')).toBe(2); // W
    expect(pickConnectorSite(undefined, left, circle, 'rect')).toBe(SITE_E);
  });
});

describe('siteAnchor', () => {
  it('returns the mid-edge point a connector actually leaves from', () => {
    const frame = at(0, 0, 200, 100);
    expect(siteAnchor(frame, SITE_E, 'rect')).toEqual({ x: 100, y: 0 });
    expect(siteAnchor(frame, SITE_N, 'rect')).toEqual({ x: 0, y: -50 });
  });

  // The renderer rotates a site about the frame centre before drawing, so an
  // anchor that ignored rotation put anything placed along the connector —
  // captions — off the line by up to the frame's own size.
  it('rotates with the frame, as the renderer does', () => {
    const upright = at(0, 0, 200, 100);
    const turned = { ...upright, rotation: Math.PI / 2 };
    const anchor = siteAnchor(turned, SITE_E, 'rect');
    expect(anchor.x).toBeCloseTo(0, 10);
    expect(anchor.y).toBeCloseTo(100, 10);
  });

  it('uses the ellipse geometry for an ellipse site', () => {
    const circle = at(0, 0, 200, 200);
    // Index 6 is the ellipse's east site.
    expect(siteAnchor(circle, 6, 'ellipse')).toEqual({ x: 100, y: 0 });
  });
});

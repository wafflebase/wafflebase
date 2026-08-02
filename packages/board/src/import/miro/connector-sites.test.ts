import { describe, it, expect } from 'vitest';
import type { Frame } from '@wafflebase/slides';
import { pickConnectorSite, SITE_E, SITE_N, SITE_S, SITE_W } from './connector-sites';

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
      expect(pickConnectorSite({ position }, left, right)).toBe(expected);
    }
  });

  it('snaps an off-axis offset to the nearest cardinal', () => {
    // 10% across the top edge is still overwhelmingly "north".
    expect(pickConnectorSite({ position: { x: '10%', y: '0%' } }, left, right)).toBe(SITE_N);
    // Just past the vertical middle on the right edge is still "east".
    expect(pickConnectorSite({ position: { x: '100%', y: '60%' } }, left, right)).toBe(SITE_E);
  });

  it('wins over both snapTo and geometry', () => {
    // snapTo says east, geometry says east, position says north — north wins.
    const site = pickConnectorSite(
      { snapTo: 'right', position: { x: '50%', y: '0%' } },
      left,
      right,
    );
    expect(site).toBe(SITE_N);
  });

  it('tolerates a missing "%" suffix', () => {
    expect(pickConnectorSite({ position: { x: '50', y: '100' } }, left, right)).toBe(SITE_S);
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
      expect(pickConnectorSite({ snapTo: 'bottom', position }, left, right)).toBe(SITE_S);
    }
  });

  it('falls through to geometry when the position is malformed and snapTo is auto', () => {
    // `left` faces `right`, so the geometric answer for this end is east.
    expect(pickConnectorSite({ snapTo: 'auto', position: { x: 'junk' } }, left, right)).toBe(SITE_E);
  });

  it('falls through for a dead-centre offset, which names no edge', () => {
    expect(pickConnectorSite({ position: { x: '50%', y: '50%' } }, left, right)).toBe(SITE_E);
  });
});

describe('pickConnectorSite — rule 2: snapTo', () => {
  it('maps each explicit side', () => {
    expect(pickConnectorSite({ snapTo: 'top' }, left, right)).toBe(SITE_N);
    expect(pickConnectorSite({ snapTo: 'right' }, left, right)).toBe(SITE_E);
    expect(pickConnectorSite({ snapTo: 'bottom' }, left, right)).toBe(SITE_S);
    expect(pickConnectorSite({ snapTo: 'left' }, left, right)).toBe(SITE_W);
  });

  it('falls through to geometry on "auto"', () => {
    // Geometry: the OTHER frame sits below, so this end leaves the south edge.
    const below = at(0, 500);
    expect(pickConnectorSite({ snapTo: 'auto' }, left, below)).toBe(SITE_S);
  });

  it('falls through to geometry on an unknown value', () => {
    const below = at(0, 500);
    expect(pickConnectorSite({ snapTo: 'diagonal' }, left, below)).toBe(SITE_S);
  });
});

describe('pickConnectorSite — rule 3: geometric auto', () => {
  it('faces a target to the RIGHT: source E, target W', () => {
    expect(pickConnectorSite(undefined, left, right)).toBe(SITE_E);
    expect(pickConnectorSite(undefined, right, left)).toBe(SITE_W);
  });

  it('faces a target BELOW: source S, target N (y grows downward)', () => {
    const below = at(0, 500);
    expect(pickConnectorSite(undefined, left, below)).toBe(SITE_S);
    expect(pickConnectorSite(undefined, below, left)).toBe(SITE_N);
  });

  it('prefers the horizontal axis on a |dx| >= |dy| tie', () => {
    const diagonal = at(300, 300);
    // |dx| === |dy| → horizontal wins.
    expect(pickConnectorSite(undefined, left, diagonal)).toBe(SITE_E);
    expect(pickConnectorSite(undefined, diagonal, left)).toBe(SITE_W);
  });

  it('picks the dominant axis on an off-tie diagonal', () => {
    // dx 100, dy 400 → vertical dominates.
    const lowerRight = at(100, 400);
    expect(pickConnectorSite(undefined, left, lowerRight)).toBe(SITE_S);
    expect(pickConnectorSite(undefined, lowerRight, left)).toBe(SITE_N);
  });

  it('uses frame CENTRES, not top-left corners', () => {
    // A very wide, short neighbour whose top-left is to the right of `self`
    // but whose centre is above it: the vertical axis must win.
    const self = at(0, 0, 100, 100);
    const above = at(0, -400, 2000, 100);
    expect(pickConnectorSite(undefined, self, above)).toBe(SITE_N);
  });

  it('falls back to east when a frame is unknown', () => {
    expect(pickConnectorSite(undefined, left, undefined)).toBe(SITE_E);
    expect(pickConnectorSite(undefined, undefined, right)).toBe(SITE_E);
  });

  it('falls back to east for two perfectly coincident frames', () => {
    expect(pickConnectorSite(undefined, left, at(0, 0))).toBe(SITE_E);
  });
});

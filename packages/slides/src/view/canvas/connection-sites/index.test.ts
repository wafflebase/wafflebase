import { describe, it, expect } from 'vitest';
import { connectionSitesForKind, getConnectionSites, siteWorldPos } from './index';
import type { Element } from '../../../model/element';

const shape = (kind: string): Element =>
  ({
    id: 'e1',
    type: 'shape',
    frame: { x: 0, y: 0, w: 100, h: 100, rotation: 0 },
    data: { kind },
  }) as unknown as Element;

describe('connectionSitesForKind', () => {
  // The kind-addressed form exists for importers, which choose a `siteIndex`
  // while building `ElementInit`s and so have no `Element` to pass. It must
  // agree with the element-addressed one or an imported connector attaches
  // somewhere the renderer never draws.
  it('agrees with getConnectionSites for every kind that overrides', () => {
    for (const kind of ['ellipse', 'diamond', 'parallelogram', 'trapezoid', 'rect']) {
      expect(connectionSitesForKind(kind as never)).toBe(getConnectionSites(shape(kind)));
    }
  });

  it('gives a non-shape the cardinal set, as an element would get', () => {
    expect(connectionSitesForKind(undefined)).toHaveLength(4);
  });

  // The trap this export exists to close: an ellipse's list is EIGHT long and
  // its index 1 is NW, so an importer assuming `[N, E, S, W]` sends a
  // right-hand connector to the shape's top-left corner.
  it('reports the ellipse list that makes a cardinal index wrong', () => {
    const sites = connectionSitesForKind('ellipse');
    expect(sites).toHaveLength(8);
    expect(sites[1]).toMatchObject({ x: expect.closeTo(0.1464, 3) });
    expect(sites[6]).toMatchObject({ x: 1, y: 0.5 });
  });
});

describe('siteWorldPos', () => {
  it('places a site on the unrotated frame', () => {
    const frame = { x: 10, y: 20, w: 200, h: 100, rotation: 0 };
    expect(siteWorldPos({ frame }, { x: 1, y: 0.5, angle: 0 }))
      .toMatchObject({ x: 210, y: 70 });
  });

  it('rotates a site about the frame centre', () => {
    const frame = { x: 0, y: 0, w: 200, h: 100, rotation: Math.PI / 2 };
    const { x, y } = siteWorldPos({ frame }, { x: 1, y: 0.5, angle: 0 });
    expect(x).toBeCloseTo(100, 10);
    expect(y).toBeCloseTo(150, 10);
  });
});

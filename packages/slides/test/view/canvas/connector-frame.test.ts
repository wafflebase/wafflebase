import { describe, expect, it } from 'vitest';
import type { ConnectorElement } from '../../../src/model/connector';
import type { Element, GroupElement, ShapeElement } from '../../../src/model/element';
import { buildElementWorldLookup } from '../../../src/model/group';
import { computeConnectorFrame } from '../../../src/view/canvas/connector-frame';

const baseConnector = (
  start: ConnectorElement['start'],
  end: ConnectorElement['end'],
): ConnectorElement => ({
  id: 'c1',
  type: 'connector',
  routing: 'straight',
  start,
  end,
  arrowheads: {},
  frame: { x: 0, y: 0, w: 0, h: 0, rotation: 0 },
  stroke: { color: { kind: 'role', role: 'text' }, width: 2 },
});

describe('computeConnectorFrame', () => {
  it('free-free: bbox of two endpoints + stroke padding', () => {
    const c = baseConnector(
      { kind: 'free', x: 100, y: 50 },
      { kind: 'free', x: 400, y: 200 },
    );
    const f = computeConnectorFrame(c, new Map());
    // bbox is (100, 50)-(400, 200); padding = stroke/2 = 1 each side.
    expect(f.x).toBeCloseTo(99);
    expect(f.y).toBeCloseTo(49);
    expect(f.w).toBeCloseTo(302);
    expect(f.h).toBeCloseTo(152);
    expect(f.rotation).toBe(0);
  });

  it('attached: resolves via lookup map then bboxes', () => {
    const target: Element = {
      id: 't1',
      type: 'shape',
      frame: { x: 200, y: 100, w: 100, h: 100, rotation: 0 },
      data: { kind: 'rect' },
    };
    const c = baseConnector(
      { kind: 'free', x: 0, y: 0 },
      { kind: 'attached', elementId: 't1', siteIndex: 1 }, // E of target
    );
    const lookup = new Map<string, Element>([['t1', target]]);
    const f = computeConnectorFrame(c, lookup);
    // Endpoints: (0,0) and target-E = (300, 150).
    expect(f.x).toBeCloseTo(-1);
    expect(f.y).toBeCloseTo(-1);
    expect(f.w).toBeCloseTo(302);
    expect(f.h).toBeCloseTo(152);
  });

  it('attached to deleted element: falls back to (0,0)', () => {
    const c = baseConnector(
      { kind: 'attached', elementId: 'gone', siteIndex: 0 },
      { kind: 'free', x: 50, y: 50 },
    );
    const f = computeConnectorFrame(c, new Map());
    expect(f.x).toBeCloseTo(-1);
    expect(f.y).toBeCloseTo(-1);
    expect(f.w).toBeCloseTo(52);
    expect(f.h).toBeCloseTo(52);
  });

  it('attached to shape nested in a group: resolves through group transform', () => {
    // Reproduces the slide-24 PPTX bug: a top-level connector targets a
    // shape inside a <p:grpSp>. Group children store their frames in
    // group-local coords, so the lookup MUST hand the connector a
    // world-frame view of the nested target — otherwise siteWorldPos
    // would treat the local (10, 5) offset as world coordinates.
    const child: ShapeElement = {
      id: 'child',
      type: 'shape',
      // group-local frame inside the group's (0..refSize.w × 0..refSize.h) space
      frame: { x: 10, y: 5, w: 100, h: 100, rotation: 0 },
      data: { kind: 'rect' },
    };
    const group: GroupElement = {
      id: 'g',
      type: 'group',
      frame: { x: 500, y: 300, w: 200, h: 200, rotation: 0 },
      data: { children: [child], refSize: { w: 200, h: 200 } },
    };
    const c = baseConnector(
      { kind: 'free', x: 0, y: 0 },
      { kind: 'attached', elementId: 'child', siteIndex: 1 }, // E of child
    );
    const lookup = buildElementWorldLookup([group]);
    const f = computeConnectorFrame(c, lookup);
    // child's world frame: (500+10, 300+5, 100, 100) → east site (610, 355).
    // bbox of (0,0)-(610,355) ± stroke half-width (= 1).
    expect(f.x).toBeCloseTo(-1);
    expect(f.y).toBeCloseTo(-1);
    expect(f.w).toBeCloseTo(612);
    expect(f.h).toBeCloseTo(357);
  });
});

describe('computeConnectorFrame — non-straight routings', () => {
  it('curved: bbox extends beyond the endpoints when control points pull out', () => {
    // Free endpoints with curved routing: free-endpoint exit direction is
    // atan2(other - self), so the chord and the curve are collinear and the
    // bbox stays at the chord. We instead use an attached endpoint whose
    // outward angle pulls the curve outside the chord.
    const target: Element = {
      id: 't1',
      type: 'shape',
      // Square at origin; East site = (100, 50) facing east.
      frame: { x: 0, y: 0, w: 100, h: 100, rotation: 0 },
      data: { kind: 'rect' },
    };
    const c: ConnectorElement = {
      ...baseConnector(
        { kind: 'attached', elementId: 't1', siteIndex: 1 }, // E of target
        { kind: 'free', x: 100, y: 250 },
      ),
      routing: 'curved',
    };
    const lookup = new Map<string, Element>([['t1', target]]);
    const f = computeConnectorFrame(c, lookup);
    // Chord from (100, 50) to (100, 250) is vertical. The east exit at
    // (100, 50) bends the bezier eastward of x = 100 before turning back,
    // so maxX must extend past 100.
    expect(f.x + f.w).toBeGreaterThan(100 + 1); // > endpoint x + pad
  });

  it('elbow: bbox covers the polyline including the corner', () => {
    const target: Element = {
      id: 't1',
      type: 'shape',
      frame: { x: 0, y: 0, w: 100, h: 100, rotation: 0 },
      data: { kind: 'rect' },
    };
    const c: ConnectorElement = {
      ...baseConnector(
        { kind: 'attached', elementId: 't1', siteIndex: 1 }, // E (angle 0)
        { kind: 'free', x: 100, y: 250 },
      ),
      routing: 'elbow',
    };
    // E + free-pointing-south is perpendicular → L through (100, 50);
    // free endpoint exit ≈ S because other endpoint is south of free pos
    // (actually the free endpoint is south, exit points back at a → N).
    // Let's verify by tightening the case manually:
    // a = (100, 50) angle 0 (east). b = (100, 250) free; other = (100,50),
    // so b's angle = atan2(50-250, 100-100) = atan2(-200, 0) = -π/2 (north).
    // E + N: perpendicular → corner = (b.x, a.y) = (100, 50).
    // Polyline: (100, 50) → (100, 50) → (100, 250). Bbox = x:[100,100],
    // y:[50,250], plus 1px pad each side.
    const lookup = new Map<string, Element>([['t1', target]]);
    const f = computeConnectorFrame(c, lookup);
    expect(f.x).toBeCloseTo(99);
    expect(f.y).toBeCloseTo(49);
    expect(f.h).toBeCloseTo(202);
  });
});

describe('buildElementWorldLookup', () => {
  it('top-level elements pass through with their own frames', () => {
    const a: Element = {
      id: 'a',
      type: 'shape',
      frame: { x: 10, y: 20, w: 30, h: 40, rotation: 0 },
      data: { kind: 'rect' },
    };
    const lookup = buildElementWorldLookup([a]);
    expect(lookup.get('a')?.frame).toEqual(a.frame);
  });

  it('group children come back with composed world frames', () => {
    const child: ShapeElement = {
      id: 'child',
      type: 'shape',
      frame: { x: 10, y: 5, w: 100, h: 100, rotation: 0 },
      data: { kind: 'rect' },
    };
    const group: GroupElement = {
      id: 'g',
      type: 'group',
      frame: { x: 500, y: 300, w: 200, h: 200, rotation: 0 },
      data: { children: [child], refSize: { w: 200, h: 200 } },
    };
    const lookup = buildElementWorldLookup([group]);
    const w = lookup.get('child')?.frame;
    expect(w?.x).toBeCloseTo(510);
    expect(w?.y).toBeCloseTo(305);
    expect(w?.w).toBeCloseTo(100);
    expect(w?.h).toBeCloseTo(100);
  });

  it('nested groups compose transforms', () => {
    const leaf: ShapeElement = {
      id: 'leaf',
      type: 'shape',
      frame: { x: 1, y: 2, w: 10, h: 10, rotation: 0 },
      data: { kind: 'rect' },
    };
    const inner: GroupElement = {
      id: 'inner',
      type: 'group',
      frame: { x: 100, y: 200, w: 50, h: 50, rotation: 0 },
      data: { children: [leaf], refSize: { w: 50, h: 50 } },
    };
    const outer: GroupElement = {
      id: 'outer',
      type: 'group',
      frame: { x: 1000, y: 2000, w: 300, h: 300, rotation: 0 },
      data: { children: [inner], refSize: { w: 300, h: 300 } },
    };
    const lookup = buildElementWorldLookup([outer]);
    const w = lookup.get('leaf')?.frame;
    // outer translates (100,200)→(1100,2200); leaf adds (1,2) → (1101, 2202).
    expect(w?.x).toBeCloseTo(1101);
    expect(w?.y).toBeCloseTo(2202);
  });

  it('nested groups themselves are lifted to world frames', () => {
    // Guards against the case where a connector attaches to a nested
    // GROUP element (rare but possible — `siteIndex` works on any
    // element). The inner group's stored frame is in the OUTER group's
    // local space; the lookup must lift it through the outer transform
    // or `siteWorldPos` reads the local offset as world.
    const inner: GroupElement = {
      id: 'inner',
      type: 'group',
      frame: { x: 100, y: 200, w: 50, h: 50, rotation: 0 },
      data: { children: [], refSize: { w: 50, h: 50 } },
    };
    const outer: GroupElement = {
      id: 'outer',
      type: 'group',
      frame: { x: 1000, y: 2000, w: 300, h: 300, rotation: 0 },
      data: { children: [inner], refSize: { w: 300, h: 300 } },
    };
    const lookup = buildElementWorldLookup([outer]);
    expect(lookup.get('inner')?.frame.x).toBeCloseTo(1100);
    expect(lookup.get('inner')?.frame.y).toBeCloseTo(2200);
    // Outer (top-level) keeps its already-world frame untouched.
    expect(lookup.get('outer')?.frame).toEqual(outer.frame);
  });

  it('group scaling propagates to children', () => {
    const child: ShapeElement = {
      id: 'child',
      type: 'shape',
      frame: { x: 10, y: 10, w: 50, h: 50, rotation: 0 },
      data: { kind: 'rect' },
    };
    // frame.w / refSize.w = 200/100 = 2× horizontal scale.
    const group: GroupElement = {
      id: 'g',
      type: 'group',
      frame: { x: 0, y: 0, w: 200, h: 100, rotation: 0 },
      data: { children: [child], refSize: { w: 100, h: 100 } },
    };
    const lookup = buildElementWorldLookup([group]);
    const w = lookup.get('child')?.frame;
    // Centre scales 2× horizontally: child local centre (35, 35) →
    // world centre (70, 35); width 50 → 100, height 50 → 50.
    expect(w?.x).toBeCloseTo(20);
    expect(w?.y).toBeCloseTo(10);
    expect(w?.w).toBeCloseTo(100);
    expect(w?.h).toBeCloseTo(50);
  });
});

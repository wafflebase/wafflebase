import { describe, expect, it } from 'vitest';
import {
  bendFromCursor,
  bendHandlePosition,
} from '../../../src/view/canvas/connector-bend';
import type { ConnectorElement } from '../../../src/model/connector';
import type { Element } from '../../../src/model/element';

const EMPTY = new Map<string, Element>();

function curved(
  start: { x: number; y: number },
  end: { x: number; y: number },
  curveBend?: number,
): ConnectorElement {
  return {
    id: 'c1',
    z: 0,
    opacity: 1,
    type: 'connector',
    routing: 'curved',
    start: { kind: 'free', ...start },
    end: { kind: 'free', ...end },
    arrowheads: {},
    frame: { x: 0, y: 0, w: 0, h: 0, rotation: 0 },
    curveBend,
  } as unknown as ConnectorElement;
}

function elbowZ(): ConnectorElement {
  // Parallel-opposite-facing horizontal exits → Z. Free endpoints, so
  // exit direction is atan2(other - self) → east for `start`, west for `end`.
  return {
    id: 'c2',
    z: 0,
    opacity: 1,
    type: 'connector',
    routing: 'elbow',
    start: { kind: 'free', x: 0, y: 0 },
    end: { kind: 'free', x: 200, y: 100 },
    arrowheads: {},
    frame: { x: 0, y: 0, w: 0, h: 0, rotation: 0 },
  } as unknown as ConnectorElement;
}

describe('bendHandlePosition', () => {
  it('curved: returns the bezier midpoint (t=0.5)', () => {
    const c = curved({ x: 0, y: 0 }, { x: 300, y: 0 });
    const p = bendHandlePosition(c, EMPTY);
    expect(p).not.toBeNull();
    // Curved exits both point at the other endpoint (free endpoints),
    // so the chord lies along x; the bezier at t=0.5 lies on the chord.
    expect(p!.x).toBeCloseTo(150, 3);
    expect(p!.y).toBeCloseTo(0, 3);
  });

  it('elbow Z: returns the midpoint of the cross-leg (mid-segment)', () => {
    const p = bendHandlePosition(elbowZ(), EMPTY);
    expect(p).not.toBeNull();
    // Z is [a, p1, p2, b] with p1, p2 sharing x = aPar + (bPar - aPar) * 0.5 = 100.
    expect(p!.x).toBeCloseTo(100, 3);
    expect(p!.y).toBeCloseTo(50, 3);
  });

  it('straight routing: returns null (no bend handle)', () => {
    const c = {
      ...curved({ x: 0, y: 0 }, { x: 100, y: 0 }),
      routing: 'straight' as const,
    };
    expect(bendHandlePosition(c, EMPTY)).toBeNull();
  });
});

describe('bendFromCursor', () => {
  it('elbow Z: cursor closer to start endpoint → smaller ratio', () => {
    const c = elbowZ();
    const r = bendFromCursor(c, { x: 50, y: 50 }, EMPTY);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(0.25, 2); // 50 / 200
  });

  it('elbow Z: cursor closer to end endpoint → larger ratio', () => {
    const c = elbowZ();
    const r = bendFromCursor(c, { x: 150, y: 50 }, EMPTY);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(0.75, 2);
  });

  it('curved: larger perpendicular distance from chord → larger bend', () => {
    // Free-endpoint curved fixtures have exit directions along the chord,
    // so the analytic perpendicular term collapses and the helper uses a
    // graceful fallback that's monotonic in |cursorPerp|. Assert
    // monotonicity rather than a specific magnitude.
    const c = curved({ x: 0, y: 0 }, { x: 300, y: 0 });
    const small = bendFromCursor(c, { x: 150, y: 30 }, EMPTY);
    const large = bendFromCursor(c, { x: 150, y: 100 }, EMPTY);
    expect(small).not.toBeNull();
    expect(large).not.toBeNull();
    expect(large!).toBeGreaterThan(small!);
  });

  it('curved: cursor on the chord → bend ~0.1 (clamped minimum)', () => {
    const c = curved({ x: 0, y: 0 }, { x: 300, y: 0 });
    const r = bendFromCursor(c, { x: 150, y: 0 }, EMPTY);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(0.1, 5);
  });
});

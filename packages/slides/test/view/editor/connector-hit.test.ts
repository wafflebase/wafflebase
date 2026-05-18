import { describe, it, expect } from 'vitest';
import '../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../src/view/canvas/test-canvas-env';
import type { ConnectorElement } from '../../../src/model/connector';
import {
  hitTestElement,
  DEFAULT_HIT_TOLERANCE,
} from '../../../src/view/editor/element-hit';

const baseConnector = (
  start: ConnectorElement['start'],
  end: ConnectorElement['end'],
  strokeWidth = 2,
): ConnectorElement => ({
  id: 'c1',
  type: 'connector',
  routing: 'straight',
  start,
  end,
  arrowheads: {},
  frame: { x: 0, y: 0, w: 0, h: 0, rotation: 0 },
  stroke: { color: { kind: 'role', role: 'text' }, width: strokeWidth },
});

const ctx = createTestCanvas(1, 1).getContext('2d');

describe('hitTestElement — connector', () => {
  const horizontal = baseConnector(
    { kind: 'free', x: 10, y: 10 },
    { kind: 'free', x: 200, y: 10 },
  );

  it('hits a point on the line', () => {
    expect(hitTestElement(horizontal, 100, 10, ctx)).toBe(true);
  });

  it('hits a point just off the line within tolerance', () => {
    // stroke half-width = 1; default tolerance = 6 → limit = 7.
    expect(hitTestElement(horizontal, 100, 16, ctx)).toBe(true);
  });

  it('misses a point well off the line', () => {
    expect(hitTestElement(horizontal, 100, 30, ctx)).toBe(false);
  });

  it('hits at the endpoints', () => {
    expect(hitTestElement(horizontal, 10, 10, ctx)).toBe(true);
    expect(hitTestElement(horizontal, 200, 10, ctx)).toBe(true);
  });

  it('misses past the endpoints (beyond stroke + tolerance)', () => {
    expect(hitTestElement(horizontal, -10, 10, ctx)).toBe(false);
    expect(hitTestElement(horizontal, 250, 10, ctx)).toBe(false);
  });

  it('misses a point inside its bbox but far from the diagonal line', () => {
    // A diagonal connector from (10, 10) to (200, 200) — bbox spans
    // 190x190 but the line itself only occupies the y=x diagonal.
    // (10, 190) is inside the bbox, ~127 px from the diagonal.
    const diagonal = baseConnector(
      { kind: 'free', x: 10, y: 10 },
      { kind: 'free', x: 200, y: 200 },
    );
    expect(hitTestElement(diagonal, 10, 190, ctx)).toBe(false);
    // (50, 50) is on the diagonal.
    expect(hitTestElement(diagonal, 50, 50, ctx)).toBe(true);
  });

  it('respects a caller-supplied tolerance override', () => {
    // tolerance = 1 → limit = 1 + half-width 1 = 2.
    expect(hitTestElement(horizontal, 100, 5, ctx, { tolerance: 1 })).toBe(false);
    expect(hitTestElement(horizontal, 100, 11, ctx, { tolerance: 1 })).toBe(true);
  });

  it('uses default tolerance when none is provided', () => {
    expect(DEFAULT_HIT_TOLERANCE).toBeGreaterThan(0);
  });

  it('scales the hit threshold with stroke width', () => {
    const thick = baseConnector(
      { kind: 'free', x: 10, y: 10 },
      { kind: 'free', x: 200, y: 10 },
      20,
    );
    // half-width = 10 + tolerance 6 → 16 px tolerated.
    expect(hitTestElement(thick, 100, 25, ctx)).toBe(true);
    expect(hitTestElement(thick, 100, 40, ctx)).toBe(false);
  });
});

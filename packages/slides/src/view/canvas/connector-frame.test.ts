import { describe, expect, it } from 'vitest';
import type { ConnectorElement } from '../../model/connector';
import type { Element } from '../../model/element';
import { computeConnectorFrame } from './connector-frame';

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
});

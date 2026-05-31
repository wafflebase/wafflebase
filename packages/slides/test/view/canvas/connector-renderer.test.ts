import { describe, expect, it } from 'vitest';
import type { ConnectorElement } from '../../../src/model/connector';
import type { Element } from '../../../src/model/element';
import type { Theme } from '../../../src/model/theme';
import { asCtx, createCtxSpy } from '../../../src/view/canvas/ctx-spy';
import { drawConnector } from '../../../src/view/canvas/connector-renderer';

const THEME: Theme = {
  id: 't',
  name: 't',
  colors: {
    text: '#000',
    background: '#fff',
    textSecondary: '#444',
    backgroundAlt: '#f3f3f3',
    accent1: '#abc',
    accent2: '#bcd',
    accent3: '#cde',
    accent4: '#def',
    accent5: '#e0e1e2',
    accent6: '#f0f1f2',
    hyperlink: '#11c',
    visitedHyperlink: '#71a',
  },
  fonts: { heading: 'Inter', body: 'Inter' },
};

function fakeConnector(
  overrides: Partial<ConnectorElement> = {},
): ConnectorElement {
  return {
    id: 'c1',
    type: 'connector',
    routing: 'straight',
    start: { kind: 'free', x: 0, y: 0 },
    end: { kind: 'free', x: 100, y: 0 },
    arrowheads: {},
    frame: { x: 0, y: 0, w: 100, h: 0, rotation: 0 },
    stroke: { color: { kind: 'role', role: 'text' }, width: 2 },
    ...overrides,
  };
}

describe('drawConnector', () => {
  it('draws a stroked line between the two endpoints', () => {
    const spy = createCtxSpy();
    const c = fakeConnector();
    drawConnector(asCtx(spy), c, new Map<string, Element>(), THEME);
    expect(spy.beginPath).toHaveBeenCalledTimes(1);
    expect(spy.moveTo).toHaveBeenCalledWith(0, 0);
    expect(spy.lineTo).toHaveBeenCalledWith(100, 0);
    expect(spy.stroke).toHaveBeenCalledTimes(1);
  });

  it('resolves the stroke colour through the theme (default text role)', () => {
    const spy = createCtxSpy();
    drawConnector(asCtx(spy), fakeConnector(), new Map(), THEME);
    expect(spy.strokeStyle).toBe('#000'); // text role
    expect(spy.lineWidth).toBe(2);
  });

  it('with end arrowhead: also fills the arrowhead triangle', () => {
    const spy = createCtxSpy();
    const c = fakeConnector({
      arrowheads: { end: { kind: 'triangle', size: 'md' } },
    });
    drawConnector(asCtx(spy), c, new Map(), THEME);
    expect(spy.fill).toHaveBeenCalled();
  });

  it('with start arrowhead pointing back along -direction', () => {
    const spy = createCtxSpy();
    const c = fakeConnector({
      arrowheads: { start: { kind: 'triangle', size: 'md' } },
    });
    drawConnector(asCtx(spy), c, new Map(), THEME);
    // Arrowhead triangle tip lands on the start endpoint (0, 0).
    expect(spy.moveTo).toHaveBeenCalledWith(0, 0);
    expect(spy.fill).toHaveBeenCalled();
  });

  it('without arrowheads: never calls fill', () => {
    const spy = createCtxSpy();
    drawConnector(asCtx(spy), fakeConnector(), new Map(), THEME);
    expect(spy.fill).not.toHaveBeenCalled();
  });

  it('resolves attached endpoints through the elements lookup', () => {
    const target: Element = {
      id: 't1',
      type: 'shape',
      frame: { x: 200, y: 100, w: 100, h: 100, rotation: 0 },
      data: { kind: 'rect' },
    };
    const lookup = new Map<string, Element>([['t1', target]]);
    const c = fakeConnector({
      start: { kind: 'free', x: 0, y: 0 },
      end: { kind: 'attached', elementId: 't1', siteIndex: 1 }, // E side
    });
    const spy = createCtxSpy();
    drawConnector(asCtx(spy), c, lookup, THEME);
    expect(spy.moveTo).toHaveBeenCalledWith(0, 0);
    expect(spy.lineTo).toHaveBeenCalledWith(300, 150);
  });

  it('curved routing: strokes a cubic bezier between the endpoints', () => {
    // dist = 300 → k = 100. Free endpoints get exit dirs from the other
    // endpoint, so c1 = a + 100·(toward b), c2 = b + 100·(toward a).
    const c = fakeConnector({
      routing: 'curved',
      start: { kind: 'free', x: 0, y: 0 },
      end: { kind: 'free', x: 300, y: 0 },
    });
    const spy = createCtxSpy();
    drawConnector(asCtx(spy), c, new Map(), THEME);
    expect(spy.moveTo).toHaveBeenCalledWith(0, 0);
    expect(spy.bezierCurveTo).toHaveBeenCalledTimes(1);
    const [c1x, c1y, c2x, c2y, x1, y1] = spy.bezierCurveTo.mock.calls[0];
    expect(c1x).toBeCloseTo(100);
    expect(c1y).toBeCloseTo(0);
    expect(c2x).toBeCloseTo(200);
    expect(c2y).toBeCloseTo(0);
    expect(x1).toBeCloseTo(300);
    expect(y1).toBeCloseTo(0);
    expect(spy.lineTo).not.toHaveBeenCalled();
  });

  it('curved routing with attached endpoint pulls the curve along the exit angle', () => {
    const target: Element = {
      id: 't1',
      type: 'shape',
      frame: { x: 0, y: 0, w: 100, h: 100, rotation: 0 },
      data: { kind: 'rect' },
    };
    const c = fakeConnector({
      routing: 'curved',
      start: { kind: 'attached', elementId: 't1', siteIndex: 1 }, // E (angle 0)
      end: { kind: 'free', x: 100, y: 250 },
    });
    const spy = createCtxSpy();
    drawConnector(asCtx(spy), c, new Map([['t1', target]]), THEME);
    // start = (100, 50) angle 0; end = (100, 250) with free angle pointing
    // at start → N. dist = 200 → k ≈ 66.67. c1 = (100+66.67, 50) =
    // (166.67, 50); c2 = (100, 250 - 66.67) = (100, 183.33).
    expect(spy.moveTo).toHaveBeenCalledWith(100, 50);
    const [cx1, cy1, cx2, cy2, x1, y1] = spy.bezierCurveTo.mock.calls[0];
    expect(cx1).toBeCloseTo(166.67, 1);
    expect(cy1).toBeCloseTo(50, 1);
    expect(cx2).toBeCloseTo(100, 1);
    expect(cy2).toBeCloseTo(183.33, 1);
    expect(x1).toBeCloseTo(100, 1);
    expect(y1).toBeCloseTo(250, 1);
  });

  it('elbow routing: strokes a polyline through the corner', () => {
    // a = (0,0) east, b = (200,150) free → other-pointing angle from b is
    // atan2(0-150, 0-200) ≈ -π+atan2(-150,-200), which snaps to W. So
    // routing is E + W facing each other (a.x < b.x) → 2-bend Z, mid x = 100.
    const target: Element = {
      id: 't1',
      type: 'shape',
      frame: { x: -100, y: -50, w: 100, h: 100, rotation: 0 },
      data: { kind: 'rect' },
    };
    const c = fakeConnector({
      routing: 'elbow',
      start: { kind: 'attached', elementId: 't1', siteIndex: 1 }, // E of target → (0, 0)
      end: { kind: 'free', x: 200, y: 150 },
    });
    const spy = createCtxSpy();
    drawConnector(asCtx(spy), c, new Map([['t1', target]]), THEME);
    expect(spy.moveTo).toHaveBeenCalledWith(0, 0);
    expect(spy.bezierCurveTo).not.toHaveBeenCalled();
    expect(spy.lineTo.mock.calls).toEqual([[100, 0], [100, 150], [200, 150]]);
  });

  it('curved routing with end arrowhead: arrowhead aligns with the bezier tangent', () => {
    // Use a vertical end where the path arrives traveling +x along the
    // bezier tangent so the arrowhead tip lands on the endpoint and the
    // triangle base extends back along the curve.
    const target: Element = {
      id: 't1',
      type: 'shape',
      frame: { x: 0, y: 0, w: 100, h: 100, rotation: 0 },
      data: { kind: 'rect' },
    };
    const c = fakeConnector({
      routing: 'curved',
      start: { kind: 'attached', elementId: 't1', siteIndex: 1 }, // E (angle 0)
      end: { kind: 'free', x: 300, y: 0 },
    });
    const spy = createCtxSpy();
    drawConnector(asCtx(spy), c, new Map([['t1', target]]), THEME);
    expect(spy.fill).not.toHaveBeenCalled(); // no arrowheads yet
    const c2 = fakeConnector({
      ...c,
      id: 'c2',
      arrowheads: { end: { kind: 'triangle', size: 'md' } },
    });
    const spy2 = createCtxSpy();
    drawConnector(asCtx(spy2), c2, new Map([['t1', target]]), THEME);
    expect(spy2.fill).toHaveBeenCalled();
  });
});
